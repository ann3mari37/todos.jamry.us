// Workload rules: what to do when too much is due at once (crunch), what to do with tasks that sit too long
// (tidy-up), and how healthy each project is. Pure functions, used by the app, the Worker and the AI connector.

import { daysSince, daysUntil, friendlyDate, toISODate } from './dates';
import { estimateMinutes, looksLikeProject } from './rules';
import type { Action, Goal } from './types';

/** Focused minutes a day the plan assumes is realistic. Crunch advice spreads work so no day goes over it. */
export const DAILY_CAPACITY = 120;

const OPEN: Action['status'][] = ['ready', 'in_progress', 'waiting', 'blocked'];

/** Minutes for a task: its estimate, else a guess from the wording, else 20. */
export function minutesOf(a: Pick<Action, 'estimated_minutes' | 'title'>): number {
  return a.estimated_minutes ?? estimateMinutes(a.title) ?? 20;
}

export function isSnoozed(a: Pick<Action, 'snoozed_until'>, now: Date = new Date()): boolean {
  return !!a.snoozed_until && daysUntil(a.snoozed_until, now) > 0;
}

/** Days a task has been sitting since it was added or last looked at in a tidy-up. */
export function idleDays(a: Pick<Action, 'created_at' | 'reviewed_at'>, now: Date = new Date()): number {
  const since = a.reviewed_at && a.reviewed_at > a.created_at ? a.reviewed_at : a.created_at;
  return daysSince(since, now) ?? 0;
}

const dateIn = (days: number, now: Date) => toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 >= 10 ? ` ${m % 60} min` : ''}`);

// ───────────────────────── Crunch: lots due at once

export interface DueItem {
  action: Action;
  goal: Goal | null;
  /** The date that makes it urgent: the task's own, or its project's deadline. */
  date: string;
  days: number;
  hard: boolean;
  minutes: number;
}

export interface Crunch {
  level: 'calm' | 'busy' | 'crunch';
  /** Everything overdue or due today/tomorrow, in the order to do it. */
  items: DueItem[];
  /** Hard deadlines: these stay. */
  mustDo: DueItem[];
  /** Target dates that don't fit in the next two days, each with a calmer day to move it to. */
  movable: { item: DueItem; to: string; label: string }[];
  totalMinutes: number;
  headline: string;
  advice: string;
}

/**
 * Looks at what is overdue or due today and tomorrow. Three or more things is "busy"; five or more, or more work
 * than two days hold (2 × DAILY_CAPACITY), is a "crunch".
 *
 * Order to work in: overdue first, then hard deadlines, soonest first, and the quickest first within the same day
 * (clearing small things fast brings the count down and makes room to think). Target dates are flexible by
 * definition, so the ones that don't fit are offered new days, filling each following day up to DAILY_CAPACITY.
 */
export function crunch(actions: Action[], goals: Goal[], now: Date = new Date(), capacity = DAILY_CAPACITY): Crunch {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const items: DueItem[] = [];
  for (const a of actions) {
    if (!['ready', 'in_progress'].includes(a.status) || isSnoozed(a, now)) continue;
    const g = a.goal_id ? goalById.get(a.goal_id) ?? null : null;
    if (g && g.status !== 'active') continue;
    if (a.due_date && a.deadline_type !== 'none') {
      const days = daysUntil(a.due_date, now);
      if (days <= 1 && days >= -30) items.push({ action: a, goal: g, date: a.due_date, days, hard: a.deadline_type === 'hard', minutes: minutesOf(a) });
    }
  }
  // Projects due by tomorrow: their next open step counts once.
  for (const g of goals) {
    if (g.status !== 'active' || !g.deadline || g.deadline_type === 'none' || items.some((i) => i.goal?.id === g.id)) continue;
    const days = daysUntil(g.deadline, now);
    if (days > 1 || days < -30) continue;
    const step = actions
      .filter((a) => a.goal_id === g.id && ['ready', 'in_progress'].includes(a.status) && !isSnoozed(a, now))
      .sort((x, y) => x.sort_order - y.sort_order)[0];
    if (step) { items.push({ action: step, goal: g, date: g.deadline, days, hard: g.deadline_type === 'hard', minutes: minutesOf(step) }); }
  }
  items.sort((x, y) => (x.days < 0 ? 0 : 1) - (y.days < 0 ? 0 : 1) || (x.hard ? 0 : 1) - (y.hard ? 0 : 1) || x.days - y.days || x.minutes - y.minutes);

  const totalMinutes = items.reduce((s, i) => s + i.minutes, 0);
  const level: Crunch['level'] = items.length >= 5 || totalMinutes > capacity * 2 ? 'crunch' : items.length >= 3 ? 'busy' : 'calm';
  const mustDo = items.filter((i) => i.hard);

  // Fill today and tomorrow with must-dos first, then target items in order; whatever doesn't fit moves.
  const load = new Map<number, number>(); // day offset → minutes planned
  const add = (day: number, m: number) => load.set(day, (load.get(day) ?? 0) + m);
  for (const i of mustDo) add(Math.max(0, i.days), i.minutes);
  const movable: Crunch['movable'] = [];
  for (const i of items.filter((x) => !x.hard)) {
    const day = Math.max(0, i.days);
    if ((load.get(day) ?? 0) + i.minutes <= capacity || level === 'calm') { add(day, i.minutes); continue; }
    let to = day + 1;
    while (to < 14 && (load.get(to) ?? 0) + i.minutes > capacity) to++;
    add(to, i.minutes);
    const date = dateIn(to, now);
    movable.push({ item: i, to: date, label: friendlyDate(date, now) });
  }

  const overdue = items.filter((i) => i.days < 0).length;
  const headline = level === 'calm' ? ''
    : `${items.length} things ${overdue ? `are overdue or due` : 'are due'} by tomorrow · about ${fmtMinutes(totalMinutes)}`;
  const advice = level === 'calm' ? ''
    : movable.length
      ? `${mustDo.length ? `Do the ${mustDo.length === 1 ? 'one with a real deadline' : `${mustDo.length} with real deadlines`} first, quickest first. ` : 'Start with the quickest. '}${movable.length} ${movable.length === 1 ? 'has' : 'have'} a flexible date and can move to a calmer day.`
      : mustDo.length === items.length
        ? 'These all have real deadlines. Start with the quickest to bring the number down, and ask for help or an extension early if one can’t happen.'
        : 'It fits, just. Start with the real deadlines, quickest first.';
  return { level, items, mustDo, movable, totalMinutes, headline, advice };
}

// ───────────────────────── Tidy-up: tasks that sit too long

export type StaleAdvice = 'follow_up' | 'make_project' | 'shrink' | 'let_go' | 'schedule';

export interface StaleTask {
  action: Action;
  goal: Goal | null;
  days: number;
  advice: StaleAdvice;
  why: string;
}

/**
 * Standalone tasks that have sat 21+ days (or were skipped 3+ times after a week), and tasks waiting on someone
 * for 14+ days. Snoozed tasks and ones looked at in a tidy-up restart their clock. Oldest first.
 *
 * Each gets one suggestion, first match wins:
 *   waiting → follow up · reads like several steps → make it a project · skipped 3+ times or over 45 min → shrink it
 *   60+ days → let it go? · otherwise → give it a day.
 */
export function staleTasks(actions: Action[], goals: Goal[], now: Date = new Date()): StaleTask[] {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const out: StaleTask[] = [];
  for (const a of actions) {
    if (!OPEN.includes(a.status) || isSnoozed(a, now)) continue;
    const g = a.goal_id ? goalById.get(a.goal_id) ?? null : null;
    const days = idleDays(a, now);
    const waiting = a.status === 'waiting';
    if (waiting ? days < 14 : g || (days < 21 && !(a.times_skipped >= 3 && days >= 7))) continue;
    if (g && g.status !== 'active') continue;
    let advice: StaleAdvice, why: string;
    if (waiting) { advice = 'follow_up'; why = `Waiting on someone for ${days} days. A nudge often closes it.`; }
    else if (looksLikeProject(a.title)) { advice = 'make_project'; why = 'This sounds like several steps. As a project it gets a small first step.'; }
    else if (a.times_skipped >= 3) { advice = 'shrink'; why = `Skipped ${a.times_skipped} times. A smaller first step might be easier to start.`; }
    else if (minutesOf(a) > 45) { advice = 'shrink'; why = `About ${fmtMinutes(minutesOf(a))}. Breaking it up makes it easier to start.`; }
    else if (days >= 60) { advice = 'let_go'; why = `On your list for ${days} days. It’s fine to let things go.`; }
    else { advice = 'schedule'; why = `On your list for ${days} days. Giving it a day stops it floating.`; }
    out.push({ action: a, goal: g, days, advice, why });
  }
  return out.sort((x, y) => y.days - x.days);
}

// ───────────────────────── Project health

export type HealthState = 'steps_done' | 'no_steps' | 'overdue' | 'at_risk' | 'all_waiting' | 'stalled' | 'almost_done' | 'on_track';

export interface ProjectHealth {
  state: HealthState;
  /** Short label for a pill. */
  label: string;
  /** One sentence explaining it. */
  message: string;
  tone: 'good' | 'info' | 'warn';
  openSteps: number;
  remainingMinutes: number;
  daysLeft: number | null;
  /** Minutes a day needed to finish by the deadline. */
  pacePerDay: number | null;
}

/**
 * One state per active project, most important first:
 *   all steps done (mark it complete?) · no next step · past its deadline · at risk (needs more than an hour a day,
 *   or more than 3 steps a day, to make the deadline) · everything left is waiting on others · stalled (no progress
 *   in `inactivityDays`) · almost done (≥60% and ≤2 left) · on track.
 */
export function projectHealth(goal: Goal, actions: Action[], now: Date = new Date(), inactivityDays = 10): ProjectHealth {
  const mine = actions.filter((a) => a.goal_id === goal.id && a.status !== 'dismissed' && a.status !== 'suggested');
  const open = mine.filter((a) => OPEN.includes(a.status));
  const done = mine.filter((a) => a.status === 'completed').length;
  const remainingMinutes = open.reduce((s, a) => s + minutesOf(a), 0);
  const daysLeft = goal.deadline && goal.deadline_type !== 'none' ? daysUntil(goal.deadline, now) : null;
  const daysToWork = daysLeft !== null ? Math.max(daysLeft, 0) + 1 : null;
  const pacePerDay = daysToWork ? Math.round(remainingMinutes / daysToWork) : null;
  const idle = daysSince(goal.last_meaningful_progress_at ?? goal.created_at, now) ?? 0;
  const base = { openSteps: open.length, remainingMinutes, daysLeft, pacePerDay };
  const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`;

  if (mine.length > 0 && open.length === 0) {
    return { ...base, state: 'steps_done', label: 'All steps done', tone: 'good', message: 'Every step is done. Mark the project complete, or add what’s still missing.' };
  }
  if (open.length === 0) {
    return { ...base, state: 'no_steps', label: 'Needs a first step', tone: 'info', message: 'There’s no next step yet, so it can’t show up on Today. Add one small step.' };
  }
  if (daysLeft !== null && daysLeft < 0) {
    return { ...base, state: 'overdue', label: 'Past its date', tone: 'warn',
      message: `It was due ${friendlyDate(goal.deadline!, now)} with ${steps(open.length)} left. Pick a new date${goal.deadline_type === 'hard' ? ' if you can, or ask for more time' : ''}, or trim what’s left.` };
  }
  if (daysLeft !== null && daysToWork && (remainingMinutes > 60 * daysToWork || open.length > 3 * daysToWork)) {
    return { ...base, state: 'at_risk', label: 'Tight on time', tone: 'warn',
      message: `${steps(open.length)} (about ${fmtMinutes(remainingMinutes)}) left and ${daysLeft === 0 ? 'it’s due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} to go`}: about ${fmtMinutes(pacePerDay!)} a day. ${goal.deadline_type === 'hard' ? 'Start today, and cut anything that isn’t essential.' : 'Consider moving the target date.'}` };
  }
  if (open.every((a) => a.status === 'waiting' || a.status === 'blocked')) {
    return { ...base, state: 'all_waiting', label: 'Waiting on others', tone: 'info', message: 'Everything left is waiting on someone else. A quick follow-up might unstick it.' };
  }
  if (idle >= inactivityDays) {
    return { ...base, state: 'stalled', label: `Quiet ${idle} days`, tone: 'info', message: `No progress in ${idle} days. One small step would wake it up, or pause it if now isn’t the time.` };
  }
  if (mine.length >= 2 && done / mine.length >= 0.6 && open.length <= 2) {
    return { ...base, state: 'almost_done', label: 'Almost done', tone: 'good', message: `Only ${steps(open.length)} left.` };
  }
  return { ...base, state: 'on_track', label: 'On track', tone: 'good', message: daysLeft !== null ? `${steps(open.length)} left, ${fmtMinutes(pacePerDay!)} a day keeps it on time.` : `${steps(open.length)} left.` };
}

/** Projects that need a decision, most urgent first (for Today and the AI connector). */
export function projectsNeedingAttention(goals: Goal[], actions: Action[], now: Date = new Date(), inactivityDays = 10) {
  const rank: HealthState[] = ['overdue', 'at_risk', 'steps_done', 'no_steps', 'all_waiting', 'stalled'];
  return goals
    .filter((g) => g.status === 'active')
    .map((g) => ({ goal: g, health: projectHealth(g, actions, now, inactivityDays) }))
    .filter((x) => rank.includes(x.health.state))
    .sort((x, y) => rank.indexOf(x.health.state) - rank.indexOf(y.health.state));
}

/** Calendar date `days` from today (local). */
export function inDays(days: number, now: Date = new Date()): string {
  return dateIn(days, now);
}
