// Local preview mode (EXPO_PUBLIC_DEMO=1): sample data matching the design mockup and a fake API, so every
// signed-in screen can be viewed and exercised without a Supabase project or Worker. Never enabled in production builds.

import type { Session } from '@supabase/supabase-js';
import type { CommitItem } from '../core/ai-contracts';
import { handoffToDrafts } from '../core/handoff';
import type { Accomplishment, Action, Goal, LifeArea } from '../core/types';
import type { ChatConnection, EmailAccount, EmailMessage, Handoff, OrganizePlan, OrganizeRun, Snapshot } from './store';

export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

const now = Date.now();
const H = 3_600_000, D = 24 * H;
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const date = (offsetDays: number) => new Date(now + offsetDays * D).toISOString().slice(0, 10);

export const demoSession = { user: { id: 'demo-user', email: 'you@example.com' }, access_token: 'demo' } as unknown as Session;

const area = (id: string, name: string, color: string, icon: string, sort_order: number): LifeArea => ({ id, name, color, icon, sort_order, archived_at: null });
const AREAS = [
  area('a-home', 'Home', '#F07A8C', 'home', 0), { ...area('a-work', 'Work', '#3FA7A3', 'briefcase', 1), keywords: ['crm', 'client'] }, area('a-health', 'Health', '#7DB46C', 'leaf', 2),
  area('a-fin', 'Finances', '#F2B84B', 'wallet', 3), area('a-rel', 'Relationships', '#F59A6B', 'heart', 4), area('a-growth', 'Personal Growth', '#A98BDB', 'sparkle', 5),
  area('a-other', 'Other', '#9CA3AF', 'circle', 6),
];

const goal = (id: string, title: string, life_area_id: string | null, extra: Partial<Goal> = {}): Goal => ({
  id, title, life_area_id, description: null, meaning: null, meaning_source: 'none', deadline: null, deadline_type: 'none', status: 'active',
  completion_criteria: null, icon: 'target', accountability: 'default', snoozed_until: null, last_meaningful_progress_at: iso(-2 * D),
  completed_at: null, archived_at: null, created_at: iso(-20 * D), updated_at: iso(-D), ...extra,
});
const GOALS: Goal[] = [
  goal('g-doc', 'Submit the document', 'a-work', { meaning: 'Gets a major obligation off my mind.', meaning_source: 'user', accountability: 'keep_visible' }),
  goal('g-ins', 'Renew insurance', 'a-fin', { deadline: date(7), deadline_type: 'hard' }),
  goal('g-garage', 'Organize the garage', 'a-home', { last_meaningful_progress_at: iso(-16 * D), meaning: 'Room to breathe at home.', meaning_source: 'user' }),
  goal('g-web', 'Launch website', 'a-work'),
  goal('g-trip', 'Plan trip', 'a-rel'),
  goal('g-app', 'Create a project management app for Malinda', 'a-work', { created_at: iso(-H) }), // no steps yet
];

let seq = 0;
const act = (title: string, goal_id: string | null, status: Action['status'], estimated_minutes: number | null, extra: Partial<Action> = {}): Action => ({
  id: `x-${++seq}`, goal_id, life_area_id: null, title, notes: null, completion_criteria: null, estimated_minutes, status, origin: 'user',
  requires_clarification: false, user_edited: false, sort_order: seq, times_recommended: 0, times_skipped: 0,
  completed_at: status === 'completed' ? iso(-seq * H) : null, created_at: iso(-10 * D), ...extra,
});
const ACTIONS: Action[] = [
  act('Find the official submission form', 'g-doc', 'completed', 10), act('Read the requirements', 'g-doc', 'completed', 15), act('Draft the cover page', 'g-doc', 'completed', 15),
  act('Identify missing information', 'g-doc', 'ready', 10), act('Gather missing information', 'g-doc', 'ready', 15), act('Make final edits', 'g-doc', 'ready', 15), act('Submit online', 'g-doc', 'ready', 10),
  act('Compare two quotes', 'g-ins', 'completed', 20), act('Call the insurance company', 'g-ins', 'ready', 15), act('Pay the renewal', 'g-ins', 'ready', 10),
  act('Clear one shelf', 'g-garage', 'completed', 15), act('Donate the old bike', 'g-garage', 'ready', 20), act('Sort the paint cans', 'g-garage', 'ready', 15),
  act('Pick a theme', 'g-web', 'completed', 30), act('Write the About page', 'g-web', 'completed', 30), act('Collect photos', 'g-web', 'completed', 20), act('Set up domain', 'g-web', 'completed', 15),
  act('Write the headline', 'g-web', 'ready', 20), act('Proofread pages', 'g-web', 'ready', 30),
  act('Choose dates', 'g-trip', 'completed', 10), act('Look at flights', 'g-trip', 'ready', 20),
  // Loose tasks for the organizer to file:
  act('Clear the kitchen counter', null, 'ready', 5, { life_area_id: 'a-home' }),
  act('Buy storage bins', null, 'ready', 15), act('Book dentist cleaning', null, 'ready', 10, { due_date: date(2), deadline_type: 'target' }), act('Reply to Maya about Saturday', null, 'ready', 5),
  act('Hang the hooks for bikes', null, 'ready', 20),
  act('Hear back from the landlord', null, 'waiting', 5, { life_area_id: 'a-home', created_at: iso(-8 * D) }),
  // A pile-up due today/tomorrow (Today shows "A lot is due at once"):
  act('Pay the water bill', null, 'ready', 10, { due_date: date(1), deadline_type: 'hard', life_area_id: 'a-fin' }),
  act('Submit expense report', null, 'ready', 30, { due_date: date(1), deadline_type: 'hard', life_area_id: 'a-work' }),
  act('Call the pharmacy', null, 'ready', 5, { due_date: date(0), deadline_type: 'hard', life_area_id: 'a-health' }),
  act('RSVP to the wedding', null, 'ready', 5, { due_date: date(1), deadline_type: 'target', life_area_id: 'a-rel' }),
  act('Return library books', null, 'ready', 15, { due_date: date(0), deadline_type: 'target' }),
  act('Plan the birthday dinner', null, 'ready', 90, { due_date: date(1), deadline_type: 'target', life_area_id: 'a-rel' }),
  // Things that have sat a while (the "Tidy up" review):
  act('Fix the squeaky door', null, 'ready', 15, { life_area_id: 'a-home', created_at: iso(-34 * D) }),
  act('Learn Spanish basics', null, 'ready', null, { life_area_id: 'a-growth', created_at: iso(-50 * D), times_skipped: 3 }),
  act('Clean out the car', null, 'ready', 30, { created_at: iso(-70 * D) }),
];

const acc = (title: string, hoursAgo: number, goal_id: string | null, life_area_id: string | null): Accomplishment => ({
  id: `c-${title}`, title, notes: null, goal_id, action_id: null, life_area_id, planned: false, meaningful: !!goal_id, occurred_at: iso(-hoursAgo * H), created_at: iso(-hoursAgo * H),
});
const today = new Date(); today.setHours(0, 0, 0, 0);
const hoursToday = (now - today.getTime()) / H;
const ACCOMPLISHMENTS: Accomplishment[] = [
  acc('Identified missing information', Math.min(1, hoursToday * 0.2), 'g-doc', 'a-work'),
  acc('Called insurance company', Math.min(2, hoursToday * 0.4), 'g-ins', 'a-fin'),
  acc('Cleaned kitchen counter', Math.min(3, hoursToday * 0.6), null, 'a-home'),
  acc('Paid electric bill', Math.min(4, hoursToday * 0.8), null, 'a-fin'),
  acc('30 min workout', 26, null, 'a-health'), acc('Worked on website headline', 28, 'g-web', 'a-work'),
  acc('Called Mom', 50, null, 'a-rel'), acc('Read 20 pages', 75, null, 'a-growth'), acc('Meal prepped lunches', 98, null, 'a-health'),
];

const ACCOUNTS: EmailAccount[] = [
  { id: 'm-gmail', provider: 'gmail', email_address: 'you@gmail.com', display_name: 'Personal', color: '#EE6B85', life_area_id: 'a-home', digest_enabled: true, status: 'active', error_code: null, last_synced_at: iso(-20 * 60_000) },
  { id: 'm-work', provider: 'outlook', email_address: 'you@company.com', display_name: 'Work', color: '#47A9A6', life_area_id: 'a-work', digest_enabled: true, status: 'active', error_code: null, last_synced_at: iso(-20 * 60_000) },
];
const mail = (id: string, account_id: string, from_name: string, subject: string, hoursAgo: number, category: EmailMessage['category'], importance: number, summary: string, life_area_id: string | null, suggested: EmailMessage['suggested_actions'] = [], extra: Partial<EmailMessage> = {}): EmailMessage => ({
  id, account_id, thread_id: id, from_name, from_address: `${from_name.split(' ')[0].toLowerCase()}@example.com`, subject, snippet: summary, received_at: iso(-hoursAgo * H),
  is_unread: hoursAgo < 6, is_archived: false, labels: [], category, importance, summary, life_area_id, suggested_goal_id: null, suggested_actions: suggested,
  thread_summary: null, thread_next_steps: [], status: 'new', ...extra,
});
const MESSAGES: EmailMessage[] = [
  mail('e1', 'm-gmail', 'Acme Insurance', 'Your policy renews November 1', 2, 'action_needed', 3, 'Renewal notice: confirm coverage and pay $412 by Nov 1 to avoid a lapse.', 'a-fin',
    [{ title: 'Confirm renewal coverage with Acme', estimated_minutes: 10, deadline: date(7) }], { suggested_goal_id: 'g-ins' }),
  mail('e2', 'm-work', 'Dana Whitfield', 'Re: Document review', 3, 'action_needed', 3, 'Dana needs the signed cover page before Thursday to submit on your behalf.', 'a-work',
    [{ title: 'Send Dana the signed cover page', estimated_minutes: 10, deadline: date(4) }], { suggested_goal_id: 'g-doc' }),
  mail('e3', 'm-gmail', 'Maya Chen', 'Saturday?', 5, 'action_needed', 2, 'Maya asks whether you are still free for brunch on Saturday at 11.', 'a-rel',
    [{ title: 'Reply to Maya about Saturday brunch', estimated_minutes: 5, deadline: null }]),
  mail('e4', 'm-work', 'Hosting Co.', 'Your domain is connected', 7, 'waiting_on', 2, 'DNS for your new domain is propagating; the site should be live within 24 hours.', 'a-work'),
  mail('e5', 'm-gmail', 'City Utilities', 'Payment received', 9, 'receipt', 1, 'Receipt for your $86.20 electric bill payment.', 'a-fin'),
  mail('e6', 'm-gmail', 'The Weekly Bloom', 'Five spring bulbs to plant now', 11, 'newsletter', 1, 'Gardening newsletter with fall planting tips.', 'a-home'),
  mail('e7', 'm-work', 'Priya Natarajan', 'Team offsite agenda', 15, 'fyi', 2, 'Draft agenda for next week’s offsite; no reply needed unless you want changes.', 'a-work'),
  mail('e8', 'm-gmail', 'Bloom & Co', '30% off planters this weekend', 20, 'promotion', 1, 'Weekend sale on planters and pots.', null),
];

// A plan Claude sent through the connector, waiting on Today for review. ?fresh=1 in the URL starts as a brand-new user.
const HANDOFF: Handoff = {
  id: 'h-1', created_at: iso(-25 * 60_000), raw_text: 'Getting ready for the move on the 15th and catching up on a few loose ends.',
  interpretation: {
    version: 1, client: 'Claude', summary: 'Getting ready for the move on the 15th and catching up on a few loose ends.',
    items: handoffToDrafts([
      { kind: 'project', title: 'Move to the new apartment', due_date: date(21), hard_deadline: true, why: 'A calmer start in the new place.' },
      { kind: 'task', title: 'Call Julie about the lease by tomorrow' },
      { kind: 'task', title: 'Renew the car registration', due_date: date(9), hard_deadline: true, minutes: 15 },
      { kind: 'done', title: 'Booked the movers' },
    ], AREAS, GOALS),
  },
};
const FRESH = typeof window !== 'undefined' && /[?&]fresh=1/.test(window.location?.search ?? '');

export const demo: { current: Snapshot; chatConnections: ChatConnection[] } = {
  chatConnections: [],
  current: {
    profile: { id: 'demo-user', display_name: 'You', timezone: 'UTC', preferred_action_minutes: 15, tone: 'warm', ai_enabled: true, ai_disclosure_accepted_at: iso(-30 * D), weekly_reflection_enabled: true, learned_preferences: {}, auto_organize: true, email_digest_enabled: true },
    lifeAreas: AREAS, goals: GOALS, actions: ACTIONS, dependencies: [], accomplishments: ACCOMPLISHMENTS, events: [], feedback: [], nudges: [], reflections: [],
    accountability: { inactivity_days: 10, max_nudges_per_week: 2, enabled: true },
    notifications: { deadlines: true, meaningful_reminders: false, waiting_followups: false, weekly_reflection: false, quiet_start: '21:00', quiet_end: '08:00', max_per_day: 2 },
    emailAccounts: ACCOUNTS, emailMessages: MESSAGES,
    emailDigest: {
      id: 'd1', digest_date: date(0), created_at: iso(-H),
      summary: 'Two things need you today: Dana needs the signed cover page before Thursday, and your Acme policy renews Nov 1. Maya asked about Saturday brunch. You are waiting on the domain to finish connecting, plus a receipt and a couple of newsletters.',
      highlights: [{ message_id: 'e2', text: 'Send Dana the signed cover page by Thursday' }, { message_id: 'e1', text: 'Acme renewal due Nov 1 — $412' }, { message_id: 'e3', text: 'Maya: brunch Saturday at 11?' }],
      counts: { total: 8, action_needed: 3, waiting_on: 1, receipt: 1, newsletter: 1, fyi: 1, promotion: 1 },
    },
    organizeRuns: [],
    handoffs: [HANDOFF],
  },
};
if (FRESH) {
  demo.current = { ...demo.current, profile: { ...demo.current.profile!, display_name: null, onboarded_at: null }, goals: [], actions: [], accomplishments: [], emailAccounts: [], emailMessages: [], emailDigest: null, handoffs: [] };
}

const PLAN: OrganizePlan = {
  new_projects: [{ ref: 'p1', title: 'Set up garage storage', life_area_id: 'a-home', reason: 'Bins and bike hooks are both garage storage', action_count: 2 }],
  assignments: [
    { kind: 'action', id: 'x-23', title: 'Buy storage bins', goal_id: null, goal_ref: 'p1', life_area_id: 'a-home', confidence: 0.92, reason: 'Storage for the garage', from_goal_id: null, from_area_id: null },
    { kind: 'action', id: 'x-26', title: 'Hang the hooks for bikes', goal_id: null, goal_ref: 'p1', life_area_id: 'a-home', confidence: 0.88, reason: 'Bike storage in the garage', from_goal_id: null, from_area_id: null },
    { kind: 'action', id: 'x-24', title: 'Book dentist cleaning', goal_id: null, goal_ref: null, life_area_id: 'a-health', confidence: 0.95, reason: 'Dental care', from_goal_id: null, from_area_id: null },
    { kind: 'action', id: 'x-25', title: 'Reply to Maya about Saturday', goal_id: null, goal_ref: null, life_area_id: 'a-rel', confidence: 0.9, reason: 'A friend’s plans', from_goal_id: null, from_area_id: null },
  ],
};

/** Fake Worker responses for demo mode. Mutations update `demo.current`; the store's refresh() re-reads it. */
export async function demoApi(path: string, body: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 450));
  const s = demo.current;
  switch (path) {
    case '/api/ai/organize': {
      const loose = new Set(s.actions.filter((a) => !a.goal_id && a.status !== 'completed').map((a) => a.id));
      return { ...PLAN, assignments: PLAN.assignments.filter((a) => loose.has(a.id)), new_projects: loose.has('x-23') ? PLAN.new_projects : [] };
    }
    case '/api/organize/apply': {
      const plan = body as { new_projects: { ref: string; title: string; life_area_id: string | null }[]; assignments: { kind: string; id: string; goal_id: string | null; goal_ref: string | null; life_area_id: string | null }[] };
      const refs = new Map(plan.new_projects.map((p, i) => [p.ref, `g-new-${Date.now()}-${i}`]));
      const goals = [...s.goals, ...plan.new_projects.map((p) => goal(refs.get(p.ref)!, p.title, p.life_area_id, { created_at: new Date().toISOString() }))];
      const changes: OrganizeRun['changes'] = [];
      const actions = s.actions.map((a) => {
        const asg = plan.assignments.find((x) => x.kind === 'action' && x.id === a.id);
        if (!asg) return a;
        const to_goal = asg.goal_id ?? (asg.goal_ref ? refs.get(asg.goal_ref)! : a.goal_id);
        changes.push({ kind: 'action', id: a.id, title: a.title, from_goal_id: a.goal_id, to_goal_id: to_goal, from_area_id: a.life_area_id, to_area_id: asg.life_area_id ?? a.life_area_id });
        return { ...a, goal_id: to_goal, life_area_id: to_goal ? null : asg.life_area_id ?? a.life_area_id };
      });
      const run: OrganizeRun = { id: `r-${Date.now()}`, trigger: 'manual', created_goal_ids: [...refs.values()], changes, undone_at: null, created_at: new Date().toISOString() };
      demo.current = { ...s, goals, actions, organizeRuns: [run, ...s.organizeRuns] };
      return run;
    }
    case '/api/organize/undo': {
      const run = s.organizeRuns.find((r) => r.id === body.run_id);
      if (!run) return { ok: true };
      const actions = s.actions.map((a) => {
        const c = run.changes.find((x) => x.id === a.id);
        return c ? { ...a, goal_id: c.from_goal_id ?? null, life_area_id: c.from_area_id } : a;
      });
      demo.current = { ...s, actions, goals: s.goals.filter((g) => !run.created_goal_ids.includes(g.id)), organizeRuns: s.organizeRuns.map((r) => (r.id === run.id ? { ...r, undone_at: new Date().toISOString() } : r)) };
      return { ok: true };
    }
    case '/api/email/providers': return { gmail: true, outlook: true, imap: true };
    case '/api/email/sync': return { accounts: s.emailAccounts.map((a) => ({ id: a.id, status: a.status, fetched: 0 })), triaged: 0 };
    case '/api/ai/email-digest': return { digest: s.emailDigest };
    case '/api/ai/email-thread': {
      const m = s.emailMessages.find((x) => x.id === body.message_id);
      return {
        summary: `${m?.from_name} wrote about “${m?.subject}”. ${m?.summary} Nothing else in the thread is still open.`,
        next_steps: m?.suggested_actions ?? [], waiting_on: m?.category === 'waiting_on' ? m.from_name : null,
      };
    }
    case '/api/email/modify': case '/api/email/disconnect': case '/api/email/connect-imap': return { ok: true };
    case '/api/email/connect': return { url: '/email-accounts?connected=gmail' };
    case '/api/capture/commit': {
      // Saves into the in-memory data so captures and reviewed chat plans show up like they would for real.
      const items = (body.items ?? []) as CommitItem[];
      const t = new Date().toISOString();
      const goals = [...s.goals], actions = [...s.actions], accomplishments = [...s.accomplishments];
      for (const it of items) {
        if (it.kind === 'goal') {
          const id = `g-${it.client_id}`;
          goals.push(goal(id, it.title, it.life_area_id, { deadline: it.deadline, deadline_type: it.deadline ? it.deadline_type : 'none', meaning: it.meaning ?? null, meaning_source: it.meaning ? 'user' : 'none', created_at: t, last_meaningful_progress_at: null }));
          it.next_actions.forEach((n) => actions.push(act(n.title, id, 'ready', n.estimated_minutes, { created_at: t, origin: 'ai' })));
        } else if (it.kind === 'action') {
          actions.push(act(it.title, it.goal_id, 'ready', it.estimated_minutes, { life_area_id: it.life_area_id, due_date: it.deadline, deadline_type: it.deadline ? it.deadline_type : 'none', created_at: t }));
        } else if (it.kind === 'accomplishment') {
          accomplishments.unshift({ ...acc(it.title, 0, it.goal_id, it.life_area_id), id: `c-${it.client_id}` });
        }
      }
      demo.current = { ...s, goals, actions, accomplishments, handoffs: s.handoffs.filter((h) => h.id !== body.capture_id) };
      return { organized: null };
    }
    default: throw Object.assign(new Error('demo'), { status: 503, code: 'ai_unavailable' });
  }
}
