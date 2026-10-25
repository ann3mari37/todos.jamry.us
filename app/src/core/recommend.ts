// Deterministic next-action engine.
// Runs on the device (instant, works offline / without AI) and in the Worker.
// AI may later rewrite the `reason` text, but never decides eligibility.

import { daysSince, daysUntil, friendlyDate } from './dates';
import { estimateMinutes, suggestWhy } from './rules';
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
  /** Filter: return every candidate of this one category, best first, instead of the mixed list. */
  onlyKind?: RecommendationKind | null;
  /** Actions the user asked to swap out ("Show me something else"). */
  excludeActionIds?: string[];
  /** Days without meaningful progress before a goal is "quietly waiting". */
  inactivityDays?: number;
  includePaused?: boolean;
  /** Used to word "why it matters" from the life area. */
  lifeAreas?: { id: string; name: string }[];
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

  const rested = restedActions(input, now);

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

function actionDueDays(a: Action, now: Date): number | null {
  return a.due_date && a.deadline_type !== 'none' ? daysUntil(a.due_date, now) : null;
}

/** Actions the user marked "not a good fit" or dismissed in the last 7 days rest for a week. */
function restedActions(input: RecommendInput, now: Date): Set<string> {
  return new Set(
    (input.feedback ?? [])
      .filter((f) => f.action_id && (f.response === 'not_suitable' || f.response === 'dismissed'))
      .filter((f) => (daysSince(f.created_at, now) ?? 99) < 7)
      .map((f) => f.action_id as string),
  );
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
  const areaOf = (a: Action | null) => (a ? a.life_area_id ?? goalOf(a)?.life_area_id ?? null : null);
  const areaName = (a: Action) => input.lifeAreas?.find((x) => x.id === areaOf(a))?.name ?? null;
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

  // ── Time-Sensitive: real dates only — task due dates and project deadlines. Overdue first, then hard, then soonest.
  //    Window: hard dates within 14 days (project) / 7 days (task); target dates within 5 / 3 days; overdue up to 30 days.
  const dated: { g: Goal | null; a: Action; d: number; hard: boolean; label: string; date: string; left: number | null }[] = [];
  for (const a of ready) {
    const d = actionDueDays(a, now);
    if (d === null) continue;
    const hard = a.deadline_type === 'hard';
    if (d < -30 || d > (hard ? 7 : 3)) continue;
    dated.push({ g: goalOf(a), a, d, hard, label: a.title, date: a.due_date!, left: null });
  }
  for (const g of input.goals) {
    if (!goalIsEligible(g, now, input.includePaused) || !isTimeSensitive(g, now)) continue;
    const a = firstStep(g.id);
    if (a && !dated.some((x) => x.a.id === a.id)) {
      dated.push({ g, a, d: deadlineDays(g, now)!, hard: g.deadline_type === 'hard', label: g.title, date: g.deadline!, left: remainingSteps(g.id, input.actions) });
    }
  }
  dated.sort((x, y) => (x.d < 0 ? 0 : 1) - (y.d < 0 ? 0 : 1) || (x.hard ? 0 : 1) - (y.hard ? 0 : 1) || x.d - y.d);
  const tsReason = (x: (typeof dated)[number]) => {
    const when = x.d < 0 ? `was due ${friendlyDate(x.date, now)}` : x.d === 0 ? 'is due today' : `is due ${friendlyDate(x.date, now)}`;
    const kindWord = x.hard ? '' : ' (target date)';
    const steps = x.left !== null ? ` ${x.left} step${x.left === 1 ? '' : 's'} left.` : minutes(x.a) <= 15 ? ` About ${minutes(x.a)} min.` : '';
    return `${x.label} ${when}${kindWord}.${steps}`;
  };
  const ts = dated[0];
  if (ts) take('time_sensitive', ts.g, ts.a, tsReason(ts), 100 - ts.d);

  // ── Meaningful Move: the project most worth a step today. Scored, highest wins:
  //    user-stated meaning +15 (suggested meaning +8) · "keep visible"/"help me" +10 · "I tend to avoid this" +12
  //    almost done (≥60% and ≤2 steps left) +12 · momentum (progress in the last 3 days) +6 · deadline 15–45 days out +6
  //    days since progress (max +14) · startable steps preferred · skipped suggestions lose points.
  const goalCandidates = ready
    .filter((a) => !usedActions.has(a.id) && a.goal_id && !usedGoals.has(a.goal_id))
    .map((a) => ({ a, g: goalOf(a) }))
    .filter((x): x is { a: Action; g: Goal } => !!x.g && firstStep(x.g.id)?.id === x.a.id) // a project's next step, in order
    .map(({ a, g }) => {
      const { done, total } = goalProgress(g.id, input.actions);
      const left = total - done;
      const sinceProgress = daysSince(g.last_meaningful_progress_at, now);
      const stale = daysSince(g.last_meaningful_progress_at ?? g.created_at, now) ?? 0;
      const due = deadlineDays(g, now);
      const almostDone = total >= 2 && done / total >= 0.6 && left <= 2;
      const momentum = sinceProgress !== null && sinceProgress <= 3;
      const dueSoonish = due !== null && due > 14 && due <= 45;
      let score = 30;
      if (g.meaning?.trim()) score += g.meaning_source === 'user' ? 15 : 8;
      if (g.accountability === 'help_me' || g.accountability === 'keep_visible') score += 10;
      if (g.accountability === 'i_avoid_this') score += 12;
      if (almostDone) score += 12;
      if (momentum) score += 6;
      if (dueSoonish) score += 6;
      score += Math.min(stale, 14);
      score -= skipPenalty(a);
      score -= Math.max(0, minutes(a) - 30) / 5;
      let reason: string;
      if (g.meaning?.trim()) reason = g.meaning.trim();
      else if (g.accountability === 'i_avoid_this') reason = "A small step on something that's easy to put off.";
      else if (almostDone) reason = `Only ${left} step${left === 1 ? '' : 's'} left on "${g.title}".`;
      else if (dueSoonish) reason = `"${g.title}" is due in ${due} days. A step now keeps it calm.`;
      else if (momentum) reason = `Keep the momentum going on "${g.title}".`;
      else reason = suggestWhy(g.title, { isProject: true, areaName: input.lifeAreas?.find((x) => x.id === g.life_area_id)?.name ?? null }) ?? `Moves "${g.title}" forward.`;
      return { a, g, score, reason };
    })
    .sort((x, y) => y.score - x.score);
  const mm = goalCandidates[0];
  if (mm) take('meaningful_move', mm.g, mm.a, mm.reason, mm.score);

  // ── Easy Momentum: one quick task (≤15 min; estimated from the wording when not set). Scored, highest wins:
  //    on the list a while (+1/day, max 10) · not part of a project +5 · a life area the other picks don't cover +4
  //    due within a week +3 · shorter is better · skipped suggestions lose points.
  const usedAreas = new Set(out.map((r) => areaOf(r.action)).filter(Boolean));
  const easy = ready
    .filter((a) => !usedActions.has(a.id) && minutes(a) <= 15)
    .map((a) => {
      const age = daysSince(a.created_at, now) ?? 0;
      const due = actionDueDays(a, now);
      const area = areaOf(a);
      const dueThisWeek = due !== null && due >= 0 && due <= 7;
      let score = 30 + Math.min(age, 10) - minutes(a) / 5 - skipPenalty(a);
      if (!a.goal_id) score += 5;
      if (a.goal_id && usedGoals.has(a.goal_id)) score -= 8; // prefer something from elsewhere
      if (area && !usedAreas.has(area)) score += 4;
      if (dueThisWeek) score += 3;
      const reason = dueThisWeek
        ? `Due ${friendlyDate(a.due_date!, now)} and only takes about ${minutes(a)} min.`
        : age >= 7 ? `On your list for ${age} days. About ${minutes(a)} min clears it.`
        : 'A quick win to create space.';
      return { a, score, reason };
    })
    .sort((x, y) => y.score - x.score)[0];
  if (easy) take('easy_momentum', goalOf(easy.a), easy.a, easy.reason, easy.score);

  // ── Quietly Waiting: something that has gone quiet, offered gently (never as failure). First match wins:
  //    1. a meaningful project idle ≥ inactivity days · 2. a task marked "waiting" for ≥ 5 days (time to follow up?)
  //    3. any active project idle ≥ 2× inactivity days · 4. a standalone task on the list ≥ 21 days ("still want it?")
  const quietGoal = (meaningfulOnly: boolean, minIdle: number) => input.goals
    .filter((g) => g.status === 'active' && goalIsEligible(g, now) && !usedGoals.has(g.id) && g.accountability !== 'do_not_remind'
      && (!meaningfulOnly || isMeaningful(g)))
    .map((g) => ({ g, idle: daysSince(g.last_meaningful_progress_at ?? g.created_at, now) ?? 0 }))
    .filter((x) => x.idle >= minIdle)
    .sort((x, y) => y.idle - x.idle)[0];
  const resting = restedActions(input, now);
  const followUp = input.actions
    .filter((a) => a.status === 'waiting' && !usedActions.has(a.id) && !resting.has(a.id))
    .map((a) => ({ a, days: daysSince(a.created_at, now) ?? 0 }))
    .filter((x) => x.days >= 5)
    .sort((x, y) => y.days - x.days)[0];
  const oldTask = ready
    .filter((a) => !a.goal_id && !usedActions.has(a.id))
    .map((a) => ({ a, days: daysSince(a.created_at, now) ?? 0 }))
    .filter((x) => x.days >= 21)
    .sort((x, y) => y.days - x.days)[0];
  const meaningfulQuiet = quietGoal(true, inactivity);
  const anyQuiet = quietGoal(false, inactivity * 2);
  if (meaningfulQuiet) {
    take('quietly_waiting', meaningfulQuiet.g, firstStep(meaningfulQuiet.g.id), "Hasn't made progress recently.", 20);
  } else if (followUp) {
    take('quietly_waiting', goalOf(followUp.a), followUp.a, `You've been waiting on this for ${followUp.days} days. Time to follow up?`, 19);
  } else if (anyQuiet && remainingSteps(anyQuiet.g.id, input.actions) > 0) {
    take('quietly_waiting', anyQuiet.g, firstStep(anyQuiet.g.id), `No progress in ${anyQuiet.idle} days. One small step would wake it up.`, 18);
  } else if (oldTask) {
    take('quietly_waiting', null, oldTask.a, `On your list for ${oldTask.days} days. Still want it?`, 17);
  }

  // ── Next Up: Today is never empty. When the categories above found fewer than 3, fill with what's next on the list:
  //    standalone tasks first, oldest first (they've waited longest), then next steps of projects.
  const nextUp = (exclude: Set<string>) => ready
    .filter((a) => !exclude.has(a.id))
    .sort((x, y) => (x.goal_id ? 1 : 0) - (y.goal_id ? 1 : 0) || x.created_at.localeCompare(y.created_at));
  const whyFor = (a: Action) => {
    const g = goalOf(a);
    return suggestWhy(a.title, { areaName: areaName(a), minutes: minutes(a), due: a.due_date ? { date: a.due_date, type: a.deadline_type ?? 'target' } : null, isProject: false })
      ?? (g ? `Next step on "${g.title}".` : `About ${minutes(a)} min.`);
  };

  // ── Filter row: one category, every candidate of it, best first. Uses the same rules as the mixed list.
  if (input.onlyKind) {
    const list: Recommendation[] = [];
    const add = (kind: RecommendationKind, g: Goal | null, a: Action | null, reason: string, score: number) => {
      if (list.length < 8 && !(a && list.some((r) => r.action?.id === a.id)) && !(!a && g && list.some((r) => r.goal?.id === g.id))) {
        list.push({ kind, goal: g, action: a, reason, score });
      }
    };
    const base = { ...input, onlyKind: null };
    switch (input.onlyKind) {
      case 'time_sensitive':
        for (const x of dated) add('time_sensitive', x.g, x.a, tsReason(x), 100 - x.d);
        break;
      case 'meaningful_move':
        return recommend({ ...base, mode: 'meaningful' }).slice(0, 8);
      case 'easy_momentum':
        return recommend({ ...base, mode: 'small_tasks' });
      case 'quietly_waiting': {
        const quiet = input.goals
          .filter((g) => g.status === 'active' && goalIsEligible(g, now) && g.accountability !== 'do_not_remind')
          .map((g) => ({ g, idle: daysSince(g.last_meaningful_progress_at ?? g.created_at, now) ?? 0 }))
          .sort((x, y) => y.idle - x.idle);
        for (const q of quiet.filter((x) => isMeaningful(x.g) && x.idle >= inactivity)) add('quietly_waiting', q.g, firstStep(q.g.id), "Hasn't made progress recently.", 20);
        for (const a of input.actions.filter((x) => x.status === 'waiting' && !resting.has(x.id))) {
          const days = daysSince(a.created_at, now) ?? 0;
          if (days >= 3) add('quietly_waiting', goalOf(a), a, `You've been waiting on this for ${days} days. Time to follow up?`, 19);
        }
        for (const q of quiet.filter((x) => !isMeaningful(x.g) && x.idle >= inactivity * 2)) {
          if (remainingSteps(q.g.id, input.actions) > 0) add('quietly_waiting', q.g, firstStep(q.g.id), `No progress in ${q.idle} days. One small step would wake it up.`, 18);
        }
        for (const a of ready.filter((x) => !x.goal_id).sort((x, y) => x.created_at.localeCompare(y.created_at))) {
          const days = daysSince(a.created_at, now) ?? 0;
          if (days >= 14) add('quietly_waiting', null, a, `On your list for ${days} days. Still want it?`, 17);
        }
        break;
      }
      case 'next_up':
        for (const a of nextUp(new Set())) add('next_up', goalOf(a), a, whyFor(a), 10);
        break;
    }
    return list;
  }

  // ── Day types reshape the whole list (3–5 suggestions each) instead of adding a couple of extras.
  if (input.mode === 'small_tasks') {
    // The quickest things available, shortest first.
    return ready
      .filter((a) => minutes(a) <= 15 && !(input.excludeActionIds ?? []).includes(a.id))
      .sort((x, y) => minutes(x) - minutes(y) || x.created_at.localeCompare(y.created_at))
      .slice(0, 5)
      .map((a) => ({ kind: 'easy_momentum' as const, goal: goalOf(a), action: a, reason: `About ${minutes(a)} min.`, score: 30 }));
  }
  if (input.mode === 'meaningful') {
    // Next steps on the projects that matter most, then bigger standalone tasks, each with why it matters.
    const picks: Recommendation[] = [];
    const seenGoals = new Set<string>();
    for (const c of goalCandidates) {
      if (picks.length >= 3 || seenGoals.has(c.g.id)) continue;
      seenGoals.add(c.g.id);
      picks.push({ kind: 'meaningful_move', goal: c.g, action: c.a, reason: c.reason, score: c.score });
    }
    if (mm && !seenGoals.has(mm.g.id)) picks.unshift({ kind: 'meaningful_move', goal: mm.g, action: mm.a, reason: mm.reason, score: mm.score });
    const big = ready
      .filter((a) => !a.goal_id && minutes(a) > 15 && !picks.some((p) => p.action?.id === a.id))
      .sort((x, y) => x.created_at.localeCompare(y.created_at));
    for (const a of big) {
      if (picks.length >= 5) break;
      picks.push({ kind: 'meaningful_move', goal: null, action: a, reason: whyFor(a), score: 25 });
    }
    return picks.slice(0, 5);
  }
  if (input.mode === 'off_my_mind') {
    // Overdue things, then follow-ups on what you're waiting for, then whatever has sat longest.
    const picks: Recommendation[] = [];
    const used = new Set<string>();
    const push = (r: Recommendation) => { if (r.action && !used.has(r.action.id) && picks.length < 5) { used.add(r.action.id); picks.push(r); } };
    for (const a of ready.filter((x) => (actionDueDays(x, now) ?? 1) < 0).sort((x, y) => (x.due_date ?? '').localeCompare(y.due_date ?? ''))) {
      push({ kind: 'time_sensitive', goal: goalOf(a), action: a, reason: `Was due ${friendlyDate(a.due_date!, now)}. Clearing it takes it off your mind.`, score: 40 });
    }
    for (const a of input.actions.filter((x) => x.status === 'waiting' && !resting.has(x.id))) {
      const days = daysSince(a.created_at, now) ?? 0;
      if (days >= 3) push({ kind: 'quietly_waiting', goal: goalOf(a), action: a, reason: `Waiting for ${days} days. A quick follow-up could close it.`, score: 30 });
    }
    for (const a of nextUp(used)) {
      const days = daysSince(a.created_at, now) ?? 0;
      push({ kind: 'next_up', goal: goalOf(a), action: a, reason: days >= 2 ? `On your list for ${days} days. Done is lighter than waiting.` : 'Clearing it frees up headspace.', score: 20 });
    }
    return picks;
  }

  const shown = new Set(out.map((r) => r.action?.id).filter(Boolean) as string[]);
  // A mix: one from each category that has something, then Next Up so there are at least 4 to choose from.
  const fillTo = input.mode === 'show_all' ? 12 : 4;
  for (const a of nextUp(shown)) {
    if (out.length >= fillTo) break;
    take('next_up', goalOf(a), a, whyFor(a), 10);
  }
  return out;
}

export const KIND_LABEL: Record<RecommendationKind, string> = {
  meaningful_move: 'Meaningful Move',
  time_sensitive: 'Time-Sensitive',
  easy_momentum: 'Easy Momentum',
  quietly_waiting: 'Quietly Waiting',
  next_up: 'Next Up',
};
