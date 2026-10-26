import { describe, expect, it } from 'vitest';
import { assigneeLabel, isMine, resolveAssignee, teamUpdates, type TeamData } from '../team';

const team: TeamData = {
  members: [
    { team_id: 't1', user_id: 'malinda', display_name: 'Malinda Perry', is_admin: true, joined_at: '' },
    { team_id: 't1', user_id: 'anne', display_name: 'AnneMarie', is_admin: false, joined_at: '' },
  ],
  roles: [
    { id: 'coach', team_id: 't1', name: 'Coach', description: null },
    { id: 'dev', team_id: 't1', name: 'Developer', description: null },
  ],
  memberRoles: [
    { team_id: 't1', user_id: 'malinda', role_id: 'coach' },
    { team_id: 't1', user_id: 'anne', role_id: 'dev' },
  ],
};
const goals = [
  { id: 'team-goal', team_id: 't1', user_id: 'malinda' },
  { id: 'own-goal', team_id: null, user_id: 'anne' },
];

describe('isMine', () => {
  it('keeps personal tasks personal', () => {
    expect(isMine({ goal_id: 'own-goal', user_id: 'anne' }, goals, 'anne', team)).toBe(true);
    expect(isMine({ goal_id: null, user_id: 'anne' }, goals, 'anne', team)).toBe(true);
  });
  it('gives a team step to its assignee only', () => {
    const step = { goal_id: 'team-goal', user_id: 'malinda', assignee_id: 'anne' };
    expect(isMine(step, goals, 'anne', team)).toBe(true);
    expect(isMine(step, goals, 'malinda', team)).toBe(false);
  });
  it('gives an open role step to whoever holds the role', () => {
    const step = { goal_id: 'team-goal', user_id: 'malinda', assigned_role_id: 'dev' };
    expect(isMine(step, goals, 'anne', team)).toBe(true);
    expect(isMine(step, goals, 'malinda', team)).toBe(false);
  });
  it('leaves an unassigned team step with the project owner', () => {
    const step = { goal_id: 'team-goal', user_id: 'anne' };
    expect(isMine(step, goals, 'malinda', team)).toBe(true);
    expect(isMine(step, goals, 'anne', team)).toBe(false);
  });
});

describe('resolveAssignee', () => {
  it('matches people by full name, first name or start', () => {
    expect(resolveAssignee('Malinda Perry', 't1', 'anne', team)).toEqual({ assignee_id: 'malinda', assigned_role_id: null });
    expect(resolveAssignee('malinda', 't1', 'anne', team)).toEqual({ assignee_id: 'malinda', assigned_role_id: null });
    expect(resolveAssignee('anne', 't1', 'malinda', team)).toEqual({ assignee_id: 'anne', assigned_role_id: null });
  });
  it('matches roles, me and none', () => {
    expect(resolveAssignee('coach', 't1', 'anne', team)).toEqual({ assignee_id: null, assigned_role_id: 'coach' });
    expect(resolveAssignee('Developers', 't1', 'anne', team)).toEqual({ assignee_id: null, assigned_role_id: 'dev' });
    expect(resolveAssignee('me', 't1', 'anne', team)).toEqual({ assignee_id: 'anne', assigned_role_id: null });
    expect(resolveAssignee('none', 't1', 'anne', team)).toEqual({ assignee_id: null, assigned_role_id: null });
  });
  it('lists the choices when nothing matches', () => {
    const r = resolveAssignee('Bob', 't1', 'anne', team);
    expect('error' in r && r.error).toContain('People: Malinda Perry, AnneMarie. Roles: Coach, Developer.');
  });
});

describe('assigneeLabel', () => {
  it('names the person, you, or the open role', () => {
    expect(assigneeLabel({ assignee_id: 'malinda' }, team, 'anne')).toBe('Malinda Perry');
    expect(assigneeLabel({ assignee_id: 'anne' }, team, 'anne')).toBe('You');
    expect(assigneeLabel({ assigned_role_id: 'coach' }, team)).toBe('Coach · open');
    expect(assigneeLabel({}, team)).toBeNull();
  });
});

describe('teamUpdates', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const shared = [{ id: 'team-goal', title: 'Build the review system', team_id: 't1', user_id: 'malinda' }];
  const step = (p: Record<string, unknown>) => ({ id: String(p.id), goal_id: 'team-goal', user_id: 'malinda', title: String(p.id), status: 'ready', completed_at: null, completed_by: null, ...p }) as never;
  it('lists teammates finishing their steps, and your step it unblocked', () => {
    const form = step({ id: 'form', assignee_id: 'anne', status: 'completed', completed_by: 'anne', completed_at: '2026-10-26T09:00:00Z' });
    const questions = step({ id: 'questions', assignee_id: 'malinda' });
    const u = teamUpdates({ all: [form, questions], goals: shared, dependencies: [{ action_id: 'questions', depends_on_id: 'form' }], me: 'malinda', team, now });
    expect(u.finished.map((f) => `${f.by}: ${f.action.title}`)).toEqual(['AnneMarie: form']);
    expect(u.unblocked.map((a) => a.id)).toEqual(['questions']);
    expect(u.waiting).toEqual([]);
  });
  it('says who you are still waiting on, and skips your own finishes', () => {
    const form = step({ id: 'form', assigned_role_id: 'dev' });
    const mineDone = step({ id: 'gift', assignee_id: 'malinda', status: 'completed', completed_by: 'malinda', completed_at: '2026-10-26T09:00:00Z' });
    const questions = step({ id: 'questions', assignee_id: 'malinda' });
    const u = teamUpdates({ all: [form, mineDone, questions], goals: shared, dependencies: [{ action_id: 'questions', depends_on_id: 'form' }], me: 'malinda', team, now });
    expect(u.finished).toEqual([]);
    expect(u.waiting.map((w) => `${w.action.id} ← ${w.who}`)).toEqual(['questions ← Developer · open']);
  });
});
