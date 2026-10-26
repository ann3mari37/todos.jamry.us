// Parked projects: ideas waiting to be worked out. They stay out of Today and the task lists until they're due to be
// looked at again (a revisit date), or until something the person is planning matches "revisit when…".

import { toISODate } from './dates';
import type { Goal } from './types';

type Parked = Pick<Goal, 'id' | 'title' | 'status' | 'revisit_on' | 'revisit_when'>;

/** Parked projects whose revisit date has come, soonest first. */
export function dueToRevisit<G extends Parked>(goals: G[], now: Date = new Date()): G[] {
  const today = toISODate(now);
  return goals
    .filter((g) => g.status === 'parked' && !!g.revisit_on && g.revisit_on <= today)
    .sort((a, b) => (a.revisit_on ?? '').localeCompare(b.revisit_on ?? ''));
}

/** "Revisit Nov 9 · after the review system launches", "Revisit when the budget is set", or "No revisit date". */
export function revisitLabel(g: Pick<Goal, 'revisit_on' | 'revisit_when'>, now: Date = new Date()): string {
  const parts: string[] = [];
  if (g.revisit_on) {
    const d = new Date(`${g.revisit_on}T12:00:00`);
    parts.push(g.revisit_on <= toISODate(now) ? 'Ready to revisit' : `Revisit ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  }
  if (g.revisit_when) parts.push(g.revisit_on ? g.revisit_when : `Revisit when ${g.revisit_when.replace(/^when\s+/i, '')}`);
  return parts.join(' · ') || 'No revisit date';
}

/** A date `days` from now, for "check again in 2 weeks". */
export function revisitIn(days: number, now: Date = new Date()): string {
  return toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}
