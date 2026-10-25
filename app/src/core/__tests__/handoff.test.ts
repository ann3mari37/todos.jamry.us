import { describe, expect, it } from 'vitest';
import { draftsToCommit, handoffToDrafts, HandoffItem } from '../handoff';

const areas = [
  { id: 'home', name: 'Home', archived_at: null },
  { id: 'health', name: 'Health', archived_at: null },
  { id: 'fin', name: 'Finances', archived_at: null },
  { id: 'old', name: 'Old stuff', archived_at: '2026-01-01' },
];
const goals = [{ id: 'g-move', title: 'Move to the new apartment' }];
const now = new Date('2026-10-26T15:00:00Z');

describe('chat handoffs', () => {
  it('keeps what the chat decided and fills the gaps with rules', () => {
    const [task, project, done] = handoffToDrafts([
      { kind: 'task', title: 'Pay the electric bill', due_date: '2026-10-30', hard_deadline: true, minutes: 5, area: 'finances' },
      { kind: 'project', title: 'Plan a trip to Portland', why: 'A real break' },
      { kind: 'done', title: 'Booked the movers', project: 'Move' },
    ], areas, goals, now);
    expect(task).toMatchObject({ kind: 'action', deadline: '2026-10-30', deadline_type: 'hard', estimated_minutes: 5, suggested_life_area_id: 'fin' });
    expect(project).toMatchObject({ kind: 'goal', meaning: 'A real break', estimated_minutes: null });
    expect(project.next_actions.length).toBeGreaterThanOrEqual(2);
    expect(done).toMatchObject({ kind: 'accomplishment', suggested_goal_id: 'g-move', suggested_life_area_id: null, deadline: null });
  });

  it('reads dates out of titles, files by keywords and matches projects by shared words', () => {
    const [julie, dentist, boxes] = handoffToDrafts([
      { kind: 'task', title: 'Call Julie about the lease by tomorrow' },
      { kind: 'task', title: 'Book a dentist cleaning' },
      { kind: 'task', title: 'Buy boxes for the move' },
    ], areas, goals, now);
    expect(julie.title).toBe('Call Julie about the lease');
    expect(julie.deadline).toBe('2026-10-27');
    expect(dentist.suggested_life_area_id).toBe('health');
    expect(boxes.suggested_goal_id).toBe('g-move');
  });

  it('never files into archived areas and uses the chat’s steps when given', () => {
    const [p] = handoffToDrafts([{ kind: 'project', title: 'Clear out old stuff', area: 'Old stuff', steps: [{ title: 'Pick one drawer' }, { title: 'Donate the bag', minutes: 20 }] }], areas, goals, now);
    expect(p.suggested_life_area_id).not.toBe('old');
    expect(p.next_actions.map((s) => s.title)).toEqual(['Pick one drawer', 'Donate the bag']);
    expect(p.next_actions[1].estimated_minutes).toBe(20);
  });

  it('converts reviewed drafts into the commit payload', () => {
    const drafts = handoffToDrafts([{ kind: 'project', title: 'Plan a trip', why: 'Rest' }, { kind: 'task', title: 'Renew passport', due_date: '2026-11-20' }], areas, goals, now);
    const commit = draftsToCommit(drafts.map((d, i) => ({ ...d, client_id: `00000000-0000-4000-8000-00000000000${i}` })));
    expect(commit[0]).toMatchObject({ kind: 'goal', goal_id: null, meaning: 'Rest' });
    expect(commit[1]).toMatchObject({ kind: 'action', deadline: '2026-11-20', deadline_type: 'target', next_actions: [] });
  });

  it('does not join projects on a shared everyday verb', () => {
    const [car] = handoffToDrafts([{ kind: 'task', title: 'Renew the car registration' }], areas, [{ id: 'g-ins', title: 'Renew insurance' }], now);
    expect(car.suggested_goal_id).toBeNull();
  });

  it('validates what chats send', () => {
    expect(HandoffItem.safeParse({ kind: 'task', title: '' }).success).toBe(false);
    expect(HandoffItem.safeParse({ kind: 'task', title: 'x', due_date: 'Friday' }).success).toBe(false);
    expect(HandoffItem.safeParse({ kind: 'project', title: 'Launch', steps: Array(6).fill({ title: 's' }) }).success).toBe(false);
  });
});
