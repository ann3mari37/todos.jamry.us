// Chat handoffs: what an AI chat sends through the Momentum connector, and how the rules turn it into capture items.
// Shared by the Worker (which stores the handoff) and the app (which shows it for review).

import { z } from 'zod';
import type { CaptureItem, CommitItem } from './ai-contracts';
import { estimateMinutes, guessLifeArea, matchProject, parseDue, stripDue, suggestWhy, type AreaLike } from './rules';
import { suggestSteps } from './templates';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const minutes = z.number().int().min(1).max(600);

export const HandoffStep = z.object({ title: z.string().trim().min(1).max(200), minutes: minutes.optional() });

export const HandoffItem = z.object({
  kind: z.enum(['task', 'project', 'done', 'note']).describe('task = one action; project = an outcome with several steps; done = something already finished; note = context for a project'),
  title: z.string().trim().min(1).max(200),
  why: z.string().trim().max(500).optional().describe('Why it matters to the person, in their own words when possible'),
  due_date: isoDate.optional(),
  hard_deadline: z.boolean().optional().describe('true when the date cannot move (bill, appointment, filing deadline)'),
  minutes: minutes.optional().describe('Estimated minutes for a task'),
  area: z.string().trim().max(60).optional().describe('Life area name, e.g. Home, Work, Health'),
  project: z.string().trim().max(200).optional().describe('Existing project this belongs to (title or id)'),
  steps: z.array(HandoffStep).max(5).optional().describe('First steps for a project'),
  from_email: z.string().uuid().optional().describe('The email (id from get_inbox) this came from; the task links back to it'),
});
export type HandoffItem = z.infer<typeof HandoffItem>;

/** A reviewable item: a capture item plus the "why it matters" text that goes on projects. */
export type HandoffDraft = CaptureItem & { meaning: string; source_email_id?: string | null };

/** Stored in capture_entries.interpretation for source 'chat'. */
export interface HandoffInterpretation {
  version: 1;
  summary: string;
  client: string | null;
  items: HandoffDraft[];
}

type GoalLike = { id: string; title: string };
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function findArea(name: string | undefined, areas: AreaLike[]): string | null {
  if (!name) return null;
  const n = clean(name);
  const live = areas.filter((a) => !a.archived_at);
  return live.find((a) => clean(a.name) === n)?.id
    ?? live.find((a) => clean(a.name).startsWith(n) || n.startsWith(clean(a.name)))?.id
    ?? guessLifeArea(name, live);
}

function findProject(ref: string | undefined, goals: GoalLike[]): string | null {
  if (!ref) return null;
  const byId = goals.find((g) => g.id === ref);
  if (byId) return byId.id;
  const n = clean(ref);
  return goals.find((g) => clean(g.title) === n)?.id
    ?? goals.find((g) => clean(g.title).includes(n) || n.includes(clean(g.title)))?.id
    ?? matchProject(ref, goals)?.id
    ?? null;
}

/**
 * Turns what the chat sent into capture items using the same rules as typing into Momentum: the chat's own choices win,
 * and the rules fill the gaps (dates in the title, minutes, life area, project, starter steps, why it matters).
 */
export function handoffToDrafts(items: HandoffItem[], areas: AreaLike[], goals: GoalLike[], now: Date = new Date()): HandoffDraft[] {
  return items.map((it) => {
    const kind: CaptureItem['kind'] = it.kind === 'project' ? 'goal' : it.kind === 'done' ? 'accomplishment' : it.kind === 'note' ? 'note' : 'action';
    const parsed = it.due_date || kind === 'accomplishment' || kind === 'note' ? null : parseDue(it.title, now);
    const title = (parsed ? stripDue(it.title, parsed) : it.title).slice(0, 200);
    const deadline = it.due_date ?? parsed?.date ?? null;
    const deadline_type: CaptureItem['deadline_type'] = !deadline ? 'none' : (it.hard_deadline ?? parsed?.type === 'hard') ? 'hard' : 'target';
    const goalId = kind === 'goal' ? null : findProject(it.project, goals) ?? (it.project ? null : matchProject(title, goals)?.id ?? null);
    const areaId = goalId ? null : findArea(it.area, areas) ?? guessLifeArea(`${title} ${it.why ?? ''}`, areas);
    const areaName = areas.find((a) => a.id === areaId)?.name ?? null;
    const steps = kind !== 'goal' ? []
      : it.steps?.length ? it.steps.map((s) => ({ title: s.title, estimated_minutes: s.minutes ?? estimateMinutes(s.title) }))
      : suggestSteps(title).steps.slice(0, 3).map((s) => ({ title: s.title, estimated_minutes: s.minutes }));
    const meaning = kind === 'goal' ? (it.why || suggestWhy(title, { isProject: true, areaName }) || '') : (it.why ?? '');
    return {
      kind,
      title,
      source_excerpt: (it.why ? `${it.title} (${it.why})` : it.title).slice(0, 500),
      estimated_minutes: kind === 'action' ? it.minutes ?? estimateMinutes(title) : null,
      suggested_goal_id: goalId,
      suggested_life_area_id: areaId,
      possible_duplicate_of: null,
      deadline: kind === 'accomplishment' || kind === 'note' ? null : deadline,
      deadline_type: kind === 'accomplishment' || kind === 'note' ? 'none' : deadline_type,
      occurred_at: null,
      confidence: 1,
      next_actions: steps,
      meaning,
      source_email_id: it.from_email ?? null,
    };
  });
}

/** The commit payload for drafts, same shape the capture screen saves. */
export function draftsToCommit(drafts: (HandoffDraft & { client_id: string })[]): CommitItem[] {
  return drafts.map((d) => ({
    client_id: d.client_id,
    kind: d.kind,
    title: d.title.trim(),
    goal_id: d.kind === 'goal' ? null : d.suggested_goal_id,
    life_area_id: d.suggested_life_area_id,
    estimated_minutes: d.estimated_minutes,
    deadline: d.deadline,
    deadline_type: d.deadline ? (d.deadline_type === 'none' ? 'target' : d.deadline_type) : 'none',
    occurred_at: d.occurred_at,
    meaningful: d.kind === 'accomplishment' && !!d.suggested_goal_id,
    next_actions: d.kind === 'goal' ? d.next_actions.filter((n) => n.title.trim()).slice(0, 5) : [],
    ...(d.kind === 'goal' && d.meaning.trim() ? { meaning: d.meaning.trim() } : {}),
    ...(d.source_email_id ? { source_email_id: d.source_email_id } : {}),
  }));
}
