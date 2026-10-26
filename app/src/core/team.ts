// Teams: who a step belongs to, and turning "Malinda" / "coach" / "me" into an assignment. Shared by the app and the
// AI connector, so both read assignments the same way.

import type { Action, Goal, TeamMember, TeamMemberRole, TeamRole } from './types';

export interface TeamData {
  members: TeamMember[];
  roles: TeamRole[];
  memberRoles: TeamMemberRole[];
}

export const EMPTY_TEAM: TeamData = { members: [], roles: [], memberRoles: [] };

/** Role ids a person holds in a team. */
export function rolesOf(userId: string, teamId: string, t: TeamData): string[] {
  return t.memberRoles.filter((r) => r.user_id === userId && r.team_id === teamId).map((r) => r.role_id);
}

/**
 * Whether a task is this person's to do. Personal tasks are; on a team project a step is theirs when it is assigned to
 * them, or open to a role they hold, or (with nobody and no role on it) when the project is theirs.
 */
export function isMine(a: Pick<Action, 'goal_id' | 'assignee_id' | 'assigned_role_id' | 'user_id'>, goals: Pick<Goal, 'id' | 'team_id' | 'user_id'>[], me: string, t: TeamData): boolean {
  const g = a.goal_id ? goals.find((x) => x.id === a.goal_id) : null;
  if (!g?.team_id) return !a.user_id || a.user_id === me;
  if (a.assignee_id) return a.assignee_id === me;
  if (a.assigned_role_id) return rolesOf(me, g.team_id, t).includes(a.assigned_role_id);
  return g.user_id === me;
}

/** "Malinda", "Developer · open", or null when nothing is set. */
export function assigneeLabel(a: Pick<Action, 'assignee_id' | 'assigned_role_id'>, t: TeamData, me?: string): string | null {
  if (a.assignee_id) {
    if (a.assignee_id === me) return 'You';
    return t.members.find((m) => m.user_id === a.assignee_id)?.display_name ?? 'Teammate';
  }
  if (a.assigned_role_id) {
    const r = t.roles.find((x) => x.id === a.assigned_role_id);
    return r ? `${r.name} · open` : null;
  }
  return null;
}

export type Assignment = { assignee_id: string | null; assigned_role_id: string | null };

/**
 * Reads who should do a step on a team: "me", "none", a member's name (or the start of it) or a role name. A person
 * wins over a role with the same word. Returns an error listing the choices when nothing matches.
 */
export function resolveAssignee(input: string, teamId: string, me: string, t: TeamData): Assignment | { error: string } {
  const q = input.trim().toLowerCase();
  if (!q || q === 'none' || q === 'nobody' || q === 'unassigned') return { assignee_id: null, assigned_role_id: null };
  const members = t.members.filter((m) => m.team_id === teamId);
  const roles = t.roles.filter((r) => r.team_id === teamId);
  if (['me', 'myself', 'i'].includes(q) && members.some((m) => m.user_id === me)) return { assignee_id: me, assigned_role_id: null };
  const name = (m: TeamMember) => m.display_name.toLowerCase();
  const person = members.find((m) => name(m) === q) ?? members.find((m) => name(m).split(/\s+/)[0] === q) ?? members.find((m) => name(m).startsWith(q));
  if (person) return { assignee_id: person.user_id, assigned_role_id: null };
  const role = roles.find((r) => r.name.toLowerCase() === q) ?? roles.find((r) => r.name.toLowerCase().startsWith(q) || q.startsWith(r.name.toLowerCase()));
  if (role) return { assignee_id: null, assigned_role_id: role.id };
  const people = members.map((m) => m.display_name).join(', ') || 'nobody yet';
  const roleNames = roles.map((r) => r.name).join(', ') || 'none yet';
  return { error: `No one on this team matches "${input}". People: ${people}. Roles: ${roleNames}.` };
}

export interface TeamUpdates {
  /** Teammates' steps finished recently on projects you share, newest first. */
  finished: { action: Action; by: string; goal: Pick<Goal, 'id' | 'title'> | null }[];
  /** Your steps that were waiting on a teammate's step and can start now. */
  unblocked: Action[];
  /** Your steps still waiting on a teammate's step, with whose. */
  waiting: { action: Action; on: Action; who: string }[];
}

/**
 * What your team did that matters to you: recent finishes on shared projects, and your steps that waited on them.
 * Only reads; nothing here changes your own suggestions.
 */
export function teamUpdates(input: {
  all: Action[]; goals: Pick<Goal, 'id' | 'title' | 'team_id'>[]; dependencies: { action_id: string; depends_on_id: string }[];
  me: string; team: TeamData; now?: Date; days?: number;
}): TeamUpdates {
  const { all, goals, dependencies, me, team } = input;
  const since = (input.now ?? new Date()).getTime() - (input.days ?? 3) * 86_400_000;
  const byId = new Map(all.map((a) => [a.id, a]));
  const name = (id: string | null | undefined) => team.members.find((m) => m.user_id === id)?.display_name ?? 'A teammate';
  const shared = new Set(goals.filter((g) => g.team_id).map((g) => g.id));
  const OPEN = ['ready', 'in_progress', 'waiting', 'blocked'];
  const finished = all
    .filter((a) => a.status === 'completed' && a.completed_by && a.completed_by !== me && a.goal_id && shared.has(a.goal_id)
      && a.completed_at && new Date(a.completed_at).getTime() >= since)
    .sort((x, y) => (y.completed_at ?? '').localeCompare(x.completed_at ?? ''))
    .map((a) => ({ action: a, by: name(a.completed_by), goal: goals.find((g) => g.id === a.goal_id) ?? null }));
  const mine = all.filter((a) => OPEN.includes(a.status) && isMine(a, goals as Goal[], me, team));
  const unblocked: Action[] = [];
  const waiting: TeamUpdates['waiting'] = [];
  for (const a of mine) {
    const on = dependencies.filter((d) => d.action_id === a.id).map((d) => byId.get(d.depends_on_id)).filter((x): x is Action => !!x);
    const theirs = on.filter((b) => b.completed_by !== me && !isMine(b, goals as Goal[], me, team));
    if (!theirs.length) continue;
    const open = theirs.find((b) => b.status !== 'completed');
    if (open) waiting.push({ action: a, on: open, who: open.assignee_id ? name(open.assignee_id) : assigneeLabel(open, team) ?? 'a teammate' });
    else if (on.every((b) => b.status === 'completed') && theirs.some((b) => b.completed_at && new Date(b.completed_at).getTime() >= since)) unblocked.push(a);
  }
  return { finished, unblocked, waiting };
}
