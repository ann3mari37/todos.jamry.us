import { describe, expect, it } from 'vitest';
import { recommend } from '../recommend';
import type { Action, Goal } from '../types';
import { crunch, projectHealth, staleTasks } from '../workload';

const now = new Date('2026-10-26T15:00:00');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const date = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let seq = 0;
const act = (title: string, p: Partial<Action> = {}): Action => ({
  id: `a${++seq}`, goal_id: null, life_area_id: null, title, notes: null, completion_criteria: null, estimated_minutes: 15, status: 'ready',
  origin: 'user', requires_clarification: false, user_edited: false, sort_order: seq, times_recommended: 0, times_skipped: 0,
  completed_at: null, created_at: daysAgo(1), due_date: null, deadline_type: 'none', ...p,
});
const goal = (title: string, p: Partial<Goal> = {}): Goal => ({
  id: `g${++seq}`, life_area_id: null, title, description: null, meaning: null, meaning_source: 'none', deadline: null, deadline_type: 'none',
  status: 'active', completion_criteria: null, icon: 'target', accountability: 'default', snoozed_until: null,
  last_meaningful_progress_at: daysAgo(1), completed_at: null, archived_at: null, created_at: daysAgo(5), updated_at: daysAgo(1), ...p,
});
const due = (title: string, days: number, hard: boolean, minutes = 15) => act(title, { due_date: date(days), deadline_type: hard ? 'hard' : 'target', estimated_minutes: minutes });

describe('crunch: lots due at once', () => {
  it('stays calm with one or two things due', () => {
    expect(crunch([due('Pay rent', 1, true), due('Call Julie', 0, false)], [], now).level).toBe('calm');
  });

  it('orders overdue, then hard deadlines, then quickest first, and moves flexible dates that do not fit', () => {
    const items = [
      due('Write the report', 1, false, 90), due('Pay rent', 1, true, 10), due('File taxes', 1, true, 60),
      due('Call Julie', 1, false, 10), due('Renew registration', -1, true, 15), due('Plan party', 1, false, 60),
    ];
    const c = crunch(items, [], now);
    expect(c.level).toBe('crunch');
    expect(c.items.map((i) => i.action.title)).toEqual(['Renew registration', 'Pay rent', 'File taxes', 'Call Julie', 'Plan party', 'Write the report']);
    expect(c.mustDo.map((i) => i.action.title)).toEqual(['Renew registration', 'Pay rent', 'File taxes']);
    // Hard ones never move; flexible ones that overflow today/tomorrow's 2h each get later days.
    expect(c.movable.every((m) => !m.item.hard)).toBe(true);
    expect(c.movable.map((m) => m.item.action.title)).toContain('Write the report');
    expect(c.movable.every((m) => m.to > date(1))).toBe(true);
    expect(c.headline).toMatch(/^6 things are overdue or due by tomorrow/);
  });

  it('when everything is a real deadline it says so instead of moving anything', () => {
    const c = crunch([1, 2, 3, 4, 5].map((n) => due(`Hard ${n}`, 1, true, 20)), [], now);
    expect(c.movable).toEqual([]);
    expect(c.advice).toMatch(/all have real deadlines/);
  });

  it('counts a project due tomorrow once, through its next step', () => {
    const g = goal('Launch site', { deadline: date(1), deadline_type: 'hard' });
    const c = crunch([act('Write copy', { goal_id: g.id, sort_order: 1 }), act('Publish', { goal_id: g.id, sort_order: 2 })], [g], now);
    expect(c.items.map((i) => i.action.title)).toEqual(['Write copy']);
  });

  it('ignores snoozed and finished tasks', () => {
    const c = crunch([due('A', 0, true), due('B', 0, true), { ...due('C', 0, true), snoozed_until: date(3) }, { ...due('D', 0, true), status: 'completed' }], [], now);
    expect(c.items.length).toBe(2);
  });
});

describe('tasks that sit too long', () => {
  it('finds standalone tasks 21+ days old, oldest first, each with one suggestion', () => {
    const list = staleTasks([
      act('Fresh', { created_at: daysAgo(3) }),
      act('Renew passport', { created_at: daysAgo(30) }),
      act('Build a garden shed', { created_at: daysAgo(25), estimated_minutes: null }),
      act('Clean gutters', { created_at: daysAgo(70) }),
      act('Big essay', { created_at: daysAgo(22), estimated_minutes: 120 }),
      act('Hear back from landlord', { created_at: daysAgo(15), status: 'waiting' }),
      act('Avoided thing', { created_at: daysAgo(9), times_skipped: 4 }),
    ], [], now);
    expect(list.map((s) => [s.action.title, s.advice])).toEqual([
      ['Clean gutters', 'let_go'], ['Renew passport', 'schedule'], ['Build a garden shed', 'make_project'],
      ['Big essay', 'shrink'], ['Hear back from landlord', 'follow_up'], ['Avoided thing', 'shrink'],
    ]);
  });

  it('restarts the clock after a tidy-up or snooze', () => {
    expect(staleTasks([act('Old', { created_at: daysAgo(40), reviewed_at: daysAgo(2) })], [], now)).toEqual([]);
    expect(staleTasks([act('Old', { created_at: daysAgo(40), snoozed_until: date(10) })], [], now)).toEqual([]);
  });

  it('leaves project steps to project health', () => {
    const g = goal('Garden');
    expect(staleTasks([act('Dig bed', { goal_id: g.id, created_at: daysAgo(40) })], [g], now)).toEqual([]);
  });

  it('keeps snoozed tasks off Today', () => {
    const recs = recommend({ goals: [], actions: [act('Snoozed one', { snoozed_until: date(5) }), act('Visible one')], now });
    expect(recs.map((r) => r.action?.title)).toEqual(['Visible one']);
  });
});

describe('project health', () => {
  it('spots a project whose steps are all done', () => {
    const g = goal('Paint room');
    expect(projectHealth(g, [act('Buy paint', { goal_id: g.id, status: 'completed' })], now).state).toBe('steps_done');
  });

  it('spots a project with no steps', () => {
    expect(projectHealth(goal('Malinda app'), [], now).state).toBe('no_steps');
  });

  it('flags overdue and at-risk deadlines with the pace needed', () => {
    const late = goal('Taxes', { deadline: date(-2), deadline_type: 'hard' });
    expect(projectHealth(late, [act('Gather forms', { goal_id: late.id })], now).state).toBe('overdue');
    const tight = goal('Move', { deadline: date(1), deadline_type: 'target' });
    const steps = [1, 2, 3, 4, 5, 6, 7].map((n) => act(`Pack ${n}`, { goal_id: tight.id, estimated_minutes: 30 }));
    const h = projectHealth(tight, steps, now);
    expect(h.state).toBe('at_risk');
    expect(h.pacePerDay).toBe(105);
    expect(h.message).toMatch(/moving the target date/);
  });

  it('notices waiting, stalled and almost-done projects', () => {
    const w = goal('Visa');
    expect(projectHealth(w, [act('Hear back', { goal_id: w.id, status: 'waiting' })], now).state).toBe('all_waiting');
    const s = goal('Novel', { last_meaningful_progress_at: daysAgo(20) });
    expect(projectHealth(s, [act('Outline', { goal_id: s.id })], now).state).toBe('stalled');
    const a = goal('Website');
    const steps = [act('1', { goal_id: a.id, status: 'completed' }), act('2', { goal_id: a.id, status: 'completed' }), act('3', { goal_id: a.id, status: 'completed' }), act('4', { goal_id: a.id })];
    expect(projectHealth(a, steps, now).state).toBe('almost_done');
  });
});
