import { describe, expect, it } from 'vitest';
import { recommend } from '../recommend';
import type { Action, Goal } from '../types';

const NOW = new Date(2026, 9, 20, 9, 0); // Tue Oct 20 2026
let n = 0;
const id = () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const goal = (p: Partial<Goal> = {}): Goal => ({
  id: id(), life_area_id: null, title: 'Goal', description: null, meaning: null, meaning_source: 'none', deadline: null, deadline_type: 'none',
  status: 'active', completion_criteria: null, icon: 'target', accountability: 'default', snoozed_until: null,
  last_meaningful_progress_at: '2026-10-19T09:00:00Z', completed_at: null, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...p,
});
const action = (p: Partial<Action> = {}): Action => ({
  id: id(), goal_id: null, life_area_id: null, title: 'Action', notes: null, completion_criteria: null, estimated_minutes: 10,
  due_date: null, deadline_type: 'none', status: 'ready', origin: 'user', requires_clarification: false, user_edited: false,
  sort_order: 0, times_recommended: 0, times_skipped: 0, completed_at: null, created_at: '2026-10-18T00:00:00Z', ...p,
});
const pick = (recs: ReturnType<typeof recommend>, kind: string) => recs.find((r) => r.kind === kind);

describe('Time-Sensitive', () => {
  it('uses task due dates, overdue first', () => {
    const soon = action({ title: 'Pay rent', due_date: '2026-10-23', deadline_type: 'hard' });
    const late = action({ title: 'Return library book', due_date: '2026-10-18', deadline_type: 'target' });
    const r = pick(recommend({ goals: [], actions: [soon, late], now: NOW }), 'time_sensitive');
    expect(r?.action?.title).toBe('Return library book');
    expect(r?.reason).toBe('Return library book was due Oct 18 (target date). About 10 min.');
  });
  it('says "due today" and ignores target dates more than 3 days out', () => {
    const today = action({ title: 'Submit form', due_date: '2026-10-20', deadline_type: 'hard', estimated_minutes: 40 });
    expect(pick(recommend({ goals: [], actions: [today], now: NOW }), 'time_sensitive')?.reason).toBe('Submit form is due today.');
    const later = action({ title: 'Plan dinner', due_date: '2026-10-26', deadline_type: 'target' });
    expect(pick(recommend({ goals: [], actions: [later], now: NOW }), 'time_sensitive')).toBeUndefined();
  });
});

describe('Meaningful Move', () => {
  it('prefers a project that is almost done and says so', () => {
    const near = goal({ title: 'Launch website' });
    const fresh = goal({ title: 'Plan trip' });
    const actions = [
      ...[1, 2, 3, 4].map(() => action({ goal_id: near.id, status: 'completed' })),
      action({ goal_id: near.id, title: 'Proofread pages', estimated_minutes: 40 }),
      action({ goal_id: fresh.id, title: 'Look at flights', estimated_minutes: 40 }),
    ];
    const r = pick(recommend({ goals: [fresh, near], actions, now: NOW }), 'meaningful_move');
    expect(r?.goal?.title).toBe('Launch website');
    expect(r?.reason).toBe('Only 1 step left on "Launch website".');
  });
  it('offers a small step on things the user tends to avoid', () => {
    const g = goal({ title: 'Do taxes', accountability: 'i_avoid_this' });
    const r = pick(recommend({ goals: [g], actions: [action({ goal_id: g.id, estimated_minutes: 40 })], now: NOW }), 'meaningful_move');
    expect(r?.reason).toBe("A small step on something that's easy to put off.");
  });
  it('only suggests the next step of a project, in order', () => {
    const g = goal({ title: 'Paint garage' });
    const first = action({ goal_id: g.id, title: 'Buy paint', sort_order: 0, estimated_minutes: 40 });
    const second = action({ goal_id: g.id, title: 'Paint walls', sort_order: 1, estimated_minutes: 120 });
    expect(pick(recommend({ goals: [g], actions: [second, first], now: NOW }), 'meaningful_move')?.action?.title).toBe('Buy paint');
  });
});

describe('Easy Momentum', () => {
  it('picks a quick lingering task and says how long it has waited', () => {
    const old = action({ title: 'Call the dentist', estimated_minutes: null, created_at: '2026-10-08T00:00:00Z' });
    const fresh = action({ title: 'Wipe counter', estimated_minutes: 5, created_at: '2026-10-20T08:00:00Z' });
    const r = pick(recommend({ goals: [], actions: [fresh, old], now: NOW }), 'easy_momentum');
    expect(r?.action?.title).toBe('Call the dentist');
    expect(r?.reason).toBe('On your list for 12 days. About 10 min clears it.');
  });
  it('never offers long tasks as easy momentum', () => {
    expect(pick(recommend({ goals: [], actions: [action({ title: 'Write report', estimated_minutes: 90 })], now: NOW }), 'easy_momentum')).toBeUndefined();
  });
});

describe('Quietly Waiting', () => {
  it('suggests following up on something marked waiting for 5+ days', () => {
    const w = action({ title: 'Hear back from landlord', status: 'waiting', created_at: '2026-10-10T00:00:00Z' });
    const r = pick(recommend({ goals: [], actions: [w], now: NOW }), 'quietly_waiting');
    expect(r?.reason).toBe("You've been waiting on this for 10 days. Time to follow up?");
  });
  it('wakes up any project idle for twice the inactivity period', () => {
    const g = goal({ title: 'Learn Spanish', last_meaningful_progress_at: '2026-09-25T00:00:00Z' });
    const busy = goal({ title: 'Work project', meaning: 'Pays the bills', meaning_source: 'user' });
    const actions = [action({ goal_id: g.id, estimated_minutes: 40 }), action({ goal_id: busy.id, estimated_minutes: 40 })];
    const r = pick(recommend({ goals: [busy, g], actions, now: NOW, inactivityDays: 10 }), 'quietly_waiting');
    expect(r?.goal?.title).toBe('Learn Spanish');
    expect(r?.reason).toBe('No progress in 25 days. One small step would wake it up.');
  });
  it('asks gently about standalone tasks that have sat for 3+ weeks', () => {
    const quick = action({ title: 'Water plants', estimated_minutes: 5 });
    const stale = action({ title: 'Sort old photos', estimated_minutes: 60, created_at: '2026-09-20T00:00:00Z' });
    const r = pick(recommend({ goals: [], actions: [quick, stale], now: NOW }), 'quietly_waiting');
    expect(r?.reason).toBe('On your list for 30 days. Still want it?');
    expect(r?.reason).not.toMatch(/behind|fail|should/i);
  });
});
