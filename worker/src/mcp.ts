// Momentum as a connector for AI chats (Claude, ChatGPT, anything that speaks MCP).
// Streamable HTTP, stateless: every POST to /api/mcp carries one JSON-RPC message and gets a JSON reply.
// Sign-in is Supabase Auth's OAuth 2.1 server, so the bearer token is an ordinary Supabase access token for the user
// and every query runs under row-level security, exactly like the app.

import { z } from 'zod';
import { handoffToDrafts, draftsToCommit, HandoffItem, type HandoffInterpretation } from '../../app/src/core/handoff';
import { recommend, KIND_LABEL } from '../../app/src/core/recommend';
import { composeNotes, readyToHandOff, titleProblem } from '../../app/src/core/clarity';
import { assigneeLabel, isMine, resolveAssignee, teamUpdates, type TeamData } from '../../app/src/core/team';
import type { Action, Goal, LifeArea, Team, TeamMember, TeamMemberRole, TeamRole } from '../../app/src/core/types';
import { crunch, projectHealth, staleTasks } from '../../app/src/core/workload';
import { emailLink, emailRef, oneLine, scoreEmail, type BriefAccount, type BriefMessage } from '../../app/src/core/emailBrief';
import { BriefingInput, modifyMessages, personToday, saveChatBriefing, threadTextFor } from './email/service';
import type { Env } from './env';
import { commitCapture, must, type Ctx } from './ops';
import { autoOrganize } from './organize';
import { authenticate, HttpError } from './supabase';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const OPEN: Action['status'][] = ['ready', 'in_progress', 'waiting', 'blocked'];
const LIVE_GOALS: Goal['status'][] = ['active', 'waiting', 'blocked', 'paused', 'parked'];
// Other people read what a chat adds without the chat: these are required, and the errors say what to include.
const SUMMARY_RULE = 'summary is required: 2–4 sentences for the people who open this in Momentum (what it is, why, where it stands)';
const NOTES_RULE = 'notes are required: the details someone needs to do it without this chat';
const BRIEF_RULE = 'each task needs how (what exactly to do) and done_when (what finished looks like), written for someone who was not in this chat';

/** The person's name as teammates know it (for "From …" on handoffs). */
async function myName(ctx: Ctx): Promise<string | null> {
  const { data: m } = await ctx.db.from('team_members').select('display_name').eq('user_id', ctx.userId).limit(1);
  const name = (m as { display_name: string }[] | null)?.[0]?.display_name;
  if (name) return name;
  const { data: prof } = await ctx.db.from('profiles').select('display_name').maybeSingle();
  return (prof as { display_name?: string | null } | null)?.display_name ?? null;
}

export const MCP_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Mcp-Protocol-Version,Mcp-Session-Id,Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate,Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

const origin = (env: Env) => (env.API_URL ?? env.APP_URL ?? 'https://todos.jamry.us').replace(/\/$/, '');
const resourceMetadataUrl = (env: Env) => `${origin(env)}/.well-known/oauth-protected-resource/api/mcp`;
const reviewUrl = (env: Env, id: string) => `${(env.APP_URL ?? 'https://todos.jamry.us').replace(/\/$/, '')}/capture?handoff=${id}`;

const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...MCP_CORS, ...extra, ...(body === null ? {} : { 'Content-Type': 'application/json' }) } });

/** OAuth protected-resource metadata (RFC 9728): tells the chat where to sign the user in. */
// Supabase sends every sign-in to its one Site URL (todos.jamry.us). Other sites serving this app
// (dashboard.malindaperryconsulting.com) present themselves as the sign-in server instead: the same Supabase endpoints,
// except the first step, which goes through `/api/oauth/authorize` here so the person signs in on the site they connected.
export function protectedResourceMetadata(env: Env, ownSignIn = false): Response {
  return reply({
    resource: `${origin(env)}/api/mcp`,
    authorization_servers: [ownSignIn ? origin(env) : `${env.SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Momentum',
    resource_documentation: `${origin(env)}/connect`,
  });
}

/** Older MCP clients look for authorization-server metadata on this host; pass Supabase's through. */
export async function authorizationServerMetadata(env: Env, ownSignIn = false): Promise<Response> {
  const res = await fetch(`${env.SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`);
  if (!res.ok) return reply({ error: 'oauth_server_unavailable' }, 502);
  const meta = await res.json() as Record<string, unknown>;
  if (ownSignIn) Object.assign(meta, { issuer: origin(env), authorization_endpoint: `${origin(env)}/api/oauth/authorize` });
  return reply(meta, 200, { 'Cache-Control': 'public, max-age=3600' });
}

/**
 * The consent page's calls to Supabase (`{ id }` to read a connection request, `{ id, action }` to approve or deny it).
 * Supabase only accepts them from its Site URL, so they go through here, from that origin, on every site.
 */
export async function consentProxy(req: Request, env: Env, siteUrl: string, headers: HeadersInit): Promise<Response> {
  const { id, action } = await req.json().catch(() => ({})) as { id?: string; action?: string };
  if (!id || !/^[\w-]+$/.test(id) || (action && action !== 'approve' && action !== 'deny')) {
    return Response.json({ error: 'bad_request' }, { status: 400, headers });
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/oauth/authorizations/${id}${action ? '/consent' : ''}`, {
    method: action ? 'POST' : 'GET',
    headers: {
      Authorization: req.headers.get('Authorization') ?? '',
      apikey: env.SUPABASE_ANON_KEY,
      Origin: siteUrl,
      ...(action ? { 'Content-Type': 'application/json' } : {}),
    },
    body: action ? JSON.stringify({ action }) : undefined,
  });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !body) return Response.json({ error: String(body?.msg ?? body?.error_description ?? body?.error ?? 'request_failed') }, { status: res.ok ? 502 : res.status, headers });
  return Response.json(body, { headers });
}

/**
 * First step of the chat sign-in on a non-primary site: let Supabase start the authorization (it needs no session for
 * that), then send the browser to this site's consent page instead of the Site URL's.
 */
export async function authorize(req: Request, env: Env): Promise<Response> {
  const query = new URL(req.url).search;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/oauth/authorize${query}`, { redirect: 'manual' });
  const location = res.headers.get('Location');
  if (!location) return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } });
  const next = new URL(location, env.SUPABASE_URL);
  // Only the hop to the consent page moves; errors sent back to the chat's redirect_uri pass through untouched.
  const target = next.pathname === '/oauth/consent' ? `${origin(env)}${next.pathname}${next.search}` : next.toString();
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

// ───────────────────────── tool definitions (JSON Schema for the chat, zod for us)

const itemSchema = {
  type: 'object',
  required: ['kind', 'title'],
  properties: {
    kind: { type: 'string', enum: ['task', 'project', 'done', 'note'], description: 'task = one concrete action; project = an outcome that needs several steps; done = something already finished (it is celebrated in their history); note = context to attach to an existing project' },
    title: { type: 'string', maxLength: 200, description: 'Short and concrete, starting with a verb for tasks ("Call Julie about the lease")' },
    why: { type: 'string', maxLength: 500, description: 'Why it matters to them, in their words when possible. Most useful on projects and bigger tasks.' },
    due_date: { type: 'string', description: 'YYYY-MM-DD, only when there is a real date' },
    hard_deadline: { type: 'boolean', description: 'true when the date cannot move (bill, appointment, filing deadline); false or omitted for a target date' },
    minutes: { type: 'integer', minimum: 1, maximum: 600, description: 'Estimated minutes for a task' },
    area: { type: 'string', maxLength: 60, description: 'One of their life areas (see get_overview), e.g. "Home"' },
    project: { type: 'string', maxLength: 200, description: 'For tasks/done/notes: the title or id of an existing project it belongs to' },
    from_email: { type: 'string', description: 'For items that came from an email: its id from get_inbox, so the task links back to it' },
    steps: { type: 'array', maxItems: 5, description: 'For projects: the first 2–5 small steps', items: { type: 'object', required: ['title'], properties: { title: { type: 'string', maxLength: 200 }, minutes: { type: 'integer', minimum: 1, maximum: 600 } } } },
  },
};
const { kind: _k, ...taskProps } = itemSchema.properties;

const TOOLS = [
  {
    name: 'get_overview',
    title: 'Read their Momentum lists',
    description: "Returns the person's life areas, open projects (with health, progress and next steps) and open tasks, plus what needs attention: a pile-up of things due at once (with a suggested order and what could move), tasks that have been sitting a while (with a suggested way forward), and how many chat plans wait for review. Call this first so you know what already exists before suggesting anything.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_today',
    title: "Read today's suggestions",
    description: "Returns Momentum's suggestions for today in its four categories (Meaningful Move, Time-Sensitive, Easy Momentum, Quietly Waiting) plus a few next-up tasks, each with the reason it was picked.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'send_plan',
    title: 'Hand off a plan for review',
    description: 'The main handoff. After talking it through, send everything you worked out together: tasks, projects with first steps, things already done. Nothing is added yet: it waits in Momentum as "From chat" for them to review, edit and accept. Momentum fills in anything you leave out (life area, minutes, starter steps, why it matters) with its own rules. Tell them it is waiting and share the review link.',
    inputSchema: {
      type: 'object',
      required: ['summary', 'items'],
      properties: {
        summary: { type: 'string', maxLength: 2000, description: 'One or two sentences on what you talked about and what this plan is for, written to them ("Getting ready for the move on the 15th…")' },
        items: { type: 'array', minItems: 1, maxItems: 20, items: itemSchema },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'add_task',
    title: 'Add a task now',
    description: 'Adds one task straight to their list, without review. Use only when they clearly ask to add something specific ("add call the dentist tomorrow"); for plans use send_plan. A task added to a project goes after its existing steps. Give minutes when you know the size of the work; otherwise leave it out rather than guess.',
    inputSchema: { type: 'object', required: ['title', 'context', 'how', 'done_when'], properties: { ...taskProps, title: { ...taskProps.title, description: "Clear on its own to someone who was not in this chat: start with a verb and name the specific thing (and who it is for or from). Vague titles (\"Follow up\", \"Fix it\", \"Send this\") are rejected." }, ...{
          context: { type: 'string', minLength: 15, maxLength: 1500, description: 'Why this exists and the background someone needs who was not in this chat' },
          how: { type: 'string', minLength: 15, maxLength: 2000, description: 'What exactly to do, specific enough to start without asking' },
          done_when: { type: 'string', minLength: 10, maxLength: 600, description: 'What finished looks like, so they know when to check it off' },
          links: { type: 'string', maxLength: 1000, description: 'Links, files, logins to ask for, where things live' },
          ask: { type: 'string', maxLength: 200, description: 'Who to ask with questions' },
        },
      notes: { type: 'string', maxLength: 2000, description: 'Anything else worth knowing' },
      assignee: { type: 'string', maxLength: 80, description: 'Who does it: a teammate’s name or a role name (giving it to someone else shares the project with them automatically), "me", or "none". See teams in get_overview.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'create_project',
    title: 'Start a project now',
    description: 'Creates one project with its first steps straight away, without review. A summary and notes on every step are required, because other people read them in Momentum without this chat. With team, it goes on that team and each step can name its assignee. Steps keep the order you give; put all of a project’s steps here (up to 5) and add later ones with add_task, which appends them. Use only when they clearly ask; for plans use send_plan.',
    inputSchema: {
      type: 'object', required: ['title', 'summary', 'steps'],
      properties: {
        title: taskProps.title,
        summary: { type: 'string', minLength: 20, maxLength: 1500, description: "Required. 2–4 sentences for whoever opens this project in Momentum (they were not in this chat): what it is, why it matters, where things stand, and any decisions or constraints." },
        why: taskProps.why, due_date: taskProps.due_date, hard_deadline: taskProps.hard_deadline, area: taskProps.area,
        team: { type: 'string', maxLength: 80, description: 'Put the project on this team (its name from get_overview) so every member sees it' },
        steps: { ...taskProps.steps, minItems: 1, items: { ...taskProps.steps.items, required: ['title', 'how', 'done_when'], properties: { ...taskProps.steps.items.properties,
          title: { type: 'string', maxLength: 200, description: "Clear on its own to someone who was not in this chat: start with a verb and name the specific thing (and who it is for or from). Vague titles (\"Follow up\", \"Fix it\", \"Send this\") are rejected." }, ...{
          context: { type: 'string', minLength: 15, maxLength: 1500, description: 'Optional: background for this step beyond the project summary' },
          how: { type: 'string', minLength: 15, maxLength: 2000, description: 'What exactly to do, specific enough to start without asking' },
          done_when: { type: 'string', minLength: 10, maxLength: 600, description: 'What finished looks like, so they know when to check it off' },
          links: { type: 'string', maxLength: 1000, description: 'Links, files, logins to ask for, where things live' },
          ask: { type: 'string', maxLength: 200, description: 'Who to ask with questions' },
        },
          assignee: { type: 'string', maxLength: 80, description: 'A teammate or role for this step (shares the project with them)' } } } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'update_task',
    title: 'Change a task',
    description: 'Changes a task: its title, life area, project, date, estimated minutes, its place among its project’s steps, who on the team does it, which steps it waits for, or whether it is waiting on someone. Use task ids from get_overview (each project lists its open steps in order). To put a project’s steps in order, call this with position for each step that is out of place.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string', maxLength: 200 },
        area: { type: 'string', maxLength: 60, description: 'Life area name' },
        project: { type: 'string', maxLength: 200, description: 'Project title or id, or "none" to take it out of its project' },
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear' },
        hard_deadline: { type: 'boolean' },
        waiting: { type: 'boolean', description: 'true = waiting on someone else; false = ready to do' },
        minutes: { type: ['integer', 'null'], minimum: 1, maximum: 600, description: 'Estimated minutes, or null to clear a wrong estimate' },
        position: { type: 'integer', minimum: 1, description: "Where it goes among its project's open steps: 1 = first. Larger than the number of steps = last." },
        notes: { type: ['string', 'null'], maxLength: 4000, description: 'The task’s details (links, who to call, specifics). Replaces what is there: start from the notes in get_overview to keep them. Empty or null clears.' },
        assignee: { type: 'string', maxLength: 80, description: 'Who does it: a teammate’s name, a role name (anyone holding the role can take it), "me", or "none". Giving a step to a teammate shares its project with them automatically. See teams in get_overview.' },
        waits_for: { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'Ids of steps that must be finished before this one can start (often a teammate’s step). Replaces the current list; [] clears it. The step stays off their Today until those are done.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_project',
    title: 'Change a project',
    description: 'Changes a project: its title, why it matters, life area, due date or team, or adds a note to its Notes tab. Use project ids from get_overview. For the order of its steps, use update_task with position.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string', maxLength: 200 },
        why: { type: 'string', maxLength: 500 },
        area: { type: 'string', maxLength: 60, description: 'Life area name' },
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear' },
        hard_deadline: { type: 'boolean' },
        add_note: { type: 'string', maxLength: 4000, description: 'Adds a note to the project’s Notes tab (instructions, decisions, context)' },
        team: { type: 'string', maxLength: 80, description: 'Move the project onto a team (its name) or "none" to make it personal again. Only the project’s owner can.' },
        summary: { type: 'string', minLength: 20, maxLength: 1500, description: 'Replace the project summary people read in Momentum. Keep it current as plans change.' },
        status: { type: 'string', enum: ['active', 'parked'], description: 'active = unpack a parked project (then add its steps); parked = set it aside until it is ready' },
        revisit_on: { type: ['string', 'null'], description: 'Parked projects: YYYY-MM-DD to bring it back up, or null' },
        revisit_when: { type: ['string', 'null'], maxLength: 300, description: 'Parked projects: what should prompt it, e.g. "after the review system launches"' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'park_project',
    title: 'Park an idea or project',
    description: 'Sets aside something that needs working out but is not ready to unpack into steps. With title: parks a new idea (no starter steps), with what you know as notes and any rough steps. With id: parks an existing project. It stays out of Today and their lists until its revisit date, or until revisit_when fits what they are planning. Unpack later with update_project status "active".',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'An existing project to park (from get_overview)' },
        title: { type: 'string', maxLength: 200, description: 'A new idea to park' },
        summary: { type: 'string', minLength: 20, maxLength: 1500, description: 'Required for a new idea. ' + "2–4 sentences for whoever opens this project in Momentum (they were not in this chat): what it is, why it matters, where things stand, and any decisions or constraints." },
        why: { type: 'string', maxLength: 500 },
        area: { type: 'string', maxLength: 60, description: 'Life area name' },
        notes: { type: 'string', maxLength: 4000, description: 'What is known so far: questions, constraints, decisions, links' },
        rough_steps: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 }, description: 'Possible steps, kept with the idea (hidden until it is unpacked)' },
        revisit_on: { type: 'string', description: 'YYYY-MM-DD to bring it back up' },
        revisit_when: { type: 'string', maxLength: 300, description: 'What should prompt it, e.g. "after the review system launches"' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'complete_task',
    title: 'Mark a task done',
    description: 'Marks a task as done and records it in their history (it counts as progress on its project). Use a task id from get_overview.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_inbox',
    title: 'Read their inbox',
    description: "Recent email from every inbox they connected to Momentum: sender, subject, a preview, Momentum's category and its rule-based priority (score and why), plus a link that opens each email in their mail app. Also returns today's briefing if one exists. Use this when they ask what's in their email or what to answer first.",
    inputSchema: { type: 'object', properties: {
      days: { type: 'integer', minimum: 1, maximum: 7, description: 'How far back to look (default 2)' },
      include_low_priority: { type: 'boolean', description: 'Include newsletters, promotions and receipts (default false)' },
    } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_email_thread',
    title: 'Read a whole email conversation',
    description: 'The full text of one conversation (fetched from their mail provider on request, not stored). Use it for emails that look important before summarizing them.',
    inputSchema: { type: 'object', required: ['message_id'], properties: { message_id: { type: 'string', description: 'An id from get_inbox' } } },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'save_email_briefing',
    title: 'Save the inbox briefing',
    description: 'Saves your briefing into Momentum, where it shows at the top of their Inbox and on Today: a cohesive summary written to them (a short paragraph, not a list: what needs them, most urgent first, who they are waiting on, what can wait), and the emails to do first in order, each with a one-line reason. Optionally a better one-line summary per email. Replaces today\'s earlier briefing. In the summary, mention each email by pasting its `ref` from get_inbox (e.g. [[email:<id>|Dana · Document review]]): the app shows it as a tappable chip, so the person can tell emails apart from your words. Never write raw ids or addresses in the text.',
    inputSchema: { type: 'object', required: ['summary', 'do_first'], properties: {
      summary: { type: 'string', maxLength: 1500 },
      do_first: { type: 'array', maxItems: 10, items: { type: 'object', required: ['message_id', 'why'], properties: { message_id: { type: 'string' }, why: { type: 'string', maxLength: 200 } } } },
      message_notes: { type: 'array', maxItems: 40, items: { type: 'object', required: ['message_id', 'summary'], properties: { message_id: { type: 'string' }, summary: { type: 'string', maxLength: 300 } } } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'email_action',
    title: 'Archive, mark read or label emails',
    description: 'Archives, marks as read, or labels emails in their real mailbox. Only when they ask for it.',
    inputSchema: { type: 'object', required: ['message_ids', 'action'], properties: {
      message_ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
      action: { type: 'string', enum: ['archive', 'mark_read', 'label'] },
      label: { type: 'string', maxLength: 60 },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

const INSTRUCTIONS = [
  'Momentum is the person’s gentle to-do app: tasks, projects (outcomes with steps) and life areas.',
  'Help them think out loud first: ask what is on their mind, what matters and what has a real date. Keep steps small (5–30 minutes).',
  'Call get_overview before suggesting things so you build on what already exists instead of duplicating it.',
  'When the plan feels right, call send_plan once with everything. It waits for their review in the app, so it is safe to be generous.',
  'Use add_task / create_project only for a single thing they clearly asked to add now.',
  'The person may pin a "first thing" for the day (first_thing_today / first_thing_tomorrow). It is their choice: keep it first, never reorder or replace it, and only complete it when they say it is done.',
  'Email: for "what is in my email" or "what should I answer first", call get_inbox, read the threads that matter with read_email_thread, then save_email_briefing with a cohesive paragraph and a ranked do_first list, and tell them the same. Offer send_plan (with from_email) to turn emails into tasks. Archive or label only when asked.',
  'Teams: if get_overview lists teams, keep it light; they do not want to organize team projects. Leave their own steps alone and only set assignee on steps someone else should do: the person when it is clearly theirs, otherwise the role whose description fits (open to anyone holding it). That shares the project with the team automatically. When one of their steps cannot start until a teammate finishes something, set waits_for on it; it stays off their Today until then, and team_updates tells them when it is their turn. Use the exact names from teams; never invent people or roles, and if a role is missing, tell them to add it under Settings, Team.',
  'Write for asynchronous work: whoever picks up a task may never see this chat (a teammate, or them on another day). Titles must stand on their own: a verb plus the specific thing and who it is for or from ("Send Malinda the draft review-request email for approval", never "Follow up" or "Fix it"). Every task you add needs context (why it exists), how (what exactly to do) and done_when (what finished looks like), plus links and who to ask when you know them; Momentum lays these out in the task’s notes with who it is from. When you plan work for several people, write each person’s steps so they make sense without the others’ conversation. Others read what you add without this chat, so leave a trail: every project needs a summary (what it is, why, where it stands, decisions) and every task or step you add needs notes (what exactly to do, links, who to ask, what done looks like). Momentum rejects adds without them. Before handing a step to someone else, make sure its notes would let them do it alone. When plans change, update the summary (update_project summary) and add decisions as project notes (add_note).',
  'Parking: when something needs thinking through but is not ready to become steps (or they say "not now", "someday", "park it"), use park_project with what you know as notes, any rough steps, and when to revisit (a date and/or a condition). Do not unpack it unasked. When planning, look at parked in get_overview: bring up ideas that are ready_to_revisit, or whose revisit_when or notes fit what they are working on now, and offer to work them out. Add what you learn with update_project add_note. When they are ready, unpack with update_project status "active" and add the real steps.',
  'Keep their lists true to the plan: when you learn a step’s real size, a date moving, or a better order, fix it with update_task (minutes, due_date, position, notes) or update_project (due_date, add_note). Put specifics (links, who to call, decisions) in a task’s notes, its details section, and tell them what you changed. Steps you add later go to the end of their project, so set position when they belong earlier.',
  'If get_overview shows a pile-up or tasks sitting a while, offer to help: order the real deadlines quickest-first, move flexible dates with update_task, or talk through whether old tasks still matter. Never remove anything without asking.',
].join(' ');

// Some chat apps send numbers as text ("3", "null") when their copy of the tool list is out of date.
const numberish = (v: unknown) => v === 'null' ? null : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;

// ───────────────────────── tool handlers

const UpdateInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  area: z.string().trim().max(60).optional(),
  project: z.string().trim().max(200).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  hard_deadline: z.boolean().optional(),
  waiting: z.boolean().optional(),
  minutes: z.preprocess(numberish, z.number().int().min(1).max(600).nullable().optional()),
  position: z.preprocess(numberish, z.number().int().min(1).optional()),
  notes: z.preprocess((v) => v === 'null' ? null : v, z.string().max(4000).nullable().optional()),
  assignee: z.string().trim().max(80).optional(),
  waits_for: z.array(z.string().uuid()).max(10).optional(),
});
const ProjectUpdateInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  why: z.string().trim().max(500).optional(),
  area: z.string().trim().max(60).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  hard_deadline: z.boolean().optional(),
  add_note: z.string().trim().min(1).max(4000).optional(),
  team: z.string().trim().min(1).max(80).optional(),
  summary: z.string().trim().min(20, SUMMARY_RULE).max(1500).optional(),
  status: z.enum(['active', 'parked']).optional(),
  revisit_on: z.preprocess((v) => (v === 'null' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  revisit_when: z.preprocess((v) => (v === 'null' ? null : v), z.string().trim().max(300).nullable().optional()),
});
const ParkInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().min(20, SUMMARY_RULE).max(1500).optional(),
  why: z.string().trim().max(500).optional(),
  area: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(4000).optional(),
  rough_steps: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  revisit_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  revisit_when: z.string().trim().max(300).optional(),
});
const PlanInput = z.object({ summary: z.string({ required_error: SUMMARY_RULE }).trim().min(20, SUMMARY_RULE).max(2000), items: z.array(HandoffItem).min(1).max(20) });
const IdInput = z.object({ id: z.string().uuid() });

async function load(ctx: Ctx) {
  const [areas, goals, actions] = await Promise.all([
    must(ctx.db.from('life_areas').select('id,name,color,icon,sort_order,archived_at,keywords').is('archived_at', null).order('sort_order')),
    must(ctx.db.from('goals').select('*').in('status', LIVE_GOALS).order('created_at')),
    must(ctx.db.from('actions').select('*').in('status', [...OPEN, 'suggested']).order('sort_order').order('created_at')),
  ]);
  // Teams are optional: before the teams migration (or with no team) these come back empty.
  const soft = async <T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => { const { data, error } = await q; return error ? [] : ((data ?? []) as T[]); };
  const [teams, members, roles, memberRoles] = await Promise.all([
    soft<Team>(ctx.db.from('teams').select('*').order('created_at')),
    soft<TeamMember>(ctx.db.from('team_members').select('*')),
    soft<TeamRole>(ctx.db.from('team_roles').select('*').order('created_at')),
    soft<TeamMemberRole>(ctx.db.from('team_member_roles').select('*')),
  ]);
  const team: TeamData = { members, roles, memberRoles };
  // What is this person's to do (Today, attention): their own tasks, plus team steps assigned to them or their role.
  const mineActions = (actions as Action[]).filter((a) => isMine(a, goals as Goal[], ctx.userId, team));
  const mineGoals = (goals as Goal[]).filter((g) => !g.team_id || g.user_id === ctx.userId || mineActions.some((a) => a.goal_id === g.id));
  return { areas: areas as LifeArea[], goals: goals as Goal[], actions: actions as Action[], teams, team, mineActions, mineGoals };
}

/** Who has a step, for the chat: a name, "you", "Developer (open)", or null off team projects. */
function whoHas(a: Action, goals: Goal[], team: TeamData, me: string): string | null {
  if (!goals.find((g) => g.id === a.goal_id)?.team_id) return null;
  if (a.assignee_id === me) return 'you';
  return assigneeLabel(a, team)?.replace(' · open', ' (open: anyone with this role)') ?? 'nobody yet';
}

const areaName = (areas: LifeArea[], id: string | null) => areas.find((a) => a.id === id)?.name ?? null;

async function overview(ctx: Ctx) {
  const { areas, goals, actions, teams, team, mineActions, mineGoals } = await load(ctx);
  const { count } = await ctx.db.from('capture_entries').select('id', { count: 'exact', head: true }).eq('source', 'chat').eq('status', 'interpreted');
  const open = mineActions.filter((a) => OPEN.includes(a.status));
  const due = crunch(mineActions, mineGoals);
  const stale = staleTasks(mineActions, mineGoals);
  const pinned = await pins(ctx, actions);
  const me = ctx.userId;
  // Dependencies (theirs only: each person's own) and teammates' recent finishes, for waits_for and team_updates.
  const [deps, recentDone] = await Promise.all([
    must(ctx.db.from('action_dependencies').select('action_id,depends_on_id')) as Promise<{ action_id: string; depends_on_id: string }[]>,
    teams.length ? must(ctx.db.from('actions').select('*').eq('status', 'completed').gte('completed_at', new Date(Date.now() - 3 * 86_400_000).toISOString())) as Promise<Action[]> : Promise.resolve([] as Action[]),
  ]);
  const titleOf = (id: string) => [...actions, ...recentDone].find((a) => a.id === id)?.title ?? null;
  const waitsFor = (a: Action) => deps.filter((d) => d.action_id === a.id).map((d) => titleOf(d.depends_on_id) ?? 'a finished step');
  // Parked ideas, with their notes, so the chat can help work them out and bring them up at the right time.
  const parked = goals.filter((g) => g.status === 'parked');
  const parkedNotes = parked.length ? await must(ctx.db.from('goal_context').select('goal_id,body,created_at').in('goal_id', parked.map((g) => g.id)).is('resolved_at', null).order('created_at', { ascending: false })) as { goal_id: string; body: string }[] : [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const updates = teams.length ? teamUpdates({ all: [...actions, ...recentDone], goals, dependencies: deps, me, team }) : null;
  return {
    ...pinned,
    life_areas: areas.map((a) => a.name),
    ...(updates && (updates.finished.length || updates.unblocked.length || updates.waiting.length) ? {
      team_updates: {
        teammates_finished: updates.finished.map((f) => ({ who: f.by, step: f.action.title, project: f.goal?.title ?? null, when: f.action.completed_at })),
        your_turn_now: updates.unblocked.map((a) => ({ task_id: a.id, title: a.title })),
        still_waiting: updates.waiting.map((w) => ({ task_id: w.action.id, title: w.action.title, waiting_on: w.on.title, who: w.who.replace(' · open', ' (role, not taken yet)') })),
      },
    } : {}),
    ...(teams.length ? {
      teams: teams.map((t) => ({
        name: t.name,
        people: team.members.filter((m) => m.team_id === t.id).map((m) => ({
          name: m.display_name, is_you: m.user_id === me, admin: m.is_admin,
          roles: team.memberRoles.filter((r) => r.team_id === t.id && r.user_id === m.user_id).map((r) => team.roles.find((x) => x.id === r.role_id)?.name).filter(Boolean),
        })),
        roles: team.roles.filter((r) => r.team_id === t.id).map((r) => ({ name: r.name, does: r.description })),
      })),
    } : {}),
    ...(parked.length ? {
      parked: parked.map((g) => ({
        id: g.id, title: g.title, summary: g.description, area: areaName(areas, g.life_area_id), why: g.meaning,
        revisit_on: g.revisit_on ?? null, revisit_when: g.revisit_when ?? null, ready_to_revisit: !!g.revisit_on && g.revisit_on <= todayIso,
        notes: parkedNotes.filter((n) => n.goal_id === g.id).slice(0, 5).map((n) => n.body.slice(0, 400)),
        rough_steps: actions.filter((a) => a.goal_id === g.id && OPEN.includes(a.status)).map((a) => a.title),
      })),
    } : {}),
    projects: goals.filter((g) => g.status !== 'parked').map((g) => {
      const steps = actions.filter((a) => a.goal_id === g.id);
      return {
        id: g.id, title: g.title, status: g.status, summary: g.description, area: areaName(areas, g.life_area_id), why: g.meaning,
        ...(g.team_id ? { team: teams.find((t) => t.id === g.team_id)?.name ?? null, owned_by_you: g.user_id === me } : {}),
        health: g.status === 'active' ? (({ label, message }) => ({ label, message }))(projectHealth(g, actions)) : null,
        due: g.deadline ? `${g.deadline}${g.deadline_type === 'hard' ? ' (hard deadline)' : ''}` : null,
        open_steps: steps.filter((a) => OPEN.includes(a.status)).slice(0, 30).map((a) => ({
          id: a.id, title: a.title, minutes: a.estimated_minutes, due: a.due_date, waiting: a.status === 'waiting', notes: a.notes,
          ...(g.team_id ? { assignee: whoHas(a, goals, team, me) } : {}),
          ...(waitsFor(a).length ? { waits_for: waitsFor(a) } : {}),
        })),
        last_progress: g.last_meaningful_progress_at?.slice(0, 10) ?? null,
      };
    }),
    tasks: open.filter((a) => !a.goal_id).slice(0, 80).map((a) => ({
      id: a.id, title: a.title, area: areaName(areas, a.life_area_id), minutes: a.estimated_minutes,
      due: a.due_date ? `${a.due_date}${a.deadline_type === 'hard' ? ' (hard deadline)' : ''}` : null,
      waiting: a.status === 'waiting', added: a.created_at.slice(0, 10), notes: a.notes,
    })),
    plans_waiting_for_review: count ?? 0,
    attention: {
      due_soon: due.level === 'calm' ? null : {
        level: due.level, summary: due.headline, advice: due.advice,
        order: due.items.map((i) => ({ task_id: i.action.id, title: i.action.title, due: i.date, hard_deadline: i.hard, minutes: i.minutes })),
        could_move: due.movable.map((m) => ({ task_id: m.item.action.id, title: m.item.action.title, to: m.to })),
      },
      sitting_a_while: stale.slice(0, 10).map((s) => ({ task_id: s.action.id, title: s.action.title, days: s.days, suggestion: s.why })),
    },
  };
}

/** The person's local calendar date, offset by `days`, using the time zone the app saved on their profile. */
function localDate(tz: string, days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

/**
 * The person's pinned "first thing": chosen under End my day (or "Put first thing tomorrow") and stored on that day's
 * check-in, so yesterday's pin is today's first thing. Only open tasks count.
 */
async function pins(ctx: Ctx, actions: Action[]) {
  const { data: prof } = await ctx.db.from('profiles').select('timezone').maybeSingle();
  const tz = (prof as { timezone?: string } | null)?.timezone || 'UTC';
  const [yesterday, today] = [localDate(tz, -1), localDate(tz, 0)];
  const { data } = await ctx.db.from('daily_checkins').select('day,tomorrow_first_action_id').in('day', [yesterday, today]);
  const rows = (data ?? []) as { day: string; tomorrow_first_action_id: string | null }[];
  const open = (id: string | null | undefined) => {
    const a = id ? actions.find((x) => x.id === id && ['ready', 'in_progress', 'waiting', 'blocked'].includes(x.status)) : null;
    return a ? { task_id: a.id, title: a.title } : null;
  };
  return {
    first_thing_today: open(rows.find((r) => r.day === yesterday)?.tomorrow_first_action_id),
    first_thing_tomorrow: open(rows.find((r) => r.day === today)?.tomorrow_first_action_id),
  };
}

async function today(ctx: Ctx) {
  const { areas, mineGoals: goals, mineActions: actions, actions: all } = await load(ctx);
  const [deps, feedback] = await Promise.all([
    must(ctx.db.from('action_dependencies').select('action_id,depends_on_id')),
    must(ctx.db.from('recommendation_feedback').select('action_id,goal_id,response,created_at').gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())),
  ]);
  const pinned = await pins(ctx, actions);
  const recs = recommend({ goals, actions, knownActions: all, dependencies: deps as never, feedback: feedback as never, lifeAreas: areas })
    .filter((r) => r.action?.id !== pinned.first_thing_today?.task_id);
  const first = pinned.first_thing_today ? actions.find((a) => a.id === pinned.first_thing_today!.task_id)! : null;
  return {
    first_thing_today: pinned.first_thing_today,
    first_thing_tomorrow: pinned.first_thing_tomorrow,
    suggestions: [
      ...(first ? [{ category: 'Their first thing (pinned by them)', task_id: first.id, task: first.title, project: goals.find((g) => g.id === first.goal_id)?.title ?? null, minutes: first.estimated_minutes, reason: 'They chose this to start the day with. Keep it first.' }] : []),
      ...recs.map((r) => ({
      category: KIND_LABEL[r.kind], task_id: r.action?.id ?? null, task: r.action?.title ?? null, project: r.goal?.title ?? null,
      minutes: r.action?.estimated_minutes ?? null, reason: r.reason,
      })),
    ],
  };
}

async function sendPlan(ctx: Ctx, input: z.infer<typeof PlanInput>, client: string | null) {
  const unclear = input.items.flatMap((i) => [i.title, ...(i.steps ?? []).map((st) => st.title)]).map(titleProblem).find(Boolean);
  if (unclear) throw new ToolError(`Not sent: ${unclear}`);
  const { areas, goals } = await load(ctx);
  const items = handoffToDrafts(input.items, areas, goals.filter((g) => g.status !== 'paused' && g.status !== 'parked'));
  const interpretation: HandoffInterpretation = { version: 1, summary: input.summary, client, items };
  const raw = input.summary || input.items.map((i) => i.title).join('; ');
  const row = (await must(ctx.db.from('capture_entries').insert({ raw_text: raw.slice(0, 8000), source: 'chat', status: 'interpreted', interpretation }).select('id').single())) as { id: string };
  return {
    status: 'waiting_for_review',
    review_link: reviewUrl(ctx.env, row.id),
    message: 'Saved in Momentum as "From chat". Nothing is on their list until they review it.',
    items: items.map((d) => ({
      kind: d.kind === 'goal' ? 'project' : d.kind === 'accomplishment' ? 'done' : d.kind === 'action' ? 'task' : 'note',
      title: d.title, area: areaName(areas, d.suggested_life_area_id), project: goals.find((g) => g.id === d.suggested_goal_id)?.title ?? null,
      due: d.deadline, minutes: d.estimated_minutes, steps: d.next_actions.map((s) => s.title), why: d.meaning || null,
    })),
  };
}

async function addNow(ctx: Ctx, item: HandoffItem) {
  const { areas, goals } = await load(ctx);
  const [draft] = handoffToDrafts([item], areas, goals.filter((g) => g.status !== 'paused' && g.status !== 'parked'));
  const items = draftsToCommit([{ ...draft, client_id: crypto.randomUUID() }]);
  const result = (await commitCapture(ctx, { capture_id: null, raw_text: item.title, items, source: 'chat' })) as { items?: { kind: string; id: string }[] };
  const organized = result.items?.length ? await autoOrganize(ctx, result.items, 'capture', false) : null;
  const filed = (organized as { changes?: { to_goal_id?: string | null; to_area_id: string | null }[] } | null)?.changes?.[0];
  return {
    status: 'added',
    id: result.items?.[0]?.id ?? null,
    title: draft.title,
    area: areaName(areas, filed?.to_area_id ?? draft.suggested_life_area_id),
    project: goals.find((g) => g.id === (filed?.to_goal_id ?? draft.suggested_goal_id))?.title ?? null,
    due: draft.deadline,
    minutes: draft.estimated_minutes,
    steps: draft.next_actions.map((s) => s.title),
  };
}

/** A team by name (or id), for the chat. */
function findTeam(teams: Team[], name: string): Team {
  const n = name.toLowerCase();
  const t = teams.find((x) => x.id === name || x.name.toLowerCase() === n) ?? teams.find((x) => x.name.toLowerCase().includes(n));
  if (!t) throw new ToolError(teams.length ? `No team called "${name}". Their teams: ${teams.map((x) => x.name).join(', ')}.` : 'They are not on a team. Teams are set up in Momentum: Settings, Team.');
  return t;
}

/**
 * Who should do a step, from a name, role, "me" or "none". Handing a step to a teammate shares its project with
 * their team automatically (nothing for the person to set up); "me" on a personal project changes nothing.
 */
async function assignment(ctx: Ctx, goal: Goal | undefined, who: string, team: TeamData, teams: Team[]) {
  if (!goal) throw new ToolError('Only steps in a project can go to a teammate. Put the task in a project first (update_task with project).');
  if (goal.team_id) {
    const r = resolveAssignee(who, goal.team_id, ctx.userId, team);
    if ('error' in r) throw new ToolError(r.error);
    return r;
  }
  if (!teams.length) throw new ToolError('They are not on a team yet. Teams are set up in Momentum: Settings, Team.');
  let error = '';
  for (const t of teams) {
    const r = resolveAssignee(who, t.id, ctx.userId, team);
    if ('error' in r) { error ||= r.error; continue; }
    if (!r.assignee_id && !r.assigned_role_id) return r;
    if (r.assignee_id === ctx.userId) return { assignee_id: null, assigned_role_id: null };
    await must(ctx.db.from('goals').update({ team_id: t.id }).eq('id', goal.id).select('id'));
    goal.team_id = t.id;
    return r;
  }
  throw new ToolError(error);
}

async function updateTask(ctx: Ctx, input: z.infer<typeof UpdateInput>) {
  const { areas, goals, actions, team, teams } = await load(ctx);
  const task = actions.find((a) => a.id === input.id);
  if (!task) throw new ToolError('No open task with that id. Call get_overview for current ids.');
  const p: Record<string, unknown> = {};
  if (input.title) {
    const vague = titleProblem(input.title);
    if (vague) throw new ToolError(`Not renamed: ${vague}`);
    Object.assign(p, { title: input.title, user_edited: true });
  }
  if (input.area !== undefined) {
    const n = input.area.toLowerCase();
    const area = areas.find((a) => a.name.toLowerCase() === n) ?? areas.find((a) => a.name.toLowerCase().startsWith(n));
    if (!area) throw new ToolError(`No life area called "${input.area}". Their areas: ${areas.map((a) => a.name).join(', ')}.`);
    p.life_area_id = area.id;
  }
  if (input.project !== undefined) {
    if (input.project.toLowerCase() === 'none') p.goal_id = null;
    else {
      const n = input.project.toLowerCase();
      const g = goals.find((x) => x.id === input.project || x.title.toLowerCase() === n) ?? goals.find((x) => x.title.toLowerCase().includes(n));
      if (!g) throw new ToolError(`No project matching "${input.project}".`);
      p.goal_id = g.id;
    }
  }
  if (input.due_date !== undefined) {
    p.due_date = input.due_date;
    p.deadline_type = input.due_date ? (input.hard_deadline ? 'hard' : 'target') : 'none';
  } else if (input.hard_deadline !== undefined && task.due_date) p.deadline_type = input.hard_deadline ? 'hard' : 'target';
  if (input.waiting !== undefined) p.status = input.waiting ? 'waiting' : 'ready';
  if (input.minutes !== undefined) p.estimated_minutes = input.minutes;
  if (input.notes !== undefined) p.notes = input.notes?.trim() || null;
  if (input.assignee !== undefined) {
    const goalId = p.goal_id === undefined ? task.goal_id : (p.goal_id as string | null);
    const who = await assignment(ctx, goals.find((g) => g.id === goalId), input.assignee, team, teams);
    // Someone else will pick this up without the chat: they need the details.
    const handOff = (who.assignee_id && who.assignee_id !== ctx.userId) || who.assigned_role_id;
    if (handOff && !readyToHandOff((p.notes as string | null | undefined) ?? task.notes)) {
      throw new ToolError('Not assigned: they will pick this up without this chat, so its notes must say what to do and include a "Done when:" line. Rewrite notes (Context / What to do / Done when / Questions) in the same call.');
    }
    if (handOff && titleProblem(String(p.title ?? task.title))) throw new ToolError(`Not assigned: ${titleProblem(String(p.title ?? task.title))}`);
    Object.assign(p, who);
  }
  if (!Object.keys(p).length && input.position === undefined && input.waits_for === undefined) throw new ToolError('Nothing to change.');
  if (Object.keys(p).length) await must(ctx.db.from('actions').update(p).eq('id', task.id).select('id'));
  if (input.waits_for !== undefined) {
    const known = new Set(actions.map((a) => a.id));
    const bad = input.waits_for.filter((id) => !known.has(id) || id === task.id);
    if (bad.length) throw new ToolError(`Unknown or invalid step ids in waits_for: ${bad.join(', ')}. Use open step ids from get_overview.`);
    await must(ctx.db.from('action_dependencies').delete().eq('action_id', task.id).select('action_id'));
    if (input.waits_for.length) await must(ctx.db.from('action_dependencies').insert(input.waits_for.map((id) => ({ action_id: task.id, depends_on_id: id }))).select('action_id'));
  }
  const changed = [...Object.keys(p).filter((k) => k !== 'user_edited' && k !== 'assigned_role_id').map((k) => (k === 'assignee_id' ? 'assignee' : k)), ...(input.waits_for !== undefined ? ['waits_for'] : [])];
  if (input.position !== undefined) {
    const goalId = (p.goal_id as string | null | undefined) === undefined ? task.goal_id : (p.goal_id as string | null);
    if (!goalId) throw new ToolError('Only tasks in a project have a position. Set project first.');
    // Renumber the project's open steps with this one in its new place (done steps keep their numbers below).
    const steps = actions.filter((a) => a.goal_id === goalId && a.id !== task.id);
    steps.splice(Math.min(input.position, steps.length + 1) - 1, 0, task);
    const done = await must(ctx.db.from('actions').select('sort_order').eq('goal_id', goalId).eq('status', 'completed').order('sort_order', { ascending: false }).limit(1)) as { sort_order: number }[];
    const base = (done[0]?.sort_order ?? -1) + 1;
    await Promise.all(steps.map((a, i) => a.sort_order === base + i && a.id !== task.id ? null : must(ctx.db.from('actions').update({ sort_order: base + i }).eq('id', a.id).select('id'))));
    changed.push('position');
    return { status: 'updated', id: task.id, changed, project_steps_in_order: steps.map((a) => a.title) };
  }
  return { status: 'updated', id: task.id, changed };
}

async function updateProject(ctx: Ctx, input: z.infer<typeof ProjectUpdateInput>) {
  const { areas, goals, teams } = await load(ctx);
  const goal = goals.find((g) => g.id === input.id);
  if (!goal) throw new ToolError('No open project with that id. Call get_overview for current ids.');
  const p: Record<string, unknown> = {};
  if (input.title) p.title = input.title;
  if (input.why !== undefined) Object.assign(p, { meaning: input.why || null, meaning_source: input.why ? 'user' : 'none' });
  if (input.area !== undefined) {
    const n = input.area.toLowerCase();
    const area = areas.find((a) => a.name.toLowerCase() === n) ?? areas.find((a) => a.name.toLowerCase().startsWith(n));
    if (!area) throw new ToolError(`No life area called "${input.area}". Their areas: ${areas.map((a) => a.name).join(', ')}.`);
    p.life_area_id = area.id;
  }
  if (input.due_date !== undefined) {
    p.deadline = input.due_date;
    p.deadline_type = input.due_date ? (input.hard_deadline ? 'hard' : 'target') : 'none';
  } else if (input.hard_deadline !== undefined && goal.deadline) p.deadline_type = input.hard_deadline ? 'hard' : 'target';
  if (input.team !== undefined) {
    if (goal.user_id && goal.user_id !== ctx.userId) throw new ToolError('Only the project’s owner can change its team.');
    p.team_id = input.team.toLowerCase() === 'none' ? null : findTeam(teams, input.team).id;
  }
  if (input.summary) p.description = input.summary;
  if (input.status) {
    p.status = input.status;
    if (input.status === 'active' && goal.status === 'parked' && input.revisit_on === undefined) p.revisit_on = null;
  }
  // Unpacking an idea that never got a summary: ask for one so the team knows what it is.
  if (input.status === 'active' && !input.summary && !goal.description) throw new ToolError(`Not unpacked: ${SUMMARY_RULE}. Include summary in the same call.`);
  if (input.revisit_on !== undefined) p.revisit_on = input.revisit_on;
  if (input.revisit_when !== undefined) p.revisit_when = input.revisit_when || null;
  if (!Object.keys(p).length && !input.add_note) throw new ToolError('Nothing to change.');
  if (Object.keys(p).length) await must(ctx.db.from('goals').update(p).eq('id', goal.id).select('id'));
  if (input.add_note) await must(ctx.db.from('goal_context').insert({ goal_id: goal.id, kind: 'note', body: input.add_note }).select('id'));
  return { status: 'updated', id: goal.id, changed: [...Object.keys(p).filter((k) => k !== 'meaning_source').map((k) => (k === 'team_id' ? 'team' : k === 'description' ? 'summary' : k)), ...(input.add_note ? ['note added'] : [])] };
}

async function parkProject(ctx: Ctx, input: z.infer<typeof ParkInput>) {
  const { areas, goals } = await load(ctx);
  const revisit = { revisit_on: input.revisit_on ?? null, revisit_when: input.revisit_when || null };
  let goalId: string;
  if (input.id) {
    const goal = goals.find((g) => g.id === input.id);
    if (!goal) throw new ToolError('No open project with that id. Call get_overview for current ids.');
    await must(ctx.db.from('goals').update({ status: 'parked', ...revisit, ...(input.why ? { meaning: input.why, meaning_source: 'user' } : {}), ...(input.summary ? { description: input.summary } : {}) }).eq('id', goal.id).select('id'));
    goalId = goal.id;
  } else {
    if (!input.title) throw new ToolError('Give a title for a new idea, or the id of a project to park.');
    if (!input.summary) throw new ToolError(`Not parked: ${SUMMARY_RULE}.`);
    let areaId: string | null = null;
    if (input.area) {
      const n = input.area.toLowerCase();
      areaId = (areas.find((a) => a.name.toLowerCase() === n) ?? areas.find((a) => a.name.toLowerCase().startsWith(n)))?.id ?? null;
    }
    const row = await must(ctx.db.from('goals').insert({
      title: input.title, description: input.summary, status: 'parked', life_area_id: areaId, ...revisit,
      meaning: input.why ?? null, meaning_source: input.why ? 'user' : 'none',
    }).select('id').single()) as { id: string };
    goalId = row.id;
  }
  if (input.notes) await must(ctx.db.from('goal_context').insert({ goal_id: goalId, kind: 'note', body: input.notes }).select('id'));
  if (input.rough_steps?.length) {
    await must(ctx.db.from('actions').insert(input.rough_steps.map((title, i) => ({ goal_id: goalId, title, origin: 'ai', status: 'ready', sort_order: i + 1 }))).select('id'));
  }
  return { status: 'parked', id: goalId, ...revisit, message: 'Parked. It stays out of Today and their lists until it comes back.' };
}

async function completeTask(ctx: Ctx, id: string) {
  const { error } = await ctx.db.rpc('complete_action', { p_action_id: id, p_occurred_at: new Date().toISOString() });
  if (error) throw new ToolError('Could not mark that task done. Check the id with get_overview.');
  return { status: 'done', id, message: 'Marked done and added to their history.' };
}

/** A problem the chat can fix (bad id, unknown area): returned as a tool error, not a protocol error. */
class ToolError extends Error {}

const InboxInput = z.object({ days: z.number().int().min(1).max(7).default(2), include_low_priority: z.boolean().default(false) });
const ThreadIdInput = z.object({ message_id: z.string().uuid() });
const EmailActionInput = z.object({ message_ids: z.array(z.string().uuid()).min(1).max(50), action: z.enum(['archive', 'mark_read', 'label']), label: z.string().trim().min(1).max(60).optional() });

async function inbox(ctx: Ctx, input: z.infer<typeof InboxInput>) {
  const [accounts, msgs, projects] = await Promise.all([
    must(ctx.db.from('email_accounts').select('id,provider,email_address,display_name,status,webmail_url')),
    must(ctx.db.from('email_messages').select('id,account_id,provider_message_id,thread_id,from_name,from_address,subject,snippet,summary,received_at,is_unread,is_archived,category,importance,status,web_link,message_id_header')
      .eq('is_archived', false).gte('received_at', new Date(Date.now() - input.days * 86_400_000).toISOString()).order('received_at', { ascending: false }).limit(80)),
    must(ctx.db.from('goals').select('id,title').in('status', ['active', 'waiting', 'blocked'])),
  ]);
  const accts = accounts as (BriefAccount & { display_name: string | null; status: string })[];
  if (!accts.length) return { connected: false, message: 'No inbox is connected to Momentum yet. They can add one in Momentum: Settings, Email Accounts.' };
  const today = await personToday(ctx.db, ctx.userId);
  const { data: briefing } = await ctx.db.from('email_digests').select('summary,do_first,source,author,updated_at').eq('digest_date', today).maybeSingle();
  const low = new Set(['newsletter', 'promotion', 'receipt']);
  const list = (msgs as BriefMessage[]).filter((m) => input.include_low_priority || !low.has(m.category ?? ''));
  return {
    connected: true,
    inboxes: accts.map((a) => ({ address: a.email_address, provider: a.provider, name: a.display_name, status: a.status })),
    todays_briefing: briefing ?? null,
    hidden_low_priority: (msgs as BriefMessage[]).length - list.length,
    emails: list.map((m) => {
      const s = scoreEmail(m, projects as { id: string; title: string }[]);
      const account = accts.find((a) => a.id === m.account_id);
      return {
        id: m.id, ref: emailRef(m), inbox: account?.email_address, from: [m.from_name, m.from_address].filter(Boolean).join(' '), subject: m.subject,
        preview: (m.snippet ?? '').slice(0, 400), gist: oneLine(m), received: m.received_at, unread: m.is_unread, category: m.category,
        rules_priority: s.score, rules_why: s.why || null, open_link: emailLink(m, account)?.url ?? null,
      };
    }).sort((a, b) => b.rules_priority - a.rules_priority),
  };
}

function issues(e: z.ZodError) {
  return e.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

async function callTool(ctx: Ctx, name: string, args: unknown, client: string | null): Promise<unknown> {
  const parse = <S extends z.ZodTypeAny>(schema: S, v: unknown): z.output<S> => {
    const r = schema.safeParse(v ?? {});
    if (!r.success) throw new ToolError(`Invalid input: ${issues(r.error)}`);
    return r.data;
  };
  switch (name) {
    case 'get_overview': return overview(ctx);
    case 'get_today': return today(ctx);
    case 'send_plan': return sendPlan(ctx, parse(PlanInput, args), client);
    case 'add_task': {
      const brief = parse(z.object({
        title: z.string().trim().min(1).max(200),
        context: z.string().trim().max(1500).optional(),
        how: z.string({ required_error: BRIEF_RULE }).trim().min(15, BRIEF_RULE).max(2000),
        done_when: z.string({ required_error: BRIEF_RULE }).trim().min(10, BRIEF_RULE).max(600),
        links: z.string().trim().max(1000).optional(),
        ask: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(2000).optional(),
        assignee: z.string().trim().max(80).optional(),
      }).extend({ context: z.string({ required_error: BRIEF_RULE }).trim().min(15, BRIEF_RULE).max(1500) }), args);
      const vague = titleProblem(brief.title);
      if (vague) throw new ToolError(`Not added: ${vague}`);
      const assignee = brief.assignee;
      const added = await addNow(ctx, { ...parse(HandoffItem.omit({ kind: true }), args), kind: 'task' });
      if (!added.id) return added;
      const notes = composeNotes(brief, { by: await myName(ctx), project: added.project });
      const extra: Record<string, unknown> = { notes };
      if (assignee) {
        const { goals, team, teams } = await load(ctx);
        const row = await must(ctx.db.from('actions').select('goal_id').eq('id', added.id).single()) as { goal_id: string | null };
        Object.assign(extra, await assignment(ctx, goals.find((g) => g.id === row.goal_id), assignee, team, teams));
      }
      if (Object.keys(extra).length) await must(ctx.db.from('actions').update(extra).eq('id', added.id).select('id'));
      return { ...added, notes, ...(assignee ? { assignee } : {}) };
    }
    case 'create_project': {
      const extra = parse(z.object({
        summary: z.string({ required_error: SUMMARY_RULE }).trim().min(20, SUMMARY_RULE).max(1500),
        team: z.string().trim().min(1).max(80).optional(),
        steps: z.array(z.object({
        title: z.string().trim().min(1).max(200),
        context: z.string().trim().max(1500).optional(),
        how: z.string({ required_error: BRIEF_RULE }).trim().min(15, BRIEF_RULE).max(2000),
        done_when: z.string({ required_error: BRIEF_RULE }).trim().min(10, BRIEF_RULE).max(600),
        links: z.string().trim().max(1000).optional(),
        ask: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(2000).optional(),
        assignee: z.string().trim().max(80).optional(),
      }), { required_error: 'steps are required, each with how and done_when' }).min(1),
      }), args);
      const unclear = [String((args as { title?: unknown }).title ?? ''), ...extra.steps.map((st) => st.title)].map(titleProblem).find(Boolean);
      if (unclear) throw new ToolError(`Not created: ${unclear}`);
      const loaded = await load(ctx);
      const teamRow = extra.team ? findTeam(loaded.teams, extra.team) : null;
      const by = await myName(ctx);
      const created = await addNow(ctx, { ...parse(HandoffItem.omit({ kind: true, project: true, minutes: true }), args), kind: 'project' });
      if (!created.id) return created;
      await must(ctx.db.from('goals').update({ description: extra.summary, ...(teamRow ? { team_id: teamRow.id } : {}) }).eq('id', created.id).select('id'));
      const goal = { id: created.id, team_id: teamRow?.id ?? null } as Goal;
      const steps = await must(ctx.db.from('actions').select('id,title').eq('goal_id', created.id).order('sort_order')) as { id: string; title: string }[];
      const saved = [];
      for (const [i, st] of steps.entries()) {
        const given = extra.steps[i];
        const who = given?.assignee;
        const notes = given ? composeNotes(given, { by, project: created.title }) : null;
        const p = { ...(notes ? { notes } : {}), ...(who ? await assignment(ctx, goal, who, loaded.team, loaded.teams) : {}) };
        if (Object.keys(p).length) await must(ctx.db.from('actions').update(p).eq('id', st.id).select('id'));
        saved.push({ id: st.id, title: st.title, notes, assignee: who ?? null });
      }
      return { ...created, summary: extra.summary, ...(teamRow || goal.team_id ? { team: teamRow?.name ?? loaded.teams.find((t) => t.id === goal.team_id)?.name } : {}), steps: saved };
    }
    case 'update_task': return updateTask(ctx, parse(UpdateInput, args));
    case 'update_project': return updateProject(ctx, parse(ProjectUpdateInput, args));
    case 'park_project': return parkProject(ctx, parse(ParkInput, args));
    case 'complete_task': return completeTask(ctx, parse(IdInput, args).id);
    case 'get_inbox': return inbox(ctx, parse(InboxInput, args));
    case 'read_email_thread': {
      const t = await threadTextFor(ctx.env, ctx.db, parse(ThreadIdInput, args).message_id).catch((e) => { throw new ToolError(e instanceof HttpError && e.code === 'not_found' ? 'No email with that id. Use ids from get_inbox.' : 'Could not reach that mailbox right now.'); });
      return t;
    }
    case 'save_email_briefing': return { ...(await saveChatBriefing(ctx.db, ctx.userId, parse(BriefingInput, args), client)), message: 'Saved. It shows at the top of their Inbox and on Today.' };
    case 'email_action': {
      const a = parse(EmailActionInput, args);
      if (a.action === 'label' && !a.label) throw new ToolError('Give a label name.');
      await modifyMessages(ctx.env, ctx.db, ctx.userId, { message_ids: a.message_ids, op: a.action, label: a.label });
      return { status: 'done', action: a.action, count: a.message_ids.length };
    }
    default: throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

// ───────────────────────── JSON-RPC

class RpcError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Who is calling, from the token's client_id claim (already verified by Supabase). */
function clientOf(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { client_id?: string };
    return payload.client_id ?? null;
  } catch {
    return null;
  }
}

async function dispatch(msg: RpcMessage, ctx: Ctx, client: string | null): Promise<unknown> {
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'momentum', title: 'Momentum', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS };
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      try {
        const out = await callTool(ctx, name, msg.params?.arguments, client);
        return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
      } catch (e) {
        if (e instanceof ToolError) return { content: [{ type: 'text', text: e.message }], isError: true };
        if (e instanceof HttpError) return { content: [{ type: 'text', text: `Momentum could not do that (${e.code}).` }], isError: true };
        throw e;
      }
    }
    case 'resources/list': return { resources: [] };
    case 'prompts/list': return { prompts: [] };
    default: throw new RpcError(-32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return reply(null, 204);
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

  let auth: Awaited<ReturnType<typeof authenticate>>;
  try {
    auth = await authenticate(req, env);
  } catch {
    return reply({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl(env)}"` });
  }
  const ctx: Ctx = { env, db: auth.db, userId: auth.userId };
  const client = clientOf(auth.token);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 256 * 1024) return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, 413);
    body = JSON.parse(text);
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const one = async (msg: RpcMessage) => {
    if (msg.id === undefined || msg.id === null) return null; // notification: nothing to send back
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await dispatch(msg, ctx, client) };
    } catch (e) {
      const code = e instanceof RpcError ? e.code : -32603;
      if (!(e instanceof RpcError)) console.error('mcp', { method: msg.method, name: (e as Error).name });
      return { jsonrpc: '2.0', id: msg.id, error: { code, message: e instanceof RpcError ? e.message : 'Internal error' } };
    }
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(m as RpcMessage)))).filter(Boolean);
    return out.length ? reply(out) : reply(null, 202);
  }
  const out = await one(body as RpcMessage);
  return out ? reply(out) : reply(null, 202);
}
