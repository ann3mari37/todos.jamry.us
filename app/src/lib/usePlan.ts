import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toISODate } from '../core/dates';
import { recommend } from '../core/recommend';
import { shapeDay, type DaySettings } from '../core/workload';
import type { DailyMode, Recommendation, RecommendationKind } from '../core/types';
import { useStore } from './store';

export interface Pick {
  kind: RecommendationKind;
  action_id: string | null;
  goal_id: string | null;
  reason: string;
  /** The person's own "first thing", chosen the night before: stays on top until done, skipped or unpinned. */
  pinned?: boolean;
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
  /** Picks finished today. They leave Today straight away; this only tells "finished for now" from "nothing yet". */
  done?: string[];
  /** What "Start my day" said about time and energy; rebuilds keep fitting the plan to it. */
  day?: DaySettings;
  /** When this copy was saved; the newest copy wins across devices. */
  savedAt?: string;
}

const PLAN_VERSION = 3;

/** What the picks depend on. Completing a task doesn't change it: finished picks are replaced one by one instead. */
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
    const next = { ...p, v: PLAN_VERSION, savedAt: new Date().toISOString() };
    setPlan(next);
    AsyncStorage.setItem(key(today), JSON.stringify(next)).catch(() => {});
    // Saved to the account too, so the phone and the computer show the same Today.
    store.saveCheckin(today, { plan: next }).catch(() => {});
  }, [today, store.saveCheckin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another device saved a newer plan for today: use it.
  const serverPlan = store.checkins.find((c) => c.day === today)?.plan as Plan | undefined;
  useEffect(() => {
    if (!ready || !serverPlan || serverPlan.v !== PLAN_VERSION) return;
    if (plan && (serverPlan.savedAt ?? '') <= (plan.savedAt ?? '')) return;
    setPlan(serverPlan);
    AsyncStorage.setItem(key(today), JSON.stringify(serverPlan)).catch(() => {});
  }, [ready, serverPlan, plan, today]);

  const compute = useCallback((mode: DailyMode | null, exclude: string[] = [], onlyKind: RecommendationKind | null = null): Recommendation[] =>
    recommend({
      goals: store.myGoals, actions: store.actions, dependencies: store.dependencies, feedback: store.feedback,
      mode, onlyKind, excludeActionIds: exclude, inactivityDays: store.accountability?.inactivity_days, lifeAreas: store.lifeAreas,
    }), [store.myGoals, store.actions, store.dependencies, store.feedback, store.accountability, store.lifeAreas]);

  const toPick = (r: Recommendation): Pick => ({ kind: r.kind, action_id: r.action?.id ?? null, goal_id: r.goal?.id ?? null, reason: r.reason });

  /** The task picked last night under "End my day", if it's still open. */
  const yesterday = toISODate(new Date(Date.now() - 86_400_000));
  const pinnedId = store.checkins.find((c) => c.day === yesterday)?.tomorrow_first_action_id ?? null;

  /** Today's list: the mixed suggestions, fitted to the day when one was described, with last night's pick first. */
  const build = useCallback((day: DaySettings | undefined, exclude: string[] = []): Pick[] => {
    let recs = day ? shapeDay(compute('show_all', exclude), day) : compute(null, exclude);
    const pinned = pinnedId && !exclude.includes(pinnedId) ? store.actions.find((a) => a.id === pinnedId && ['ready', 'in_progress'].includes(a.status)) : null;
    let picks = recs.map(toPick);
    if (pinned) {
      const existing = picks.find((p) => p.action_id === pinned.id);
      picks = [{ ...(existing ?? { kind: 'next_up' as const, action_id: pinned.id, goal_id: pinned.goal_id }), reason: 'You picked this to start the day with.', pinned: true },
        ...picks.filter((p) => p.action_id !== pinned.id)];
    }
    return picks;
  }, [compute, pinnedId, store.actions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the plan the first time there is data today.
  useEffect(() => {
    // An empty plan that never showed anything (e.g. first day, nothing captured yet) may fill once data exists.
    if (!ready || store.loading || (plan && plan.shown.length > 0)) return;
    const picks = build(plan?.day);
    if (picks.length === 0) return;
    persist({ date: today, mode: null, day: plan?.day, picks, shown: picks.map((p) => p.action_id ?? `goal:${p.goal_id}`), builtAt: new Date().toISOString(), sig: taskSignature(store.actions) });
  }, [ready, plan, store.loading, build, persist, today]);

  // The task list changed (new task, due date, project, area, waiting): rebuild the mix. Anything the user skipped
  // stays out.
  useEffect(() => {
    if (!plan || plan.mode || store.loading) return;
    const sig = taskSignature(store.actions);
    if (sig === plan.sig) return;
    const picks = build(plan.day, [...(plan.skipped ?? []), ...(plan.done ?? [])]);
    persist({
      ...plan,
      picks,
      shown: [...new Set([...plan.shown, ...picks.map((p) => p.action_id ?? `goal:${p.goal_id}`)])],
      builtAt: new Date().toISOString(),
      sig,
    });
  }, [plan, store.actions, store.loading, build, persist]);

  /** "Start my day": rebuild Today around the time and energy described (skips and finished picks stay out). */
  const startDay = useCallback((day: DaySettings) => {
    const exclude = [...(plan?.skipped ?? []), ...(plan?.done ?? [])];
    const picks = build(day, exclude);
    persist({ date: today, mode: null, day, picks, shown: [...new Set([...(plan?.shown ?? []), ...picks.map((p) => p.action_id ?? `goal:${p.goal_id}`)])],
      skipped: plan?.skipped, done: plan?.done, builtAt: new Date().toISOString(), sig: taskSignature(store.actions) });
    return picks;
  }, [plan, build, persist, today, store.actions]);

  const setMode = useCallback((mode: DailyMode | null) => {
    const recs = compute(mode);
    persist({ date: today, mode, picks: recs.map(toPick), shown: recs.map((r) => r.action?.id).filter(Boolean) as string[], builtAt: new Date().toISOString() });
  }, [compute, persist, today]);

  /**
   * The suggestion to put in place of `pick`, or undefined. `sameKindOnly` (a finished card) wants the next most urgent of
   * that kind even if it appeared earlier today, and never another kind; "something else" avoids everything shown today.
   */
  const replacementFor = useCallback((p: Plan, pick: Pick, sameKindOnly: boolean, extraExclude: string[] = []) => {
    const onToday = p.picks.map((x) => x.action_id).filter(Boolean) as string[];
    const exclude = [...(sameKindOnly ? [...onToday, ...(p.skipped ?? [])] : [...p.shown, ...onToday]), ...extraExclude];
    // Avoid two cards from the same project. Standalone tasks have no project, so they never block each other.
    const pickedGoals = new Set(p.picks.filter((x) => x !== pick && x.goal_id).map((x) => x.goal_id));
    const sameKind = compute(null, exclude, pick.kind).filter((r) => r.action);
    const next = sameKind.find((r) => !pickedGoals.has(r.goal?.id ?? null)) ?? sameKind[0];
    if (next || sameKindOnly) return next;
    const candidates = compute(p.mode, exclude);
    return candidates.find((r) => r.action && !pickedGoals.has(r.goal?.id ?? null)) ?? candidates.find((r) => r.action);
  }, [compute]);

  /** "Next" / "Show me something else": swap one pick for the next suggestion of the same kind (any kind if none left). */
  const swap = useCallback((pick: Pick) => {
    if (!plan) return false;
    const next = replacementFor(plan, pick, false);
    const picks = plan.picks.filter((p) => p !== pick);
    if (next) picks.splice(plan.picks.indexOf(pick), 0, toPick(next));
    persist({ ...plan, picks, shown: [...plan.shown, ...(next?.action ? [next.action.id] : [])], skipped: [...(plan.skipped ?? []), ...(pick.action_id ? [pick.action_id] : [])] });
    return !!next;
  }, [plan, replacementFor, persist]);

  // Finished picks leave Today at once: each is replaced by the next most urgent of its kind, or simply removed.
  useEffect(() => {
    if (!plan || store.loading) return;
    const isDone = (p: Pick) => !!p.action_id && store.actions.find((a) => a.id === p.action_id)?.status === 'completed';
    const finished = plan.picks.filter(isDone);
    if (!finished.length) return;
    let next: Plan = { ...plan, done: [...(plan.done ?? []), ...finished.map((p) => p.action_id!)] };
    for (const pick of finished) {
      const r = replacementFor(next, pick, true, next.done);
      const picks = next.picks.filter((p) => p !== pick);
      if (r) picks.splice(next.picks.indexOf(pick), 0, toPick(r));
      next = { ...next, picks, shown: [...next.shown, ...(r?.action ? [r.action.id] : [])] };
    }
    persist(next);
  }, [plan, store.actions, store.loading, replacementFor, persist]);

  /**
   * Back / Next on a card: steps through every suggestion of that card's kind and wraps around, so the card never runs
   * out. Browsing skips nothing: only finishing a task or "Not today" takes it out of the cycle.
   */
  const cycle = useCallback((kind: RecommendationKind, current: string | null) => {
    if (!plan) return [] as Recommendation[];
    const others = plan.picks.map((p) => p.action_id).filter((id): id is string => !!id && id !== current);
    return compute(null, [...others, ...(plan.skipped ?? []), ...(plan.done ?? [])], kind).filter((r) => r.action);
  }, [plan, compute]);

  /** Position of a card within its kind ("2 of 5"); total 1 means there's nothing to browse to. */
  const position = useCallback((pick: Pick) => {
    const list = cycle(pick.kind, pick.action_id);
    const i = list.findIndex((r) => r.action!.id === pick.action_id);
    return { index: i < 0 ? 0 : i, total: Math.max(list.length, 1) + (i < 0 && pick.action_id ? 1 : 0) };
  }, [cycle]);

  const browse = useCallback((pick: Pick, dir: 1 | -1) => {
    if (!plan) return false;
    const list = cycle(pick.kind, pick.action_id);
    if (!list.length || (list.length === 1 && list[0].action!.id === pick.action_id)) return false;
    const i = list.findIndex((r) => r.action!.id === pick.action_id);
    const next = list[i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
    const picks = plan.picks.map((p) => (p === pick ? { ...toPick(next), kind: pick.kind } : p));
    persist({ ...plan, picks, shown: [...new Set([...plan.shown, next.action!.id])] });
    return true;
  }, [plan, cycle, persist]);

  /** "Not today": out of today's cycle; the card moves on to the next of its kind, or goes if there's none. */
  const notToday = useCallback((pick: Pick) => {
    if (!plan) return;
    const next = replacementFor(plan, pick, true, [...(plan.done ?? []), ...(pick.action_id ? [pick.action_id] : [])]);
    const picks = plan.picks.filter((p) => p !== pick);
    if (next) picks.splice(plan.picks.indexOf(pick), 0, toPick(next));
    persist({ ...plan, picks, shown: [...plan.shown, ...(next?.action ? [next.action.id] : [])], skipped: [...(plan.skipped ?? []), ...(pick.action_id ? [pick.action_id] : [])] });
  }, [plan, replacementFor, persist]);

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
  })).filter((x) => (x.pick.action_id ? x.action && x.action.status !== 'dismissed' && x.action.status !== 'completed' : x.goal && x.goal.status === 'active')), [plan, store.actions, store.goals]);

  /** Filter row: every current suggestion of one kind, live (not fixed for the day). */
  const byKind = useCallback((kind: RecommendationKind) => compute(null, [], kind).map((r) => ({
    pick: toPick(r), action: r.action, goal: r.goal,
  })), [compute]);

  // Everything on Today got done and nothing of those kinds is left.
  const finished = resolved.every((r) => !r.action) && (plan?.done?.length ?? 0) > 0;

  return { ready, plan, picks: resolved, finished, mode: plan?.mode ?? null, setMode, startDay, swap, remove, addMore, byKind, browse, position, notToday };
}
