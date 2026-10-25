import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toISODate } from '../core/dates';
import { recommend } from '../core/recommend';
import type { DailyMode, Recommendation, RecommendationKind } from '../core/types';
import { useStore } from './store';

export interface Pick {
  kind: RecommendationKind;
  action_id: string | null;
  goal_id: string | null;
  reason: string;
}
interface Plan {
  date: string;
  mode: DailyMode | null;
  picks: Pick[];
  /** Everything ever shown today, so "something else" doesn't cycle back. */
  shown: string[];
  /** When the picks were last chosen; tasks added after this can fill open slots. */
  builtAt?: string;
  /** Rules version that chose these picks; older plans are rebuilt once so rule changes show the same day. */
  v?: number;
  /** Tasks the user moved past today (Next, Not today, Not a good fit); rebuilds leave them out. */
  skipped?: string[];
  /** Fingerprint of the task list the picks were chosen from; a change (new task, new date…) rebuilds them. */
  sig?: string;
}

const PLAN_VERSION = 3;

/** What the picks depend on. Completing a task deliberately doesn't change it, so finished picks aren't refilled. */
function taskSignature(actions: { id: string; status: string; due_date?: string | null; deadline_type?: string; goal_id: string | null; life_area_id: string | null }[]): string {
  return actions
    .filter((a) => a.status !== 'dismissed' && a.status !== 'suggested')
    .map((a) => `${a.id}:${a.due_date ?? ''}:${a.deadline_type ?? ''}:${a.goal_id ?? ''}:${a.life_area_id ?? ''}:${a.status === 'waiting' ? 'w' : ''}`)
    .sort()
    .join('|');
}

const key = (d: string) => `momentum.plan.${d}`;

/**
 * Today's picks stay stable while you work through them: completing them early does NOT refill the list
 * (the user can ask for more). When the list itself changes — a new task, a new due date, moved into a
 * project — the mix is rebuilt so the right task lands in the right category.
 */
export function usePlan() {
  const store = useStore();
  const today = toISODate(new Date());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(key(today))
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as Plan) : null;
        setPlan(saved && saved.v === PLAN_VERSION ? saved : null);
      })
      .catch(() => setPlan(null))
      .finally(() => setReady(true));
  }, [today]);

  const persist = useCallback((p: Plan) => {
    const next = { ...p, v: PLAN_VERSION };
    setPlan(next);
    AsyncStorage.setItem(key(today), JSON.stringify(next)).catch(() => {});
  }, [today]);

  const compute = useCallback((mode: DailyMode | null, exclude: string[] = [], onlyKind: RecommendationKind | null = null): Recommendation[] =>
    recommend({
      goals: store.goals, actions: store.actions, dependencies: store.dependencies, feedback: store.feedback,
      mode, onlyKind, excludeActionIds: exclude, inactivityDays: store.accountability?.inactivity_days, lifeAreas: store.lifeAreas,
    }), [store.goals, store.actions, store.dependencies, store.feedback, store.accountability, store.lifeAreas]);

  const toPick = (r: Recommendation): Pick => ({ kind: r.kind, action_id: r.action?.id ?? null, goal_id: r.goal?.id ?? null, reason: r.reason });

  // Build the plan the first time there is data today.
  useEffect(() => {
    // An empty plan that never showed anything (e.g. first day, nothing captured yet) may fill once data exists.
    if (!ready || store.loading || (plan && plan.shown.length > 0)) return;
    const recs = compute(plan?.mode ?? null);
    if (recs.length === 0) return;
    persist({ date: today, mode: plan?.mode ?? null, picks: recs.map(toPick), shown: recs.map((r) => r.action?.id ?? `goal:${r.goal?.id}`), builtAt: new Date().toISOString(), sig: taskSignature(store.actions) });
  }, [ready, plan, store.loading, compute, persist, today]);

  // The task list changed (new task, due date, project, area, waiting): rebuild the mix. Picks completed today stay
  // (shown as done) and anything the user skipped stays out.
  useEffect(() => {
    if (!plan || plan.mode || store.loading) return;
    const sig = taskSignature(store.actions);
    if (sig === plan.sig) return;
    const completed = plan.picks.filter((p) => p.action_id && store.actions.find((a) => a.id === p.action_id)?.status === 'completed');
    const recs = compute(null, plan.skipped ?? []);
    persist({
      ...plan,
      picks: [...recs.map(toPick), ...completed],
      shown: [...new Set([...plan.shown, ...recs.map((r) => r.action?.id ?? `goal:${r.goal?.id}`)])],
      builtAt: new Date().toISOString(),
      sig,
    });
  }, [plan, store.actions, store.loading, compute, persist]);

  const setMode = useCallback((mode: DailyMode | null) => {
    const recs = compute(mode);
    persist({ date: today, mode, picks: recs.map(toPick), shown: recs.map((r) => r.action?.id).filter(Boolean) as string[], builtAt: new Date().toISOString() });
  }, [compute, persist, today]);

  /**
   * "Next" / "Show me something else": swap one pick for the next suggestion of the same kind (any kind if none left).
   * `sameKindOnly` ("See next" on a finished card) never falls back to another kind; with nothing left the card just goes.
   */
  const swap = useCallback((pick: Pick, sameKindOnly = false) => {
    if (!plan) return false;
    // After finishing one, the next most urgent of that kind is wanted even if it appeared earlier today; only what's
    // on Today now and what was skipped stay out. "Something else" also avoids everything already shown today.
    const onToday = plan.picks.map((p) => p.action_id).filter(Boolean) as string[];
    const exclude = sameKindOnly ? [...onToday, ...(plan.skipped ?? [])] : [...plan.shown, ...onToday];
    // Avoid two cards from the same project. Standalone tasks have no project, so they never block each other.
    const pickedGoals = new Set(plan.picks.filter((p) => p !== pick && p.goal_id).map((p) => p.goal_id));
    const sameKind = compute(null, exclude, pick.kind).filter((r) => r.action);
    const candidates = compute(plan.mode, exclude);
    const next = sameKind.find((r) => !pickedGoals.has(r.goal?.id ?? null)) ?? sameKind[0]
      ?? (sameKindOnly ? undefined : candidates.find((r) => r.action && !pickedGoals.has(r.goal?.id ?? null)) ?? candidates.find((r) => r.action));
    const picks = plan.picks.filter((p) => p !== pick);
    if (next) picks.splice(plan.picks.indexOf(pick), 0, toPick(next));
    persist({ ...plan, picks, shown: [...plan.shown, ...(next?.action ? [next.action.id] : [])], skipped: [...(plan.skipped ?? []), ...(pick.action_id ? [pick.action_id] : [])] });
    return !!next;
  }, [plan, compute, persist]);

  const remove = useCallback((pick: Pick) => {
    if (plan) persist({ ...plan, picks: plan.picks.filter((p) => p !== pick), skipped: [...(plan.skipped ?? []), ...(pick.action_id ? [pick.action_id] : [])] });
  }, [plan, persist]);

  /** Optional extra work, only when asked for. */
  const addMore = useCallback(() => {
    if (!plan) return 0;
    const exclude = [...plan.shown, ...plan.picks.map((p) => p.action_id).filter(Boolean) as string[]];
    const more = compute(plan.mode, exclude).filter((r) => r.action).slice(0, 2);
    persist({ ...plan, picks: [...plan.picks, ...more.map(toPick)], shown: [...plan.shown, ...more.map((r) => r.action!.id)] });
    return more.length;
  }, [plan, compute, persist]);

  const resolved = useMemo(() => (plan?.picks ?? []).map((p) => ({
    pick: p,
    action: p.action_id ? store.actions.find((a) => a.id === p.action_id) ?? null : null,
    goal: p.goal_id ? store.goals.find((g) => g.id === p.goal_id) ?? null : null,
  })).filter((x) => (x.pick.action_id ? x.action && x.action.status !== 'dismissed' : x.goal && x.goal.status === 'active')), [plan, store.actions, store.goals]);

  /** How many more of a kind are ready beyond what's on Today (for "See next · 3 more"). */
  const moreOfKind = useCallback((kind: RecommendationKind) => {
    const out = new Set([...(plan?.picks ?? []).map((p) => p.action_id), ...(plan?.skipped ?? [])]);
    return compute(null, [], kind).filter((r) => r.action && !out.has(r.action.id)).length;
  }, [plan, compute]);

  /** Filter row: every current suggestion of one kind, live (not fixed for the day). */
  const byKind = useCallback((kind: RecommendationKind) => compute(null, [], kind).map((r) => ({
    pick: toPick(r), action: r.action, goal: r.goal,
  })), [compute]);

  const actionable = resolved.filter((r) => r.action);
  const finished = actionable.length > 0 && actionable.every((r) => r.action!.status === 'completed');

  return { ready, plan, picks: resolved, finished, mode: plan?.mode ?? null, setMode, swap, remove, addMore, byKind, moreOfKind };
}
