// Momentum as a connector for AI chats (Claude, ChatGPT, anything that speaks MCP).
// Streamable HTTP, stateless: every POST to /api/mcp carries one JSON-RPC message and gets a JSON reply.
// Sign-in is Supabase Auth's OAuth 2.1 server, so the bearer token is an ordinary Supabase access token for the user
// and every query runs under row-level security, exactly like the app.

import { z } from 'zod';
import { handoffToDrafts, draftsToCommit, HandoffItem, type HandoffInterpretation } from '../../app/src/core/handoff';
import { recommend, KIND_LABEL } from '../../app/src/core/recommend';
import type { Action, Goal, LifeArea } from '../../app/src/core/types';
import { crunch, projectHealth, staleTasks } from '../../app/src/core/workload';
import { emailLink, emailRef, oneLine, scoreEmail, type BriefAccount, type BriefMessage } from '../../app/src/core/emailBrief';
import { BriefingInput, modifyMessages, personToday, saveChatBriefing, threadTextFor } from './email/service';
import type { Env } from './env';
import { commitCapture, must, type Ctx } from './ops';
import { autoOrganize } from './organize';
import { authenticate, HttpError } from './supabase';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const OPEN: Action['status'][] = ['ready', 'in_progress', 'waiting', 'blocked'];
const LIVE_GOALS: Goal['status'][] = ['active', 'waiting', 'blocked', 'paused'];

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
    inputSchema: { type: 'object', required: ['title'], properties: taskProps },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'create_project',
    title: 'Start a project now',
    description: 'Creates one project with its first steps straight away, without review. Leave out steps to get Momentum’s starter steps for that kind of project. Steps keep the order you give; put all of a project’s steps here (up to 5) and add later ones with add_task, which appends them. Use only when they clearly ask; for plans use send_plan.',
    inputSchema: { type: 'object', required: ['title'], properties: { title: taskProps.title, why: taskProps.why, due_date: taskProps.due_date, hard_deadline: taskProps.hard_deadline, area: taskProps.area, steps: taskProps.steps } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'update_task',
    title: 'Change a task',
    description: 'Changes a task: its title, life area, project, date, estimated minutes, its place among its project’s steps, or whether it is waiting on someone. Use task ids from get_overview (each project lists its open steps in order). To put a project’s steps in order, call this with position for each step that is out of place.',
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
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
});
const PlanInput = z.object({ summary: z.string().trim().max(2000).default(''), items: z.array(HandoffItem).min(1).max(20) });
const IdInput = z.object({ id: z.string().uuid() });

async function load(ctx: Ctx) {
  const [areas, goals, actions] = await Promise.all([
    must(ctx.db.from('life_areas').select('id,name,color,icon,sort_order,archived_at,keywords').is('archived_at', null).order('sort_order')),
    must(ctx.db.from('goals').select('*').in('status', LIVE_GOALS).order('created_at')),
    must(ctx.db.from('actions').select('*').in('status', [...OPEN, 'suggested']).order('sort_order').order('created_at')),
  ]);
  return { areas: areas as LifeArea[], goals: goals as Goal[], actions: actions as Action[] };
}

const areaName = (areas: LifeArea[], id: string | null) => areas.find((a) => a.id === id)?.name ?? null;

async function overview(ctx: Ctx) {
  const { areas, goals, actions } = await load(ctx);
  const { count } = await ctx.db.from('capture_entries').select('id', { count: 'exact', head: true }).eq('source', 'chat').eq('status', 'interpreted');
  const open = actions.filter((a) => OPEN.includes(a.status));
  const due = crunch(actions, goals);
  const stale = staleTasks(actions, goals);
  const pinned = await pins(ctx, actions);
  return {
    ...pinned,
    life_areas: areas.map((a) => a.name),
    projects: goals.map((g) => {
      const steps = actions.filter((a) => a.goal_id === g.id);
      return {
        id: g.id, title: g.title, status: g.status, area: areaName(areas, g.life_area_id), why: g.meaning,
        health: g.status === 'active' ? (({ label, message }) => ({ label, message }))(projectHealth(g, actions)) : null,
        due: g.deadline ? `${g.deadline}${g.deadline_type === 'hard' ? ' (hard deadline)' : ''}` : null,
        open_steps: steps.filter((a) => OPEN.includes(a.status)).slice(0, 30).map((a) => ({ id: a.id, title: a.title, minutes: a.estimated_minutes, waiting: a.status === 'waiting' })),
        last_progress: g.last_meaningful_progress_at?.slice(0, 10) ?? null,
      };
    }),
    tasks: open.filter((a) => !a.goal_id).slice(0, 80).map((a) => ({
      id: a.id, title: a.title, area: areaName(areas, a.life_area_id), minutes: a.estimated_minutes,
      due: a.due_date ? `${a.due_date}${a.deadline_type === 'hard' ? ' (hard deadline)' : ''}` : null,
      waiting: a.status === 'waiting', added: a.created_at.slice(0, 10),
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
  const { areas, goals, actions } = await load(ctx);
  const [deps, feedback] = await Promise.all([
    must(ctx.db.from('action_dependencies').select('action_id,depends_on_id')),
    must(ctx.db.from('recommendation_feedback').select('action_id,goal_id,response,created_at').gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())),
  ]);
  const pinned = await pins(ctx, actions);
  const recs = recommend({ goals, actions, dependencies: deps as never, feedback: feedback as never, lifeAreas: areas })
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
  const { areas, goals } = await load(ctx);
  const items = handoffToDrafts(input.items, areas, goals.filter((g) => g.status !== 'paused'));
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
  const [draft] = handoffToDrafts([item], areas, goals.filter((g) => g.status !== 'paused'));
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

async function updateTask(ctx: Ctx, input: z.infer<typeof UpdateInput>) {
  const { areas, goals, actions } = await load(ctx);
  const task = actions.find((a) => a.id === input.id);
  if (!task) throw new ToolError('No open task with that id. Call get_overview for current ids.');
  const p: Record<string, unknown> = {};
  if (input.title) Object.assign(p, { title: input.title, user_edited: true });
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
  if (!Object.keys(p).length && input.position === undefined) throw new ToolError('Nothing to change.');
  if (Object.keys(p).length) await must(ctx.db.from('actions').update(p).eq('id', task.id).select('id'));
  const changed = Object.keys(p).filter((k) => k !== 'user_edited');
  if (input.position !== undefined) {
    const goalId = (p.goal_id as string | null | undefined) === undefined ? task.goal_id : (p.goal_id as string | null);
    if (!goalId) throw new ToolError('Only tasks in a project have a position. Set project first.');
    // Renumber the project's open steps with this one in its new place (done steps keep their numbers below).
    const steps = actions.filter((a) => a.goal_id === goalId && a.id !== task.id);
    steps.splice(Math.min(input.position, steps.length + 1) - 1, 0, task);
    const done = await must(ctx.db.from('actions').select('sort_order').eq('goal_id', goalId).eq('status', 'done').order('sort_order', { ascending: false }).limit(1)) as { sort_order: number }[];
    const base = (done[0]?.sort_order ?? -1) + 1;
    await Promise.all(steps.map((a, i) => a.sort_order === base + i && a.id !== task.id ? null : must(ctx.db.from('actions').update({ sort_order: base + i }).eq('id', a.id).select('id'))));
    changed.push('position');
    return { status: 'updated', id: task.id, changed, project_steps_in_order: steps.map((a) => a.title) };
  }
  return { status: 'updated', id: task.id, changed };
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
    case 'add_task': return addNow(ctx, { ...parse(HandoffItem.omit({ kind: true }), args), kind: 'task' });
    case 'create_project': return addNow(ctx, { ...parse(HandoffItem.omit({ kind: true, project: true, minutes: true }), args), kind: 'project' });
    case 'update_task': return updateTask(ctx, parse(UpdateInput, args));
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
