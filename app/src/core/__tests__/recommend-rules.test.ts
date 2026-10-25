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
  it('says "due today" and ignores target dates more than 7 days out', () => {
    const today = action({ title: 'Submit form', due_date: '2026-10-20', deadline_type: 'hard', estimated_minutes: 40 });
    expect(pick(recommend({ goals: [], actions: [today], now: NOW }), 'time_sensitive')?.reason).toBe('Submit form is due today.');
    const later = action({ title: 'Plan dinner', due_date: '2026-10-30', deadline_type: 'target' });
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

describe('Next Up and day types', () => {
  // Like the user's real list: standalone, undated, new tasks that fit no category.
  const mine = () => [
    action({ title: 'Update my crm', estimated_minutes: null, created_at: '2026-10-19T10:00:00Z', life_area_id: 'work' }),
    action({ title: 'Clean my laundry', estimated_minutes: null, created_at: '2026-10-19T10:01:00Z' }),
    action({ title: 'Cook dinner', estimated_minutes: null, created_at: '2026-10-19T10:02:00Z' }),
    action({ title: 'Create a project management app for Malinda', estimated_minutes: null, created_at: '2026-10-19T10:03:00Z', life_area_id: 'work' }),
  ];
  const areas = [{ id: 'work', name: 'Work' }];

  it('never leaves Today empty: a mix of at least 4, filled with Next Up', () => {
    const recs = recommend({ goals: [], actions: mine(), now: NOW, lifeAreas: areas });
    expect(recs).toHaveLength(4);
    expect(recs.some((r) => r.kind === 'easy_momentum')).toBe(true);
    expect(recs.filter((r) => r.kind === 'next_up').length).toBeGreaterThan(0);
  });
  it('"A few small tasks" lists the quickest things only', () => {
    const recs = recommend({ goals: [], actions: mine(), now: NOW, mode: 'small_tasks' });
    expect(recs.map((r) => r.action?.title)).toEqual(['Update my crm', 'Clean my laundry']);
    expect(recs.every((r) => r.kind === 'easy_momentum')).toBe(true);
  });
  it('"Move something meaningful" offers bigger tasks with why they matter', () => {
    const recs = recommend({ goals: [], actions: mine(), now: NOW, mode: 'meaningful', lifeAreas: areas });
    const app = recs.find((r) => r.action?.title.startsWith('Create a project'));
    expect(app?.reason).toBe('Turns an idea into something real.');
    expect(recs.find((r) => r.action?.title === 'Cook dinner')).toBeTruthy();
    expect(recs.find((r) => r.action?.title === 'Clean my laundry')).toBeUndefined(); // quick → not "meaningful" mode
  });
  it('"Get something off my mind" leads with overdue, then waiting, then oldest', () => {
    const overdue = action({ title: 'Return package', due_date: '2026-10-15', deadline_type: 'target' });
    const waiting = action({ title: 'Hear back from landlord', status: 'waiting', created_at: '2026-10-14T00:00:00Z' });
    const recs = recommend({ goals: [], actions: [...mine(), overdue, waiting], now: NOW, mode: 'off_my_mind' });
    expect(recs.slice(0, 2).map((r) => r.action?.title)).toEqual(['Return package', 'Hear back from landlord']);
    expect(recs).toHaveLength(5);
  });
  it('"Show me what\'s available" lists everything ready', () => {
    expect(recommend({ goals: [], actions: mine(), now: NOW, mode: 'show_all' })).toHaveLength(4);
  });
});

describe('filter row (one category)', () => {
  const g = goal({ title: 'Launch website', meaning: 'My business', meaning_source: 'user' });
  const all = () => [
    action({ title: 'Pay rent', due_date: '2026-10-22', deadline_type: 'hard' }),
    action({ title: 'Return book', due_date: '2026-10-19', deadline_type: 'target' }),
    action({ title: 'Write headline', goal_id: g.id, estimated_minutes: 40 }),
    action({ title: 'Wipe counter', estimated_minutes: 5 }),
    action({ title: 'Call dentist', estimated_minutes: 10 }),
    action({ title: 'Hear back from landlord', status: 'waiting', created_at: '2026-10-12T00:00:00Z' }),
  ];
  it('the mixed list covers several categories', () => {
    const kinds = new Set(recommend({ goals: [g], actions: all(), now: NOW }).map((r) => r.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
  it('Time-sensitive lists every dated task, overdue first', () => {
    const recs = recommend({ goals: [g], actions: all(), now: NOW, onlyKind: 'time_sensitive' });
    expect(recs.map((r) => r.action?.title)).toEqual(['Return book', 'Pay rent']);
  });
  it('Quick wins lists all the short tasks', () => {
    const recs = recommend({ goals: [g], actions: all(), now: NOW, onlyKind: 'easy_momentum' });
    expect(recs.map((r) => r.action?.title).sort()).toEqual(['Call dentist', 'Pay rent', 'Return book', 'Wipe counter'].sort());
  });
  it('Waiting lists follow-ups', () => {
    const recs = recommend({ goals: [g], actions: all(), now: NOW, onlyKind: 'quietly_waiting' });
    expect(recs[0].action?.title).toBe('Hear back from landlord');
  });
  it('every filtered item is of the chosen kind', () => {
    for (const kind of ['time_sensitive', 'meaningful_move', 'easy_momentum', 'quietly_waiting', 'next_up'] as const) {
      expect(recommend({ goals: [g], actions: all(), now: NOW, onlyKind: kind }).every((r) => r.kind === kind)).toBe(true);
    }
  });
});

describe('mockup-style mix', () => {
  it('shows one of each kind, in mockup order, for a plain list of standalone tasks', () => {
    const tasks = [
      action({ title: 'Update my crm', estimated_minutes: null, created_at: '2026-10-14T10:00:00Z' }),
      action({ title: 'Clean my laundry', estimated_minutes: null, created_at: '2026-10-14T10:00:00Z' }),
      action({ title: 'Cook dinner', estimated_minutes: null, created_at: '2026-10-19T10:00:00Z' }),
      action({ title: 'Pay rent', estimated_minutes: 10, due_date: '2026-10-25', deadline_type: 'target', created_at: '2026-10-19T10:00:00Z' }),
      action({ title: 'Write a business plan', estimated_minutes: 90, created_at: '2026-10-19T10:00:00Z' }),
    ];
    const recs = recommend({ goals: [], actions: tasks, now: NOW });
    expect(recs.map((r) => r.kind)).toEqual(['meaningful_move', 'time_sensitive', 'easy_momentum', 'quietly_waiting']);
    expect(recs[0].action?.title).toBe('Write a business plan');
    expect(recs[3].reason).toBe('On your list for 6 days. A small step would move it along.');
  });
});
