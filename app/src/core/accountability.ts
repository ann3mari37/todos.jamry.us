// Gentle accountability: finds goals that *might* deserve a kind check-in.
// Produces opportunities, never judgments. Inactivity alone is not procrastination.

import { daysSince } from './dates';
import { goalIsEligible, isMeaningful, readyActions } from './recommend';
import type { Accomplishment, Action, FeedbackEntry, Goal } from './types';

export interface NudgeCandidate {
  goal: Goal;
  idleDays: number;
  deferrals: number;
  otherActivity: number;
  reason: 'long_idle' | 'repeated_deferral' | 'user_requested';
}

export interface AccountabilityInput {
  goals: Goal[];
  actions: Action[];
  accomplishments: Accomplishment[];
  feedback: FeedbackEntry[];
  recentNudges: { goal_id: string | null; created_at: string; response: string | null }[];
  inactivityDays: number;
  maxNudgesPerWeek: number;
  now?: Date;
}

export function findNudgeCandidates(input: AccountabilityInput): NudgeCandidate[] {
  const now = input.now ?? new Date();
  const weekNudges = input.recentNudges.filter((n) => (daysSince(n.created_at, now) ?? 99) < 7);
  if (weekNudges.length >= input.maxNudgesPerWeek) return [];

  const ready = readyActions({ goals: input.goals, actions: input.actions, now });
  const out: NudgeCandidate[] = [];

  for (const g of input.goals) {
    // Waiting, blocked, paused, snoozed, or "don't remind" goals are never nudged.
    if (g.status !== 'active' || !goalIsEligible(g, now) || g.accountability === 'do_not_remind') continue;
    if (!isMeaningful(g)) continue;

    // Back off: no repeat for 14 days after a nudge on this goal; 30 if dismissed.
    const last = input.recentNudges
      .filter((n) => n.goal_id === g.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (last) {
      const ago = daysSince(last.created_at, now) ?? 99;
      if (ago < (last.response === 'dismiss' || last.response === 'not_important' ? 30 : 14)) continue;
    }

    const idle = daysSince(g.last_meaningful_progress_at ?? g.created_at, now) ?? 0;
    const threshold = g.accountability === 'i_avoid_this' || g.accountability === 'help_me'
      ? Math.max(2, Math.floor(input.inactivityDays / 2))
      : input.inactivityDays;
    const deferrals = input.feedback.filter(
      (f) => f.goal_id === g.id && (f.response === 'deferred' || f.response === 'dismissed') &&
        (daysSince(f.created_at, now) ?? 99) < 14,
    ).length;
    const otherActivity = input.accomplishments.filter(
      (a) => a.goal_id !== g.id && (daysSince(a.occurred_at, now) ?? 99) < idle,
    ).length;
    const hasNextStep = ready.some((a) => a.goal_id === g.id);

    if (idle >= threshold && (otherActivity > 0 || !hasNextStep)) {
      out.push({ goal: g, idleDays: idle, deferrals, otherActivity, reason: deferrals >= 3 ? 'repeated_deferral' : g.accountability === 'i_avoid_this' ? 'user_requested' : 'long_idle' });
    } else if (deferrals >= 3) {
      out.push({ goal: g, idleDays: idle, deferrals, otherActivity, reason: 'repeated_deferral' });
    }
  }

  return out.sort((a, b) => b.idleDays - a.idleDays).slice(0, Math.max(0, input.maxNudgesPerWeek - weekNudges.length));
}

/** Deterministic, shame-free fallback wording when AI is off. */
export function defaultNudgeMessage(c: NudgeCandidate): string {
  const lead = c.otherActivity > 0 ? "You've accomplished quite a bit lately. " : '';
  return `${lead}"${c.goal.title}" hasn't moved recently. Want help finding a smaller next step?`;
}
