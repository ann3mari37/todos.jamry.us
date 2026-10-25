// Deterministic next-action engine.
// Runs on the device (instant, works offline / without AI) and in the Worker.
// AI may later rewrite the `reason` text, but never decides eligibility.

import { daysSince, daysUntil, friendlyDate } from './dates';
import { estimateMinutes } from './rules';
import type {
  Action,
  DailyMode,
  Dependency,
  FeedbackEntry,
  Goal,
  Recommendation,
  RecommendationKind,
} from './types';

export interface RecommendInput {
  goals: Goal[];
  actions: Action[];
  dependencies?: Dependency[];
  feedback?: FeedbackEntry[];
  now?: Date;
  mode?: DailyMode | null;
  /** Actions the user asked to swap out ("Show me something else"). */
  excludeActionIds?: string[];
  /** Days without meaningful progress before a goal is "quietly waiting". */
  inactivityDays?: number;
  includePaused?: boolean;
}

const ACTIONABLE: Action['status'][] = ['ready', 'in_progress'];
const OPEN: Action['status'][] = ['suggested', 'ready', 'in_progress', 'waiting', 'blocked'];

export function goalIsEligible(g: Goal, now: Date, includePaused = false): boolean {
  if (g.status === 'paused') return includePaused;
  if (g.status !== 'active') return false;
  if (g.snoozed_until && new Date(g.snoozed_until) > now) return false;
  return true;
}

export function isMeaningful(g: Goal): boolean {
  return (
    !!(g.meaning && g.meaning.trim()) ||
    g.accountability === 'keep_visible' ||
    g.accountability === 'help_me' ||
    g.accountability === 'i_avoid_this'
  );
}

export function remainingSteps(goalId: string, actions: Action[]): number {
  return actions.filter((a) => a.goal_id === goalId && OPEN.includes(a.status) && a.status !== 'suggested').length;
}

export function goalProgress(goalId: string, actions: Action[]): { done: number; total: number } {
  const mine = actions.filter((a) => a.goal_id === goalId && a.status !== 'dismissed' && a.status !== 'suggested');
  return { done: mine.filter((a) => a.status === 'completed').length, total: mine.length };
}

/** Actions whose dependencies are all completed and whose own status is actionable. */
export function readyActions(input: RecommendInput): Action[] {
  const now = input.now ?? new Date();
  const byId = new Map(input.actions.map((a) => [a.id, a]));
  const goalById = new Map(input.goals.map((g) => [g.id, g]));
  const deps = input.dependencies ?? [];
  const exclude = new Set(input.excludeActionIds ?? []);

  // Actions recently marked unsuitable are rested for a week.
  const rested = new Set(
    (input.feedback ?? [])
      .filter((f) => f.action_id && (f.response === 'not_suitable' || f.response === 'dismissed'))
      .filter((f) => (daysSince(f.created_at, now) ?? 99) < 7)
      .map((f) => f.action_id as string),
  );

  return input.actions.filter((a) => {
    if (!ACTIONABLE.includes(a.status)) return false;
    if (exclude.has(a.id) || rested.has(a.id)) return false;
    if (a.goal_id) {
      const g = goalById.get(a.goal_id);
      if (!g || !goalIsEligible(g, now, input.includePaused)) return false;
    }
    return deps
      .filter((d) => d.action_id === a.id)
      .every((d) => byId.get(d.depends_on_id)?.status === 'completed');
  });
}

function minutes(a: Action): number {
  // Unestimated tasks get a guess from their wording, so quick ones ("Call…", "Reply…") can still be suggested.
  return a.estimated_minutes ?? estimateMinutes(a.title) ?? 20;
}

function deadlineDays(g: Goal | null | undefined, now: Date): number | null {
  if (!g || !g.deadline || g.deadline_type === 'none') return null;
  return daysUntil(g.deadline, now);
}

function isTimeSensitive(g: Goal | null | undefined, now: Date): boolean {
  const d = deadlineDays(g, now);
  if (d === null || !g) return false;
  return g.deadline_type === 'hard' ? d <= 14 : d <= 5;
}

function minutesLabel(a: Action | null): string {
  return a?.estimated_minutes ? `${a.estimated_minutes} min` : '';
}

export function recommend(input: RecommendInput): Recommendation[] {
  const now = input.now ?? new Date();
  const goalById = new Map(input.goals.map((g) => [g.id, g]));
  const ready = readyActions(input);
  const inactivity = input.inactivityDays ?? 10;
  const usedActions = new Set<string>();
  const usedGoals = new Set<string>();
  const out: Recommendation[] = [];

  const goalOf = (a: Action) => (a.goal_id ? goalById.get(a.goal_id) ?? null : null);
  const skipPenalty = (a: Action) => Math.min(a.times_skipped, 5) * 3;
  // First ready step of a goal (by sort order), so goals advance in order.
  const firstStep = (goalId: string) =>
    ready
      .filter((a) => a.goal_id === goalId && !usedActions.has(a.id))
      .sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at))[0] ?? null;

  const take = (kind: RecommendationKind, goal: Goal | null, action: Action | null, reason: string, score: number) => {
    if (action) usedActions.add(action.id);
    if (goal) usedGoals.add(goal.id);
    out.push({ kind, goal, action, reason, score });
  };

  // ── Time-Sensitive: real deadlines only.
  const timeSensitive = input.goals
    .filter((g) => goalIsEligible(g, now, input.includePaused) && isTimeSensitive(g, now))
    .map((g) => ({ g, d: deadlineDays(g, now)!, a: firstStep(g.id) }))
    .filter((x) => x.a)
    .sort((x, y) => (x.g.deadline_type === 'hard' ? 0 : 1) - (y.g.deadline_type === 'hard' ? 0 : 1) || x.d - y.d);
  const ts = timeSensitive[0];
  if (ts) {
    const left = remainingSteps(ts.g.id, input.actions);
    const when = ts.d < 0 ? `was due ${friendlyDate(ts.g.deadline!, now)}` : `is due ${friendlyDate(ts.g.deadline!, now)}`;
    const kindWord = ts.g.deadline_type === 'hard' ? '' : ' (target date)';
    take(
      'time_sensitive',
      ts.g,
      ts.a,
      `${ts.g.title} ${when}${kindWord}. ${left} step${left === 1 ? '' : 's'} left.`,
      100 - ts.d,
    );
  }

  // ── Meaningful Move: something the user said matters.
  const meaningfulCandidates = ready
    .filter((a) => !usedActions.has(a.id))
    .map((a) => ({ a, g: goalOf(a) }))
    .filter((x): x is { a: Action; g: Goal } => !!x.g && isMeaningful(x.g) && !usedGoals.has(x.g.id))
    .map(({ a, g }) => {
      const stale = daysSince(g.last_meaningful_progress_at ?? g.created_at, now) ?? 0;
      let score = 50;
      if (g.meaning_source === 'user') score += 15;
      if (g.accountability === 'help_me' || g.accountability === 'keep_visible') score += 10;
      score += Math.min(stale, 14);
      score -= skipPenalty(a);
      score -= Math.max(0, minutes(a) - 30) / 5; // prefer startable steps
      return { a, g, score };
    })
    .sort((x, y) => y.score - x.score);
  // Fall back to any goal-linked action so goals still move when no meaning was given.
  const anyGoalCandidate = ready
    .filter((a) => !usedActions.has(a.id) && a.goal_id && !usedGoals.has(a.goal_id))
    .sort((x, y) => skipPenalty(x) - skipPenalty(y) || x.sort_order - y.sort_order)[0];
  const mm = meaningfulCandidates[0] ?? (anyGoalCandidate ? { a: anyGoalCandidate, g: goalOf(anyGoalCandidate)!, score: 40 } : null);
  if (mm) {
    const why = mm.g.meaning?.trim();
    take('meaningful_move', mm.g, mm.a, why ? why : `Moves "${mm.g.title}" forward.`, mm.score);
  }

  // ── Easy Momentum: a small, useful thing.
  const easy = ready
    .filter((a) => !usedActions.has(a.id) && minutes(a) <= 15)
    .sort((x, y) => {
      // Prefer something from a different goal than what's already shown.
      const xg = x.goal_id && usedGoals.has(x.goal_id) ? 1 : 0;
      const yg = y.goal_id && usedGoals.has(y.goal_id) ? 1 : 0;
      return xg - yg || minutes(x) - minutes(y) || skipPenalty(x) - skipPenalty(y);
    })[0];
  if (easy) take('easy_momentum', goalOf(easy), easy, 'A quick win to create space.', 30);

  // ── Quietly Waiting: meaningful goal that hasn't moved. Never framed as failure.
  const waiting = input.goals
    .filter(
      (g) =>
        g.status === 'active' &&
        goalIsEligible(g, now) &&
        !usedGoals.has(g.id) &&
        g.accountability !== 'do_not_remind' &&
        isMeaningful(g),
    )
    .map((g) => ({ g, idle: daysSince(g.last_meaningful_progress_at ?? g.created_at, now) ?? 0 }))
    .filter((x) => x.idle >= inactivity)
    .sort((x, y) => y.idle - x.idle)[0];
  if (waiting) {
    take('quietly_waiting', waiting.g, firstStep(waiting.g.id), "Hasn't made progress recently.", 20);
  }

  // ── Mode shaping. Modes change emphasis, never add obligations.
  if (input.mode === 'small_tasks') {
    const more = ready
      .filter((a) => !usedActions.has(a.id) && minutes(a) <= 15)
      .sort((x, y) => minutes(x) - minutes(y))
      .slice(0, 2);
    for (const a of more) take('easy_momentum', goalOf(a), a, 'Small and doable.', 25);
    return out.sort((x, y) => (x.kind === 'easy_momentum' ? -1 : 0) - (y.kind === 'easy_momentum' ? -1 : 0));
  }
  if (input.mode === 'off_my_mind') {
    // Lingering items: oldest open standalone actions.
    const lingering = ready
      .filter((a) => !usedActions.has(a.id))
      .sort((x, y) => x.created_at.localeCompare(y.created_at))
      .slice(0, 2);
    for (const a of lingering) take('easy_momentum', goalOf(a), a, 'Been on your list a while. Clearing it frees up headspace.', 22);
  }
  if (input.mode === 'show_all') {
    for (const a of ready.filter((x) => !usedActions.has(x.id)).slice(0, 6)) {
      take(goalOf(a) ? 'meaningful_move' : 'easy_momentum', goalOf(a), a, minutesLabel(a) || 'Available now.', 10);
    }
  }
  if (input.mode === 'meaningful') {
    out.sort((x, y) => (x.kind === 'meaningful_move' ? -1 : 0) - (y.kind === 'meaningful_move' ? -1 : 0));
  }
  return out;
}

export const KIND_LABEL: Record<RecommendationKind, string> = {
  meaningful_move: 'Meaningful Move',
  time_sensitive: 'Time-Sensitive',
  easy_momentum: 'Easy Momentum',
  quietly_waiting: 'Quietly Waiting',
};
