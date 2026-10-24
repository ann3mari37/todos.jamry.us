import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { CommitItem } from '../core/ai-contracts';
import type { Accomplishment, Action, Dependency, FeedbackEntry, Goal, LifeArea } from '../core/types';
import { api, ApiError } from './api';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  display_name: string | null;
  timezone: string;
  preferred_action_minutes: number;
  tone: 'warm' | 'neutral' | 'brief';
  ai_enabled: boolean;
  ai_disclosure_accepted_at: string | null;
  weekly_reflection_enabled: boolean;
  learned_preferences: Record<string, unknown>;
}
export interface Nudge { id: string; goal_id: string | null; message: string; response: string | null; created_at: string }
export interface ProgressEvent { id: string; type: string; goal_id: string | null; action_id: string | null; accomplishment_id: string | null; goal_title: string | null; occurred_at: string }
export interface Reflection { id: string; week_start: string; facts: Record<string, unknown>; summary: string | null; created_at: string }
export interface AccountabilityPrefs { inactivity_days: number; max_nudges_per_week: number; enabled: boolean }
export interface NotificationPrefs { deadlines: boolean; meaningful_reminders: boolean; waiting_followups: boolean; weekly_reflection: boolean; quiet_start: string; quiet_end: string; max_per_day: number }

interface Snapshot {
  profile: Profile | null;
  lifeAreas: LifeArea[];
  goals: Goal[];
  actions: Action[];
  dependencies: Dependency[];
  accomplishments: Accomplishment[];
  events: ProgressEvent[];
  feedback: FeedbackEntry[];
  nudges: Nudge[];
  reflections: Reflection[];
  accountability: AccountabilityPrefs | null;
  notifications: NotificationPrefs | null;
}

const EMPTY: Snapshot = {
  profile: null, lifeAreas: [], goals: [], actions: [], dependencies: [], accomplishments: [], events: [],
  feedback: [], nudges: [], reflections: [], accountability: null, notifications: null,
};

type OutboxOp =
  | { id: string; op: 'complete_action'; args: { p_action_id: string; p_occurred_at: string } }
  | { id: string; op: 'record_accomplishment'; args: { p_client_id: string; p_title: string; p_goal_id: string | null; p_life_area_id: string | null; p_occurred_at: string; p_meaningful: boolean } }
  | { id: string; op: 'commit_capture'; args: { p_capture_id: string | null; p_raw_text: string; p_source: string; p_items: CommitItem[] } };

const CACHE_KEY = 'momentum.cache.v1';
const OUTBOX_KEY = 'momentum.outbox.v1';

export const uuid = () => Crypto.randomUUID();

function isNetworkError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e);
  return /fetch|network|offline|timeout|load failed/i.test(m);
}

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

function useStoreValue() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  // ── Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── Cache: show last known data immediately.
  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (raw) {
        try { setData({ ...EMPTY, ...JSON.parse(raw) }); } catch { /* ignore corrupt cache */ }
      }
    }).catch(() => {});
    AsyncStorage.getItem(OUTBOX_KEY).then((raw) => setPending(raw ? JSON.parse(raw).length : 0)).catch(() => {});
  }, []);

  const save = useCallback((next: Snapshot) => {
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const patch = useCallback((fn: (s: Snapshot) => Snapshot) => {
    setData((s) => {
      const next = fn(s);
      save(next);
      return next;
    });
  }, [save]);

  // ── Outbox (offline queue). Every op is idempotent server-side.
  const readOutbox = async (): Promise<OutboxOp[]> => {
    try { return JSON.parse((await AsyncStorage.getItem(OUTBOX_KEY)) ?? '[]'); } catch { return []; }
  };
  const writeOutbox = async (ops: OutboxOp[]) => {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(ops)).catch(() => {});
    setPending(ops.length);
  };
  const enqueue = async (op: OutboxOp) => writeOutbox([...(await readOutbox()), op]);

  const runOp = async (op: OutboxOp) => {
    const { error } = await supabase.rpc(op.op, op.args);
    if (error) throw error;
  };

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let ops = await readOutbox();
      while (ops.length) {
        try {
          await runOp(ops[0]);
        } catch (e) {
          if (isNetworkError(e)) { setOnline(false); break; }
          console.warn('dropping failed queued op', ops[0].op);
        }
        ops = ops.slice(1);
        await writeOutbox(ops);
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  // ── Load everything (a single person's data is small).
  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      await flush();
      const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
      const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [profile, lifeAreas, goals, actions, dependencies, accomplishments, events, feedback, nudges, reflections, accountability, notifications] = await Promise.all([
        check(supabase.from('profiles').select('*').maybeSingle()),
        check(supabase.from('life_areas').select('*').order('sort_order')),
        check(supabase.from('goals').select('*').order('created_at')),
        check(supabase.from('actions').select('*').order('sort_order').order('created_at')),
        check(supabase.from('action_dependencies').select('action_id,depends_on_id')),
        check(supabase.from('accomplishments').select('*').gte('occurred_at', since).order('occurred_at', { ascending: false })),
        check(supabase.from('progress_events').select('id,type,goal_id,action_id,accomplishment_id,goal_title,occurred_at').gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(2000)),
        check(supabase.from('recommendation_feedback').select('action_id,goal_id,response,created_at').gte('created_at', monthAgo)),
        check(supabase.from('nudges').select('*').order('created_at', { ascending: false }).limit(30)),
        check(supabase.from('weekly_reflections').select('*').order('week_start', { ascending: false }).limit(12)),
        check(supabase.from('accountability_preferences').select('*').maybeSingle()),
        check(supabase.from('notification_preferences').select('*').maybeSingle()),
      ]);
      const next: Snapshot = {
        profile: profile as Profile, lifeAreas: lifeAreas as LifeArea[], goals: goals as Goal[], actions: actions as Action[],
        dependencies: dependencies as Dependency[], accomplishments: accomplishments as Accomplishment[], events: events as ProgressEvent[],
        feedback: feedback as FeedbackEntry[], nudges: nudges as Nudge[], reflections: reflections as Reflection[],
        accountability: accountability as AccountabilityPrefs, notifications: notifications as NotificationPrefs,
      };
      setData(next);
      save(next);
      setOnline(true);
    } catch (e) {
      if (isNetworkError(e)) setOnline(false);
      else console.warn('refresh failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, flush, save]);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    refresh();
    const t = setInterval(() => flush(), 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => { clearInterval(t); sub.remove(); };
  }, [session, refresh, flush]);

  // ── Mutations
  const completeAction = useCallback(async (actionId: string) => {
    const now = new Date().toISOString();
    const action = data.actions.find((a) => a.id === actionId);
    // Instant local feedback; the server is authoritative.
    patch((s) => ({
      ...s,
      actions: s.actions.map((a) => (a.id === actionId ? { ...a, status: 'completed', completed_at: now } : a)),
      accomplishments: action && !s.accomplishments.some((x) => x.action_id === actionId)
        ? [{ id: `local-${actionId}`, title: action.title, notes: null, goal_id: action.goal_id, action_id: actionId, life_area_id: action.life_area_id, planned: true, meaningful: !!action.goal_id, occurred_at: now, created_at: now }, ...s.accomplishments]
        : s.accomplishments,
      goals: s.goals.map((g) => (g.id === action?.goal_id ? { ...g, last_meaningful_progress_at: now } : g)),
    }));
    const op: OutboxOp = { id: uuid(), op: 'complete_action', args: { p_action_id: actionId, p_occurred_at: now } };
    try {
      await runOp(op);
      refresh();
    } catch (e) {
      if (isNetworkError(e)) { setOnline(false); await enqueue(op); } else throw e;
    }
  }, [data.actions, patch, refresh]);

  const uncompleteAction = useCallback(async (actionId: string) => {
    await check(supabase.rpc('uncomplete_action', { p_action_id: actionId }));
    await refresh();
  }, [refresh]);

  const recordAccomplishment = useCallback(async (a: { title: string; goal_id?: string | null; life_area_id?: string | null; occurred_at?: string | null; meaningful?: boolean }) => {
    const clientId = uuid();
    const occurred = a.occurred_at ?? new Date().toISOString();
    patch((s) => ({ ...s, accomplishments: [{ id: `local-${clientId}`, title: a.title, notes: null, goal_id: a.goal_id ?? null, action_id: null, life_area_id: a.life_area_id ?? null, planned: false, meaningful: !!a.meaningful && !!a.goal_id, occurred_at: occurred, created_at: new Date().toISOString() }, ...s.accomplishments] }));
    const op: OutboxOp = { id: uuid(), op: 'record_accomplishment', args: { p_client_id: clientId, p_title: a.title, p_goal_id: a.goal_id ?? null, p_life_area_id: a.life_area_id ?? null, p_occurred_at: occurred, p_meaningful: !!a.meaningful } };
    try { await runOp(op); refresh(); } catch (e) { if (isNetworkError(e)) { setOnline(false); await enqueue(op); } else throw e; }
  }, [patch, refresh]);

  const commitCapture = useCallback(async (raw: string, source: string, captureId: string | null, items: CommitItem[]) => {
    try {
      await api('/api/capture/commit', { capture_id: captureId, raw_text: raw, source, items });
    } catch (e) {
      // Worker unreachable → write directly (same idempotent DB function, RLS-protected), or queue offline.
      const args = { p_capture_id: captureId, p_raw_text: raw, p_source: source, p_items: items };
      if (e instanceof ApiError && e.status > 0 && e.status < 500 && e.status !== 404) throw e;
      try { await runOp({ id: uuid(), op: 'commit_capture', args }); }
      catch (e2) { if (isNetworkError(e2)) { setOnline(false); await enqueue({ id: uuid(), op: 'commit_capture', args }); } else throw e2; }
    }
    await refresh();
  }, [refresh]);

  const updateAccomplishment = useCallback(async (id: string, p: Partial<Accomplishment>) => {
    await check(supabase.from('accomplishments').update(p).eq('id', id));
    await refresh();
  }, [refresh]);
  const deleteAccomplishment = useCallback(async (id: string) => {
    await check(supabase.from('accomplishments').delete().eq('id', id));
    await refresh();
  }, [refresh]);

  const createAction = useCallback(async (a: Partial<Action> & { title: string }) => {
    const order = data.actions.filter((x) => x.goal_id && x.goal_id === a.goal_id).length;
    await check(supabase.from('actions').insert({ status: 'ready', origin: 'user', sort_order: order, ...a }));
    await refresh();
  }, [data.actions, refresh]);

  const updateAction = useCallback(async (id: string, p: Partial<Action>) => {
    const edited = p.title !== undefined || p.estimated_minutes !== undefined ? { user_edited: true } : {};
    patch((s) => ({ ...s, actions: s.actions.map((a) => (a.id === id ? { ...a, ...p, ...edited } : a)) }));
    await check(supabase.from('actions').update({ ...p, ...edited }).eq('id', id));
    refresh();
  }, [patch, refresh]);

  const createGoal = useCallback(async (g: Partial<Goal> & { title: string }) => {
    const rows = await check(supabase.from('goals').insert(g).select('*'));
    await refresh();
    return (rows as Goal[])[0];
  }, [refresh]);

  const updateGoal = useCallback(async (id: string, p: Partial<Goal>) => {
    patch((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
    await check(supabase.from('goals').update(p).eq('id', id));
    refresh();
  }, [patch, refresh]);

  const giveFeedback = useCallback(async (f: { action_id: string | null; goal_id: string | null; response: FeedbackEntry['response'] }) => {
    const entry = { ...f, created_at: new Date().toISOString() };
    patch((s) => ({ ...s, feedback: [...s.feedback, entry] }));
    if (f.action_id && (f.response === 'deferred' || f.response === 'dismissed' || f.response === 'not_suitable')) {
      const a = data.actions.find((x) => x.id === f.action_id);
      if (a) supabase.from('actions').update({ times_skipped: a.times_skipped + 1 }).eq('id', a.id).then(() => {});
    }
    await supabase.from('recommendation_feedback').insert(f);
  }, [data.actions, patch]);

  const respondNudge = useCallback(async (id: string, response: string) => {
    patch((s) => ({ ...s, nudges: s.nudges.map((n) => (n.id === id ? { ...n, response } : n)) }));
    await check(supabase.from('nudges').update({ response, responded_at: new Date().toISOString() }).eq('id', id));
  }, [patch]);

  const upsertLifeArea = useCallback(async (a: Partial<LifeArea> & { name: string }) => {
    if (a.id) await check(supabase.from('life_areas').update(a).eq('id', a.id));
    else await check(supabase.from('life_areas').insert({ ...a, sort_order: data.lifeAreas.length }));
    await refresh();
  }, [data.lifeAreas.length, refresh]);
  const deleteLifeArea = useCallback(async (id: string) => {
    await check(supabase.from('life_areas').delete().eq('id', id));
    await refresh();
  }, [refresh]);

  const updateProfile = useCallback(async (p: Partial<Profile>) => {
    patch((s) => ({ ...s, profile: s.profile ? { ...s.profile, ...p } : s.profile }));
    await check(supabase.from('profiles').update(p).eq('id', session!.user.id));
  }, [patch, session]);
  const updateAccountability = useCallback(async (p: Partial<AccountabilityPrefs>) => {
    patch((s) => ({ ...s, accountability: s.accountability ? { ...s.accountability, ...p } : s.accountability }));
    await check(supabase.from('accountability_preferences').update(p).eq('user_id', session!.user.id));
  }, [patch, session]);
  const updateNotifications = useCallback(async (p: Partial<NotificationPrefs>) => {
    patch((s) => ({ ...s, notifications: s.notifications ? { ...s.notifications, ...p } : s.notifications }));
    await check(supabase.from('notification_preferences').update(p).eq('user_id', session!.user.id));
  }, [patch, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await AsyncStorage.multiRemove([CACHE_KEY, OUTBOX_KEY]).catch(() => {});
    setData(EMPTY);
  }, []);

  const deleteAllData = useCallback(async () => {
    for (const t of ['progress_events', 'accomplishments', 'recommendation_feedback', 'recommendations', 'nudges', 'action_dependencies', 'actions', 'goal_context', 'goals', 'capture_entries', 'weekly_reflections', 'client_mutations']) {
      await check(supabase.from(t).delete().eq('user_id', session!.user.id));
    }
    await refresh();
  }, [refresh, session]);

  return useMemo(() => ({
    session, authReady, loading, online, pending, ...data,
    refresh, completeAction, uncompleteAction, recordAccomplishment, commitCapture, updateAccomplishment, deleteAccomplishment,
    createAction, updateAction, createGoal, updateGoal, giveFeedback, respondNudge, upsertLifeArea, deleteLifeArea,
    updateProfile, updateAccountability, updateNotifications, signOut, deleteAllData,
  }), [session, authReady, loading, online, pending, data, refresh, completeAction, uncompleteAction, recordAccomplishment, commitCapture,
    updateAccomplishment, deleteAccomplishment, createAction, updateAction, createGoal, updateGoal, giveFeedback, respondNudge,
    upsertLifeArea, deleteLifeArea, updateProfile, updateAccountability, updateNotifications, signOut, deleteAllData]);
}

export type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const value = useStoreValue();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
