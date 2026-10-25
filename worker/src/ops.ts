import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  BlockersOutput,
  ClassifyAccomplishmentOutput,
  CommitCaptureInput,
  DecomposeGoalOutput,
  InterpretCaptureOutput,
  NudgeOutput,
  ProgressSummaryOutput,
} from '../../app/src/core/ai-contracts';
import { startOfWeek, toISODate } from '../../app/src/core/dates';
import type { Env } from './env';
import { callStructured, enforceLimits } from './openai';
import { PROMPTS } from './prompts';
import * as S from './schemas';
import { HttpError } from './supabase';

export type Ctx = { env: Env; db: SupabaseClient; userId: string };

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
export const keepId = (id: string | null, allowed: Set<string>) => (id && allowed.has(id) ? id : null);

export async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new HttpError(400, 'db_error', error.message);
  return data as T;
}

export async function profile(ctx: Ctx) {
  const p = (await must(ctx.db.from('profiles').select('ai_enabled,timezone,preferred_action_minutes,tone').single())) as unknown as {
    ai_enabled: boolean; timezone: string; preferred_action_minutes: number; tone: string;
  };
  if (!p.ai_enabled) throw new HttpError(403, 'ai_disabled');
  return p;
}

/** Whether this request may use the AI provider: configured, turned on by the user, and within limits. */
export async function aiAllowed(ctx: Ctx): Promise<boolean> {
  if (!ctx.env.OPENAI_API_KEY) return false;
  const { data } = await ctx.db.from('profiles').select('ai_enabled').single();
  if (!data?.ai_enabled) return false;
  try {
    await enforceLimits(ctx.env, ctx.userId);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── interpret_capture
export const InterpretInput = z.object({
  text: z.string().trim().min(1).max(4000),
  source: z.enum(['text', 'voice', 'brain_dump', 'accomplishment', 'goal']).default('text'),
  idempotency_key: z.string().max(64).optional(),
});

export async function interpretCapture(ctx: Ctx, input: z.infer<typeof InterpretInput>) {
  const prof = await profile(ctx);
  // Preserve the original text before any AI call.
  const capture = await must(
    ctx.db.from('capture_entries').insert({ raw_text: input.text, source: input.source, status: 'pending' }).select('id').single(),
  ) as { id: string };

  const [goals, actions, areas] = await Promise.all([
    must(ctx.db.from('goals').select('id,title').in('status', ['active', 'waiting', 'blocked', 'paused']).limit(60)),
    must(ctx.db.from('actions').select('id,title,goal_id').in('status', ['ready', 'in_progress', 'waiting', 'blocked']).limit(80)),
    must(ctx.db.from('life_areas').select('id,name').is('archived_at', null)),
  ]) as [{ id: string; title: string }[], { id: string; title: string }[], { id: string; name: string }[]];

  try {
    const out = await callStructured(ctx.env, {
      operation: 'interpret_capture',
      promptVersion: PROMPTS.interpret_capture.version,
      system: PROMPTS.interpret_capture.system,
      user: { today: new Date().toISOString(), timezone: prof.timezone, text: input.text, existing_goals: goals, open_actions: actions, life_areas: areas },
      jsonSchema: S.interpretCaptureSchema,
      validator: InterpretCaptureOutput,
      maxOutputTokens: 2500,
      userId: ctx.userId,
      idempotencyKey: input.idempotency_key,
    });
    const goalIds = new Set(goals.map((g) => g.id));
    const dupIds = new Set([...goalIds, ...actions.map((a) => a.id)]);
    const areaIds = new Set(areas.map((a) => a.id));
    const items = out.items.map((it) => ({
      ...it,
      suggested_goal_id: keepId(it.suggested_goal_id, goalIds),
      possible_duplicate_of: keepId(it.possible_duplicate_of, dupIds),
      suggested_life_area_id: keepId(it.suggested_life_area_id, areaIds),
      next_actions: it.kind === 'goal' ? it.next_actions.slice(0, 3) : [],
    }));
    await ctx.db.from('capture_entries').update({ status: 'interpreted', interpretation: { items, questions: out.questions } }).eq('id', capture.id);
    return { capture_id: capture.id, items, questions: out.questions, ai: true };
  } catch (e) {
    await ctx.db.from('capture_entries').update({ status: 'failed' }).eq('id', capture.id);
    if (e instanceof HttpError) (e as HttpError & { capture_id?: string }).capture_id = capture.id;
    throw e;
  }
}

// ───────────────────────── decompose_goal
export const DecomposeInput = z.object({ goal_id: z.string().uuid(), regenerate: z.boolean().default(false), constraints: z.string().max(1000).optional() });

export async function decomposeGoal(ctx: Ctx, input: z.infer<typeof DecomposeInput>) {
  const prof = await profile(ctx);
  const goal = await must(ctx.db.from('goals').select('id,title,description,meaning,deadline,deadline_type,completion_criteria,status').eq('id', input.goal_id).single()) as Record<string, unknown>;
  if (input.regenerate) {
    // Regeneration replaces only untouched AI suggestions; user-created and edited actions are preserved.
    await ctx.db.from('actions').update({ status: 'dismissed' }).eq('goal_id', input.goal_id).eq('status', 'suggested').eq('origin', 'ai').eq('user_edited', false);
  }
  const actions = await must(ctx.db.from('actions').select('id,title,status,origin').eq('goal_id', input.goal_id).neq('status', 'dismissed')) as { id: string; title: string; status: string }[];
  const dismissed = await must(ctx.db.from('actions').select('title').eq('goal_id', input.goal_id).eq('status', 'dismissed').limit(20)) as { title: string }[];
  const context = await must(ctx.db.from('goal_context').select('kind,body').eq('goal_id', input.goal_id).is('resolved_at', null).limit(20));
  const openCount = actions.filter((a) => !['completed'].includes(a.status)).length;

  const out = await callStructured(ctx.env, {
    operation: 'decompose_goal',
    promptVersion: PROMPTS.decompose_goal.version,
    system: PROMPTS.decompose_goal.system,
    user: {
      goal, preferred_action_minutes: prof.preferred_action_minutes, constraints: input.constraints ?? null,
      completed_actions: actions.filter((a) => a.status === 'completed').map((a) => a.title),
      open_actions: actions.filter((a) => a.status !== 'completed').map((a) => a.title),
      rejected_suggestions: dismissed.map((d) => d.title), notes: context,
      how_many: Math.max(1, 3 - Math.min(openCount, 2)),
    },
    jsonSchema: S.decomposeGoalSchema,
    validator: DecomposeGoalOutput,
    maxOutputTokens: 1500,
    userId: ctx.userId,
  });
  if (out.goal_id !== input.goal_id) throw new HttpError(502, 'ai_unavailable', 'goal mismatch');

  // Business rules: no duplicates of existing/rejected actions, progressive (≤3), stored as suggestions.
  const seen = new Set([...actions.map((a) => norm(a.title)), ...dismissed.map((d) => norm(d.title))]);
  const fresh = out.suggested_actions.filter((s) => {
    const k = norm(s.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3);

  const maxOrder = actions.length;
  const inserted = fresh.length
    ? await must(ctx.db.from('actions').insert(fresh.map((s, i) => ({
        goal_id: input.goal_id, title: s.title, estimated_minutes: s.estimated_minutes, completion_criteria: s.completion_criteria,
        requires_clarification: s.requires_clarification, origin: 'ai', status: 'suggested', sort_order: maxOrder + i,
      }))).select('*')) as { id: string }[]
    : [];
  const deps = fresh
    .map((s, i) => (s.depends_on_index !== null && inserted[s.depends_on_index] && s.depends_on_index !== i
      ? { action_id: inserted[i].id, depends_on_id: inserted[s.depends_on_index].id } : null))
    .filter((d): d is { action_id: string; depends_on_id: string } => d !== null);
  if (deps.length) await ctx.db.from('action_dependencies').insert(deps);
  if (out.questions.length) await ctx.db.from('goal_context').insert(out.questions.map((q) => ({ goal_id: input.goal_id, kind: 'question', body: q })));
  return { suggested_actions: inserted, questions: out.questions, uncertainty_note: out.uncertainty_note };
}

// ───────────────────────── classify accomplishments
export const ClassifyInput = z.object({ text: z.string().trim().min(1).max(4000) });

export async function classifyAccomplishments(ctx: Ctx, input: z.infer<typeof ClassifyInput>) {
  const prof = await profile(ctx);
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const [goals, actions, recent, areas] = await Promise.all([
    must(ctx.db.from('goals').select('id,title,meaning').eq('status', 'active').limit(60)),
    must(ctx.db.from('actions').select('id,title,goal_id').in('status', ['ready', 'in_progress']).limit(80)),
    must(ctx.db.from('accomplishments').select('id,title,occurred_at').gte('occurred_at', since).limit(50)),
    must(ctx.db.from('life_areas').select('id,name').is('archived_at', null)),
  ]) as { id: string }[][];
  const out = await callStructured(ctx.env, {
    operation: 'classify_accomplishment',
    promptVersion: PROMPTS.classify_accomplishment.version,
    system: PROMPTS.classify_accomplishment.system,
    user: { now: new Date().toISOString(), timezone: prof.timezone, text: input.text, goals, open_actions: actions, recent_accomplishments: recent, life_areas: areas },
    jsonSchema: S.classifyAccomplishmentSchema,
    validator: ClassifyAccomplishmentOutput,
    maxOutputTokens: 1500,
    userId: ctx.userId,
  });
  const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const [g, a, r, l] = [ids(goals), ids(actions), ids(recent), ids(areas)];
  return {
    items: out.items.map((it) => ({
      ...it,
      suggested_goal_id: keepId(it.suggested_goal_id, g),
      advances_goal: it.advances_goal && !!keepId(it.suggested_goal_id, g),
      matches_action_id: keepId(it.matches_action_id, a),
      possible_duplicate_of: keepId(it.possible_duplicate_of, r),
      suggested_life_area_id: keepId(it.suggested_life_area_id, l),
    })),
  };
}

// ───────────────────────── identify_possible_blockers
export const BlockersInput = z.object({ goal_id: z.string().uuid() });

export async function identifyBlockers(ctx: Ctx, input: z.infer<typeof BlockersInput>) {
  await profile(ctx);
  const goal = await must(ctx.db.from('goals').select('id,title,description,meaning,deadline,status,last_meaningful_progress_at').eq('id', input.goal_id).single());
  const actions = await must(ctx.db.from('actions').select('title,status,estimated_minutes,times_skipped').eq('goal_id', input.goal_id).neq('status', 'dismissed'));
  const context = await must(ctx.db.from('goal_context').select('kind,body').eq('goal_id', input.goal_id).limit(20));
  return callStructured(ctx.env, {
    operation: 'identify_possible_blockers',
    promptVersion: PROMPTS.identify_possible_blockers.version,
    system: PROMPTS.identify_possible_blockers.system,
    user: { goal, actions, notes: context },
    jsonSchema: S.blockersSchema,
    validator: BlockersOutput,
    maxOutputTokens: 800,
    userId: ctx.userId,
  });
}

// ───────────────────────── commit (user-confirmed review)
export async function commitCapture(ctx: Ctx, input: CommitCaptureInput & { source?: string }) {
  const { data, error } = await ctx.db.rpc('commit_capture', {
    p_capture_id: input.capture_id, p_raw_text: input.raw_text, p_source: input.source ?? 'text', p_items: input.items,
  });
  if (error) throw new HttpError(400, 'commit_failed', error.message);
  return data;
}

// ───────────────────────── weekly summary
export const SummaryInput = z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Deterministic facts for a week. Pass userId when using the service client (cron), which bypasses RLS. */
export async function weeklyFacts(db: SupabaseClient, weekStart: Date, userId?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const own = (q: any) => (userId ? q.eq('user_id', userId) : q);
  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * 86_400_000).toISOString();
  const [acc, events, goals] = await Promise.all([
    must(own(db.from('accomplishments').select('title,goal_id,meaningful,planned')).gte('occurred_at', from).lt('occurred_at', to)),
    must(own(db.from('progress_events').select('type,goal_id,goal_title')).gte('occurred_at', from).lt('occurred_at', to)),
    must(own(db.from('goals').select('id,title,meaning,status,accountability,last_meaningful_progress_at')).eq('status', 'active')),
  ]) as [{ title: string; meaningful: boolean; planned: boolean }[], { type: string; goal_id: string | null; goal_title: string | null }[], { id: string; title: string; meaning: string | null; accountability: string }[]];
  const advanced = new Map<string, string>();
  for (const e of events) if (e.type === 'goal_advanced' && e.goal_id) advanced.set(e.goal_id, e.goal_title ?? '');
  const completedGoals = events.filter((e) => e.type === 'goal_completed').map((e) => e.goal_title);
  const quiet = goals.filter((g) => (g.meaning || g.accountability !== 'default') && !advanced.has(g.id) && g.accountability !== 'do_not_remind').map((g) => g.title);
  return {
    week_start: toISODate(weekStart),
    accomplishments: acc.length,
    unplanned_accomplishments: acc.filter((a) => !a.planned).length,
    goals_advanced: [...advanced.values()],
    goals_completed: completedGoals,
    accomplishment_titles: acc.slice(0, 30).map((a) => a.title),
    quiet_meaningful_goals: quiet.slice(0, 5),
  };
}

export async function weeklySummary(ctx: Ctx, input: z.infer<typeof SummaryInput>) {
  await profile(ctx);
  const ws = input.week_start ? new Date(`${input.week_start}T00:00:00Z`) : startOfWeek(new Date(Date.now() - 7 * 86_400_000));
  const facts = await weeklyFacts(ctx.db, ws);
  const out = await callStructured(ctx.env, {
    operation: 'generate_progress_summary',
    promptVersion: PROMPTS.generate_progress_summary.version,
    system: PROMPTS.generate_progress_summary.system,
    user: facts,
    jsonSchema: S.summarySchema,
    validator: ProgressSummaryOutput,
    maxOutputTokens: 700,
    userId: ctx.userId,
  });
  await ctx.db.from('weekly_reflections').upsert({ week_start: facts.week_start, facts, summary: out.summary }, { onConflict: 'user_id,week_start' });
  return { facts, ...out };
}

export async function nudgeMessage(env: Env, userId: string, payload: unknown) {
  const out = await callStructured(env, {
    operation: 'generate_accountability_nudge',
    promptVersion: PROMPTS.generate_accountability_nudge.version,
    system: PROMPTS.generate_accountability_nudge.system,
    user: payload,
    jsonSchema: S.nudgeSchema,
    validator: NudgeOutput,
    maxOutputTokens: 200,
    userId,
  });
  const banned = /\b(behind|fail|procrastinat|lazy|should have)\w*/i;
  return banned.test(out.message) ? null : out.message;
}
