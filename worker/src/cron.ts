// Scheduled analysis (Cloudflare Cron Trigger). Runs once a day — no polling.
// 1. Gentle accountability: create at most a few kind check-ins per user per week.
// 2. Mondays: weekly reflection for users who keep it enabled.
// 3. Email: sync every connected inbox, triage new mail, and write the morning digest.

import { defaultNudgeMessage, findNudgeCandidates } from '../../app/src/core/accountability';
import { startOfWeek, toISODate } from '../../app/src/core/dates';
import type { Accomplishment, Action, FeedbackEntry, Goal } from '../../app/src/core/types';
import type { Env } from './env';
import { nudgeMessage, weeklyFacts } from './ops';
import { callStructured } from './openai';
import { PROMPTS } from './prompts';
import { summarySchema } from './schemas';
import { ProgressSummaryOutput } from '../../app/src/core/ai-contracts';
import { serviceClient } from './supabase';
import { buildDigest, syncAccounts, triage, triageWithRules } from './email/service';

export async function runScheduled(env: Env, now = new Date()) {
  const db = serviceClient(env);
  const { data: profiles } = await db.from('profiles').select('id,ai_enabled,weekly_reflection_enabled,email_digest_enabled');
  for (const p of profiles ?? []) {
    try {
      await accountabilityFor(env, p.id, p.ai_enabled, now);
      if (now.getUTCDay() === 1 && p.weekly_reflection_enabled) await reflectionFor(env, p.id, p.ai_enabled, now);
      if (p.email_digest_enabled && env.EMAIL_TOKEN_KEY) await emailDigestFor(env, p.id, p.ai_enabled);
    } catch (e) {
      console.error('scheduled job failed', { user: p.id, error: (e as Error).message }); // no task content in logs
    }
  }
}

async function accountabilityFor(env: Env, userId: string, aiEnabled: boolean, now: Date) {
  const db = serviceClient(env);
  const { data: prefs } = await db.from('accountability_preferences').select('*').eq('user_id', userId).maybeSingle();
  if (!prefs?.enabled) return;
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [goals, actions, acc, feedback, nudges] = await Promise.all([
    db.from('goals').select('*').eq('user_id', userId).in('status', ['active']),
    db.from('actions').select('*').eq('user_id', userId).in('status', ['ready', 'in_progress']),
    db.from('accomplishments').select('*').eq('user_id', userId).gte('occurred_at', monthAgo),
    db.from('recommendation_feedback').select('action_id,goal_id,response,created_at').eq('user_id', userId).gte('created_at', monthAgo),
    db.from('nudges').select('goal_id,created_at,response').eq('user_id', userId).gte('created_at', monthAgo),
  ]);
  const candidates = findNudgeCandidates({
    goals: (goals.data ?? []) as Goal[],
    actions: (actions.data ?? []) as Action[],
    accomplishments: (acc.data ?? []) as Accomplishment[],
    feedback: (feedback.data ?? []) as FeedbackEntry[],
    recentNudges: nudges.data ?? [],
    inactivityDays: prefs.inactivity_days,
    maxNudgesPerWeek: prefs.max_nudges_per_week,
    now,
  });
  for (const c of candidates.slice(0, 1)) { // one per day at most
    let message = defaultNudgeMessage(c);
    if (aiEnabled) {
      try {
        message = (await nudgeMessage(env, userId, { goal_title: c.goal.title, why_it_matters: c.goal.meaning, days_since_progress: c.idleDays, other_recent_accomplishments: c.otherActivity })) ?? message;
      } catch { /* fall back to deterministic wording */ }
    }
    await db.from('nudges').insert({ user_id: userId, goal_id: c.goal.id, message });
  }
}

async function reflectionFor(env: Env, userId: string, aiEnabled: boolean, now: Date) {
  const db = serviceClient(env);
  const ws = startOfWeek(new Date(now.getTime() - 7 * 86_400_000));
  const { data: existing } = await db.from('weekly_reflections').select('id').eq('user_id', userId).eq('week_start', toISODate(ws)).maybeSingle();
  if (existing) return;
  const facts = await weeklyFacts(db, ws, userId);
  let summary: string | null = null;
  if (aiEnabled && facts.accomplishments > 0) {
    try {
      const out = await callStructured(env, {
        operation: 'generate_progress_summary', promptVersion: PROMPTS.generate_progress_summary.version,
        system: PROMPTS.generate_progress_summary.system, user: facts, jsonSchema: summarySchema,
        validator: ProgressSummaryOutput, maxOutputTokens: 700, userId,
      });
      summary = out.summary;
    } catch { /* facts alone are still useful */ }
  }
  await db.from('weekly_reflections').insert({ user_id: userId, week_start: facts.week_start, facts, summary });
}

async function emailDigestFor(env: Env, userId: string, aiEnabled: boolean) {
  const db = serviceClient(env);
  const { count } = await db.from('email_accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (!count) return;
  await syncAccounts(env, db, userId, { force: true });
  let aiTriaged = false;
  if (aiEnabled && env.OPENAI_API_KEY) {
    try { await triage(env, db, userId, 30); aiTriaged = true; } catch { /* rules below */ }
  }
  if (!aiTriaged) await triageWithRules(db, userId);
  await buildDigest(env, db, userId, { regenerate: true }, aiEnabled && !!env.OPENAI_API_KEY);
}
