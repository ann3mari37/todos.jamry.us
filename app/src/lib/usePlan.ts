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
}

const key = (d: string) => `momentum.plan.${d}`;

/**
 * Today's picks are chosen once and then kept stable. Completing them early
 * does NOT refill the list — the user can ask for more if they want it.
 */
export function usePlan() {
  const store = useStore();
  const today = toISODate(new Date());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(key(today))
      .then((raw) => setPlan(raw ? JSON.parse(raw) : null))
      .catch(() => setPlan(null))
      .finally(() => setReady(true));
  }, [today]);

  const persist = useCallback((p: Plan) => {
    setPlan(p);
    AsyncStorage.setItem(key(today), JSON.stringify(p)).catch(() => {});
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
    persist({ date: today, mode: plan?.mode ?? null, picks: recs.map(toPick), shown: recs.map((r) => r.action?.id ?? `goal:${r.goal?.id}`), builtAt: new Date().toISOString() });
  }, [ready, plan, store.loading, compute, persist, today]);

  // New tasks captured after today's picks were chosen fill open slots (up to 3 open suggestions).
  // Finished picks are never replaced on their own — "Finished for now" still means finished.
  useEffect(() => {
    if (!plan || plan.mode || store.loading) return;
    const builtAt = plan.builtAt ?? `${plan.date}T00:00:00`;
    const added = store.actions.filter((a) => a.created_at > builtAt && ['ready', 'in_progress'].includes(a.status) && !plan.shown.includes(a.id));
    if (!added.length) return;
    const open = plan.picks.filter((p) => !p.action_id || store.actions.find((a) => a.id === p.action_id)?.status !== 'completed').length;
    const slots = Math.max(0, 3 - open);
    const addedIds = new Set(added.map((a) => a.id));
    const fresh = slots ? compute(null, plan.shown).filter((r) => r.action && addedIds.has(r.action.id)).slice(0, slots) : [];
    persist({ ...plan, picks: [...plan.picks, ...fresh.map(toPick)], shown: [...plan.shown, ...fresh.map((r) => r.action!.id)], builtAt: new Date().toISOString() });
  }, [plan, store.actions, store.loading, compute, persist]);

  const setMode = useCallback((mode: DailyMode | null) => {
    const recs = compute(mode);
    persist({ date: today, mode, picks: recs.map(toPick), shown: recs.map((r) => r.action?.id).filter(Boolean) as string[], builtAt: new Date().toISOString() });
  }, [compute, persist, today]);

  /** "Next" / "Show me something else": swap one pick for the next suggestion of the same kind (any kind if none left). */
  const swap = useCallback((pick: Pick) => {
    if (!plan) return false;
    const exclude = [...plan.shown, ...plan.picks.map((p) => p.action_id).filter(Boolean) as string[]];
    const pickedGoals = new Set(plan.picks.filter((p) => p !== pick).map((p) => p.goal_id));
    const sameKind = compute(null, exclude, pick.kind).filter((r) => r.action);
    const candidates = compute(plan.mode, exclude);
    const next = sameKind.find((r) => !pickedGoals.has(r.goal?.id ?? null)) ?? sameKind[0]
      ?? candidates.find((r) => r.action && !pickedGoals.has(r.goal?.id ?? null)) ?? candidates.find((r) => r.action);
    const picks = plan.picks.filter((p) => p !== pick);
    if (next) picks.splice(plan.picks.indexOf(pick), 0, toPick(next));
    persist({ ...plan, picks, shown: [...plan.shown, ...(next?.action ? [next.action.id] : [])] });
    return !!next;
  }, [plan, compute, persist]);

  const remove = useCallback((pick: Pick) => {
    if (plan) persist({ ...plan, picks: plan.picks.filter((p) => p !== pick) });
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

  /** Filter row: every current suggestion of one kind, live (not fixed for the day). */
  const byKind = useCallback((kind: RecommendationKind) => compute(null, [], kind).map((r) => ({
    pick: toPick(r), action: r.action, goal: r.goal,
  })), [compute]);

  const actionable = resolved.filter((r) => r.action);
  const finished = actionable.length > 0 && actionable.every((r) => r.action!.status === 'completed');

  return { ready, plan, picks: resolved, finished, mode: plan?.mode ?? null, setMode, swap, remove, addMore, byKind };
}
