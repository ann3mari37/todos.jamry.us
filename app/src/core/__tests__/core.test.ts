import { describe, expect, it } from 'vitest';
import { recommend, readyActions, goalProgress } from '../recommend';
import { findNudgeCandidates } from '../accountability';
import { fallbackInterpret } from '../fallback-capture';
import { InterpretCaptureOutput, DecomposeGoalOutput } from '../ai-contracts';
import type { Action, Goal } from '../types';

const NOW = new Date(2026, 9, 20, 9, 0); // Tue Oct 20 2026
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function goal(p: Partial<Goal> = {}): Goal {
  return {
    id: uuid(), life_area_id: null, title: 'Goal', description: null, meaning: null, meaning_source: 'none',
    deadline: null, deadline_type: 'none', status: 'active', completion_criteria: null, icon: 'target',
    accountability: 'default', snoozed_until: null, last_meaningful_progress_at: '2026-10-19T09:00:00Z',
    completed_at: null, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...p,
  };
}
function action(p: Partial<Action> = {}): Action {
  return {
    id: uuid(), goal_id: null, life_area_id: null, title: 'Action', notes: null, completion_criteria: null,
    estimated_minutes: 10, status: 'ready', origin: 'user', requires_clarification: false, user_edited: false,
    sort_order: 0, times_recommended: 0, times_skipped: 0, completed_at: null, created_at: '2026-10-01T00:00:00Z', ...p,
  };
}

describe('recommendation engine', () => {
  it('never recommends completed actions or actions of paused goals', () => {
    const paused = goal({ status: 'paused', meaning: 'matters' });
    const actions = [action({ goal_id: paused.id }), action({ status: 'completed' })];
    expect(recommend({ goals: [paused], actions, now: NOW })).toHaveLength(0);
  });

  it('does not present blocked actions (unmet dependency) as ready', () => {
    const g = goal({ meaning: 'Gets an obligation off my mind' });
    const a1 = action({ goal_id: g.id, title: 'Find doc', status: 'ready' });
    const a2 = action({ goal_id: g.id, title: 'Submit doc' });
    const ready = readyActions({ goals: [g], actions: [a1, a2], dependencies: [{ action_id: a2.id, depends_on_id: a1.id }], now: NOW });
    expect(ready.map((a) => a.title)).toEqual(['Find doc']);
    expect(recommend({ goals: [g], actions: [action({ goal_id: g.id, status: 'blocked' })], now: NOW })).toHaveLength(0);
  });

  it('keeps undated goals eligible and uses the user meaning as the reason', () => {
    const g = goal({ meaning: 'Gets a major obligation off my mind.', meaning_source: 'user' });
    const recs = recommend({ goals: [g], actions: [action({ goal_id: g.id, estimated_minutes: 40 })], now: NOW });
    expect(recs[0].kind).toBe('meaningful_move');
    expect(recs[0].reason).toBe('Gets a major obligation off my mind.');
  });

  it('surfaces hard deadlines factually', () => {
    const g = goal({ title: 'Renew insurance', deadline: '2026-10-23', deadline_type: 'hard' });
    const recs = recommend({ goals: [g], actions: [action({ goal_id: g.id }), action({ goal_id: g.id })], now: NOW });
    expect(recs[0].kind).toBe('time_sensitive');
    expect(recs[0].reason).toBe('Renew insurance is due Friday. 2 steps left.');
    expect(recs[0].reason).not.toMatch(/behind/i);
  });

  it('flags a meaningful goal that has been quiet, without blame', () => {
    const g = goal({ title: 'Organize the garage', meaning: 'Usable space', last_meaningful_progress_at: '2026-09-01T00:00:00Z' });
    const other = goal({ meaning: 'x', title: 'Other' });
    const recs = recommend({ goals: [other, g], actions: [action({ goal_id: other.id, estimated_minutes: 40 })], now: NOW });
    const q = recs.find((r) => r.kind === 'quietly_waiting');
    expect(q?.goal?.title).toBe('Organize the garage');
  });

  it('"show me something else" swaps the action out', () => {
    const a = action({ title: 'Wipe counter', estimated_minutes: 5 });
    const b = action({ title: 'Water plants', estimated_minutes: 5 });
    const first = recommend({ goals: [], actions: [a, b], now: NOW })[0];
    const second = recommend({ goals: [], actions: [a, b], now: NOW, excludeActionIds: [first.action!.id] })[0];
    expect(second.action!.id).not.toBe(first.action!.id);
  });

  it('respects rejected suggestions for a week', () => {
    const a = action({ estimated_minutes: 5 });
    const recs = recommend({ goals: [], actions: [a], now: NOW, feedback: [{ action_id: a.id, goal_id: null, response: 'not_suitable', created_at: '2026-10-19T00:00:00Z' }] });
    expect(recs).toHaveLength(0);
  });

  it('counts progress over confirmed actions only', () => {
    const g = goal();
    const acts = [action({ goal_id: g.id, status: 'completed' }), action({ goal_id: g.id }), action({ goal_id: g.id, status: 'suggested' })];
    expect(goalProgress(g.id, acts)).toEqual({ done: 1, total: 2 });
  });
});

describe('accountability', () => {
  const base = { feedback: [], recentNudges: [], inactivityDays: 10, maxNudgesPerWeek: 2, now: NOW };
  it('suppresses nudges for paused, waiting and do-not-remind goals', () => {
    const old = '2026-08-01T00:00:00Z';
    const goals = [
      goal({ status: 'paused', meaning: 'm', last_meaningful_progress_at: old }),
      goal({ status: 'waiting', meaning: 'm', last_meaningful_progress_at: old }),
      goal({ accountability: 'do_not_remind', meaning: 'm', last_meaningful_progress_at: old }),
    ];
    expect(findNudgeCandidates({ ...base, goals, actions: [], accomplishments: [] })).toHaveLength(0);
  });
  it('offers a nudge when other activity continues but a meaningful goal is idle', () => {
    const g = goal({ meaning: 'm', last_meaningful_progress_at: '2026-09-01T00:00:00Z' });
    const accomplishments = [{ id: uuid(), title: 'x', notes: null, goal_id: null, action_id: null, life_area_id: null, planned: false, meaningful: false, occurred_at: '2026-10-18T00:00:00Z', created_at: '2026-10-18T00:00:00Z' }];
    const c = findNudgeCandidates({ ...base, goals: [g], actions: [action({ goal_id: g.id })], accomplishments });
    expect(c).toHaveLength(1);
  });
  it('backs off after a recent nudge', () => {
    const g = goal({ meaning: 'm', last_meaningful_progress_at: '2026-09-01T00:00:00Z' });
    const c = findNudgeCandidates({ ...base, goals: [g], actions: [], accomplishments: [], recentNudges: [{ goal_id: g.id, created_at: '2026-10-15T00:00:00Z', response: 'dismiss' }] });
    expect(c).toHaveLength(0);
  });
});

describe('capture', () => {
  it('splits a brain dump into goals, actions and accomplishments without AI', () => {
    const r = fallbackInterpret('I need to submit that document, clean the garage, call the insurance company, and I already paid the electric bill.');
    expect(r.items.map((i) => i.kind)).toEqual(['goal', 'action', 'action', 'accomplishment']);
    expect(r.items[3].title).toBe('Paid the electric bill');
    expect(r.items[2].title).toBe('Call the insurance company');
  });
  it('rejects AI output with unexpected fields', () => {
    expect(InterpretCaptureOutput.safeParse({ items: [], questions: [], extra: 1 }).success).toBe(false);
    expect(DecomposeGoalOutput.safeParse({ goal_id: 'nope', suggested_actions: [], questions: [], uncertainty_note: null }).success).toBe(false);
  });
});
