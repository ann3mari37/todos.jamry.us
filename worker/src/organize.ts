// Organization: file loose tasks into projects (goals) and every item into a life area.
// AI proposes when available, keyword rules otherwise; business rules here decide what is kept, and the database applies it
// atomically with an undo record (apply_organization / undo_organization).

import { z } from 'zod';
import { ApplyOrganizeInput, OrganizeOutput, type OrganizeAssignment, type OrganizeProject } from '../../app/src/core/ai-contracts';
import { guessLifeArea, matchProject } from '../../app/src/core/rules';
import { callStructured } from './ai';
import { keepId, must, norm, profile, type Ctx } from './ops';
import { PROMPTS } from './prompts';
import * as S from './schemas';
import { HttpError } from './supabase';

const OPEN = ['ready', 'in_progress', 'waiting', 'blocked'];
const AUTO_APPLY_CONFIDENCE = 0.75;

export const OrganizePreviewInput = z.object({
  scope: z.enum(['loose', 'all']).default('loose'),
  action_ids: z.array(z.string().uuid()).max(120).optional(),
  goal_ids: z.array(z.string().uuid()).max(60).optional(),
});

type Row = { id: string; title: string; goal_id?: string | null; life_area_id: string | null };

export interface OrganizePlan {
  new_projects: (OrganizeProject & { action_count: number })[];
  assignments: (OrganizeAssignment & { title: string; from_goal_id: string | null; from_area_id: string | null })[];
  source?: 'ai' | 'rules';
}

type Context = { areas: { id: string; name: string; keywords?: string[] | null }[]; goals: Row[]; actions: Row[]; goalsToFile: Row[] };

/**
 * Proposes where loose tasks and unfiled projects belong. Uses AI when `useAi` is true and it answers;
 * otherwise (no provider, AI off, over limits, provider errors) the keyword rules produce the plan.
 */
export async function organizePreview(ctx: Ctx, input: z.infer<typeof OrganizePreviewInput>, useAi: boolean): Promise<OrganizePlan> {
  const c = await loadContext(ctx, input);
  if (!c) return { new_projects: [], assignments: [], source: useAi ? 'ai' : 'rules' };
  if (useAi) {
    try {
      return { ...refinePlan(await aiOrganize(ctx, c), c), source: 'ai' };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e; // AI unavailable → rules below
    }
  }
  return { ...refinePlan(rulesOrganize(c), c), source: 'rules' };
}

/** Keyword rules: join an existing project that shares a distinctive word, otherwise file into a life area. */
export function rulesOrganize(c: Context): OrganizeOutput {
  const assignments: OrganizeOutput['assignments'] = [];
  for (const a of c.actions) {
    const project = a.goal_id ? null : matchProject(a.title, c.goals);
    if (project) {
      assignments.push({ kind: 'action', id: a.id, goal_id: project.id, goal_ref: null, life_area_id: null, confidence: 0.8, reason: `Shares "${project.word}" with that project` });
      continue;
    }
    const area = a.life_area_id || a.goal_id ? null : guessLifeArea(a.title, c.areas.map((x) => ({ ...x, archived_at: null })));
    if (area) assignments.push({ kind: 'action', id: a.id, goal_id: null, goal_ref: null, life_area_id: area, confidence: 0.75, reason: 'Matched by keywords' });
  }
  for (const g of c.goalsToFile) {
    const area = guessLifeArea(g.title, c.areas.map((x) => ({ ...x, archived_at: null })));
    if (area) assignments.push({ kind: 'goal', id: g.id, goal_id: null, goal_ref: null, life_area_id: area, confidence: 0.75, reason: 'Matched by keywords' });
  }
  return { new_projects: [], assignments };
}

async function aiOrganize(ctx: Ctx, c: Context): Promise<OrganizeOutput> {
  await profile(ctx);
  const areaName = new Map(c.areas.map((a) => [a.id, a.name]));
  return callStructured(ctx.env, {
    operation: 'organize',
    promptVersion: PROMPTS.organize.version,
    system: PROMPTS.organize.system,
    user: {
      life_areas: c.areas,
      projects: c.goals.map((g) => ({ id: g.id, title: g.title, life_area: g.life_area_id ? areaName.get(g.life_area_id) ?? null : null })),
      to_organize: {
        actions: c.actions.map((a) => ({ id: a.id, title: a.title, goal_id: a.goal_id ?? null, life_area_id: a.life_area_id })),
        goals: c.goalsToFile.map((g) => ({ id: g.id, title: g.title })),
      },
    },
    jsonSchema: S.organizeSchema,
    validator: OrganizeOutput,
    maxOutputTokens: 4000,
    userId: ctx.userId,
  });
}

async function loadContext(ctx: Ctx, input: z.infer<typeof OrganizePreviewInput>): Promise<Context | null> {
  const [areas, goals] = (await Promise.all([
    must(ctx.db.from('life_areas').select('id,name,keywords').is('archived_at', null).order('sort_order')),
    must(ctx.db.from('goals').select('id,title,life_area_id').in('status', ['active', 'waiting', 'blocked', 'paused']).limit(80)),
  ])) as [{ id: string; name: string }[], Row[]];

  let actionsQ = ctx.db.from('actions').select('id,title,goal_id,life_area_id').in('status', OPEN).limit(120);
  let goalsToFile: Row[];
  if (input.action_ids || input.goal_ids) {
    actionsQ = actionsQ.in('id', input.action_ids?.length ? input.action_ids : ['00000000-0000-0000-0000-000000000000']);
    goalsToFile = goals.filter((g) => input.goal_ids?.includes(g.id));
  } else if (input.scope === 'loose') {
    actionsQ = actionsQ.is('goal_id', null);
    goalsToFile = goals.filter((g) => !g.life_area_id);
  } else {
    goalsToFile = goals;
  }
  const actions = (await must(actionsQ)) as Row[];
  if (!actions.length && !goalsToFile.length) return null;
  return { areas, goals, actions, goalsToFile };
}

/** Business rules applied to the model's proposal. Exported for tests. */
export function refinePlan(
  out: OrganizeOutput,
  c: { areas: { id: string }[]; goals: Row[]; actions: Row[]; goalsToFile: Row[] },
): OrganizePlan {
  const areaIds = new Set(c.areas.map((a) => a.id));
  const goalIds = new Set(c.goals.map((g) => g.id));
  const actionById = new Map(c.actions.map((a) => [a.id, a]));
  const goalById = new Map(c.goalsToFile.map((g) => [g.id, g]));
  const existingByTitle = new Map(c.goals.map((g) => [norm(g.title), g.id]));

  // A proposed project with the same name as an existing one is that project.
  const refToExisting = new Map<string, string>();
  const projects = new Map<string, OrganizeProject>();
  for (const p of out.new_projects) {
    const existing = existingByTitle.get(norm(p.title));
    if (existing) refToExisting.set(p.ref, existing);
    else if (!projects.has(p.ref)) projects.set(p.ref, { ...p, life_area_id: keepId(p.life_area_id, areaIds) });
  }

  const seen = new Set<string>();
  let assignments = out.assignments.flatMap((a) => {
    if (seen.has(a.id)) return [];
    seen.add(a.id);
    const item = a.kind === 'action' ? actionById.get(a.id) : goalById.get(a.id);
    if (!item) return []; // only items we asked about
    let goal_id = a.kind === 'action' ? keepId(a.goal_id, goalIds) : null;
    let goal_ref = a.kind === 'action' && !goal_id && a.goal_ref ? a.goal_ref : null;
    if (goal_ref && refToExisting.has(goal_ref)) { goal_id = refToExisting.get(goal_ref)!; goal_ref = null; }
    if (goal_ref && !projects.has(goal_ref)) goal_ref = null;
    return [{ ...a, goal_id, goal_ref, life_area_id: keepId(a.life_area_id, areaIds), title: item.title, from_goal_id: item.goal_id ?? null, from_area_id: item.life_area_id }];
  });

  // Never create a project for a single task.
  const counts = new Map<string, number>();
  for (const a of assignments) if (a.goal_ref) counts.set(a.goal_ref, (counts.get(a.goal_ref) ?? 0) + 1);
  for (const [ref] of projects) if ((counts.get(ref) ?? 0) < 2) projects.delete(ref);
  assignments = assignments.map((a) => (a.goal_ref && !projects.has(a.goal_ref) ? { ...a, goal_ref: null } : a));

  // Drop suggestions that change nothing.
  assignments = assignments.filter((a) =>
    a.goal_ref || (a.goal_id && a.goal_id !== a.from_goal_id) || (a.life_area_id && a.life_area_id !== a.from_area_id && !(a.kind === 'action' && a.from_goal_id)),
  );

  return {
    new_projects: [...projects.values()].map((p) => ({ ...p, action_count: counts.get(p.ref) ?? 0 })),
    assignments,
  };
}

export async function organizeApply(ctx: Ctx, input: ApplyOrganizeInput & { trigger?: string }) {
  const { data, error } = await ctx.db.rpc('apply_organization', {
    p_new_projects: input.new_projects,
    p_assignments: input.assignments,
    p_trigger: input.trigger ?? 'manual',
  });
  if (error) throw new HttpError(400, 'organize_failed', error.message);
  return data;
}

export const UndoOrganizeInput = z.object({ run_id: z.string().uuid() });
export async function organizeUndo(ctx: Ctx, input: z.infer<typeof UndoOrganizeInput>) {
  const { error } = await ctx.db.rpc('undo_organization', { p_run_id: input.run_id });
  if (error) throw new HttpError(400, 'undo_failed', error.message);
  return { ok: true };
}

/** Keep only confident suggestions; a new project survives only if it still has 2+ confident tasks. */
export function confidentSubset(plan: OrganizePlan, min = AUTO_APPLY_CONFIDENCE): ApplyOrganizeInput | null {
  let picked = plan.assignments.filter((a) => a.confidence >= min);
  const counts = new Map<string, number>();
  for (const a of picked) if (a.goal_ref) counts.set(a.goal_ref, (counts.get(a.goal_ref) ?? 0) + 1);
  const projects = plan.new_projects.filter((p) => (counts.get(p.ref) ?? 0) >= 2);
  const keep = new Set(projects.map((p) => p.ref));
  picked = picked
    .map((a) => (a.goal_ref && !keep.has(a.goal_ref) ? { ...a, goal_ref: null } : a))
    .filter((a) => a.goal_ref || a.goal_id || a.life_area_id);
  if (!picked.length) return null;
  return {
    new_projects: projects.map(({ ref, title, life_area_id }) => ({ ref, title, life_area_id })),
    assignments: picked.map(({ kind, id, goal_id, goal_ref, life_area_id }) => ({ kind, id, goal_id, goal_ref, life_area_id })),
  };
}

/**
 * After a capture (or email) commit: file the new loose items automatically when the user has
 * auto-organize on. Never throws — a commit must not fail because organizing did.
 */
export async function autoOrganize(ctx: Ctx, created: { kind: string; id: string }[], trigger: 'capture' | 'email', useAi: boolean) {
  try {
    const prof = (await must(ctx.db.from('profiles').select('auto_organize').single())) as { auto_organize: boolean };
    if (!prof.auto_organize) return null;
    const action_ids = created.filter((c) => c.kind === 'action').map((c) => c.id);
    const goal_ids = created.filter((c) => c.kind === 'goal').map((c) => c.id);
    if (!action_ids.length && !goal_ids.length) return null;
    // Only items that still need filing: actions outside a project, projects without an area.
    const [loose, unfiled] = (await Promise.all([
      action_ids.length ? must(ctx.db.from('actions').select('id').in('id', action_ids).is('goal_id', null)) : [],
      goal_ids.length ? must(ctx.db.from('goals').select('id').in('id', goal_ids).is('life_area_id', null)) : [],
    ])) as [{ id: string }[], { id: string }[]];
    if (!loose.length && !unfiled.length) return null;
    const plan = await organizePreview(ctx, { scope: 'loose', action_ids: loose.map((r) => r.id), goal_ids: unfiled.map((r) => r.id) }, useAi);
    const subset = confidentSubset(plan);
    if (!subset) return null;
    return await organizeApply(ctx, { ...subset, trigger });
  } catch (e) {
    console.warn('auto-organize skipped', { reason: (e as Error).name === 'HttpError' ? (e as HttpError).code : 'error' });
    return null;
  }
}
