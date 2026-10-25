import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import type { CommitItem, EmailCategory, EmailStep } from '../core/ai-contracts';
import { toISODate } from '../core/dates';
import type { HandoffInterpretation } from '../core/handoff';
import { DEMO, demo, demoSession } from './demo';
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
  auto_organize?: boolean;
  email_digest_enabled?: boolean;
  /** null until the welcome walkthrough is finished or skipped (undefined before that migration). */
  onboarded_at?: string | null;
}
/** A plan an AI chat sent through the Momentum connector, waiting for review. */
export interface Handoff { id: string; raw_text: string; interpretation: HandoffInterpretation; created_at: string }
/** "Start my day" / "End my day" for one local calendar date. */
export interface DayCheckin {
  day: string; started_at: string | null; ended_at: string | null; room_minutes: number | null;
  energy: 'low' | 'okay' | 'high' | null; tomorrow_first_action_id: string | null; note: string | null;
}
/** An AI app the user allowed to reach Momentum (Supabase OAuth grant). */
export interface ChatConnection { client_id: string; name: string; uri: string | null; granted_at: string }
export interface EmailAccount {
  id: string; provider: 'gmail' | 'outlook' | 'imap'; email_address: string; display_name: string | null; color: string;
  life_area_id: string | null; digest_enabled: boolean; status: 'active' | 'needs_reauth' | 'error'; error_code: string | null; last_synced_at: string | null;
}
export interface EmailMessage {
  id: string; account_id: string; thread_id: string | null; from_name: string | null; from_address: string | null; subject: string | null;
  snippet: string | null; received_at: string; is_unread: boolean; is_archived: boolean; labels: string[];
  category: EmailCategory | null; importance: number | null; summary: string | null; life_area_id: string | null; suggested_goal_id: string | null;
  suggested_actions: EmailStep[]; thread_summary: string | null; thread_next_steps: EmailStep[]; status: 'new' | 'reviewed' | 'tasks_created' | 'dismissed';
}
export interface EmailDigest { id: string; digest_date: string; summary: string; highlights: { message_id: string; text: string }[]; counts: Record<string, number>; created_at: string }
export interface OrganizeChange { kind: 'action' | 'goal'; id: string; title: string; from_goal_id?: string | null; to_goal_id?: string | null; from_area_id: string | null; to_area_id: string | null }
export interface OrganizeRun { id: string; trigger: string; created_goal_ids: string[]; changes: OrganizeChange[]; undone_at: string | null; created_at: string }
export interface OrganizePlan {
  source?: 'ai' | 'rules';
  new_projects: { ref: string; title: string; life_area_id: string | null; reason: string; action_count: number }[];
  assignments: { kind: 'action' | 'goal'; id: string; title: string; goal_id: string | null; goal_ref: string | null; life_area_id: string | null; confidence: number; reason: string; from_goal_id: string | null; from_area_id: string | null }[];
}
export interface Nudge { id: string; goal_id: string | null; message: string; response: string | null; created_at: string }
export interface ProgressEvent { id: string; type: string; goal_id: string | null; action_id: string | null; accomplishment_id: string | null; goal_title: string | null; occurred_at: string }
export interface Reflection { id: string; week_start: string; facts: Record<string, unknown>; summary: string | null; created_at: string }
export interface AccountabilityPrefs { inactivity_days: number; max_nudges_per_week: number; enabled: boolean }
export interface NotificationPrefs { deadlines: boolean; meaningful_reminders: boolean; waiting_followups: boolean; weekly_reflection: boolean; quiet_start: string; quiet_end: string; max_per_day: number }

export interface Snapshot {
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
  emailAccounts: EmailAccount[];
  emailMessages: EmailMessage[];
  emailDigest: EmailDigest | null;
  organizeRuns: OrganizeRun[];
  handoffs: Handoff[];
  /** Yesterday's and today's check-ins (newest first). */
  checkins: DayCheckin[];
}

const EMPTY: Snapshot = {
  profile: null, lifeAreas: [], goals: [], actions: [], dependencies: [], accomplishments: [], events: [],
  feedback: [], nudges: [], reflections: [], accountability: null, notifications: null,
  emailAccounts: [], emailMessages: [], emailDigest: null, organizeRuns: [], handoffs: [], checkins: [],
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

/** For optional features (email, organize history): a missing table or failed query yields a fallback instead of breaking the app. */
async function soft<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, fallback: T): Promise<T> {
  try {
    const { data, error } = await p;
    return error ? fallback : ((data as T | null) ?? fallback);
  } catch {
    return fallback;
  }
}

function useStoreValue() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);
  // Most recent automatic organization, shown once on Today with an Undo.
  const [lastOrganized, setLastOrganized] = useState<OrganizeRun | null>(null);

  // ── Auth
  useEffect(() => {
    if (DEMO) {
      // Local preview with sample data (EXPO_PUBLIC_DEMO=1). Nothing is read from or written to Supabase.
      setSession(demoSession);
      setData(demo.current);
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── Cache: show last known data immediately.
  useEffect(() => {
    if (DEMO) return;
    AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (raw) {
        try { setData({ ...EMPTY, ...JSON.parse(raw) }); } catch { /* ignore corrupt cache */ }
      }
    }).catch(() => {});
    AsyncStorage.getItem(OUTBOX_KEY).then((raw) => setPending(raw ? JSON.parse(raw).length : 0)).catch(() => {});
  }, []);

  const save = useCallback((next: Snapshot) => {
    if (DEMO) { demo.current = next; return; }
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
    if (DEMO) { setData({ ...demo.current }); setLoading(false); return; }
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
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const yesterday = toISODate(new Date(Date.now() - 86_400_000));
      const [emailAccounts, emailMessages, emailDigest, organizeRuns, handoffs, checkins] = await Promise.all([
        soft(supabase.from('email_accounts').select('*').order('created_at'), [] as EmailAccount[]),
        soft(supabase.from('email_messages').select('id,account_id,thread_id,from_name,from_address,subject,snippet,received_at,is_unread,is_archived,labels,category,importance,summary,life_area_id,suggested_goal_id,suggested_actions,thread_summary,thread_next_steps,status')
          .eq('is_archived', false).gte('received_at', weekAgo).order('received_at', { ascending: false }).limit(200), [] as EmailMessage[]),
        soft(supabase.from('email_digests').select('*').order('digest_date', { ascending: false }).limit(1).maybeSingle(), null as EmailDigest | null),
        soft(supabase.from('organize_runs').select('*').order('created_at', { ascending: false }).limit(10), [] as OrganizeRun[]),
        soft(supabase.from('capture_entries').select('id,raw_text,interpretation,created_at').eq('source', 'chat').eq('status', 'interpreted')
          .order('created_at', { ascending: false }).limit(20), [] as Handoff[]),
        soft(supabase.from('daily_checkins').select('*').gte('day', yesterday).order('day', { ascending: false }), [] as DayCheckin[]),
      ]);
      const next: Snapshot = {
        profile: profile as Profile, lifeAreas: lifeAreas as LifeArea[], goals: goals as Goal[], actions: actions as Action[],
        dependencies: dependencies as Dependency[], accomplishments: accomplishments as Accomplishment[], events: events as ProgressEvent[],
        feedback: feedback as FeedbackEntry[], nudges: nudges as Nudge[], reflections: reflections as Reflection[],
        accountability: accountability as AccountabilityPrefs, notifications: notifications as NotificationPrefs,
        emailAccounts, emailMessages, emailDigest, organizeRuns, handoffs: handoffs.filter((h) => h.interpretation?.items?.length), checkins,
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

  const commitCapture = useCallback(async (raw: string, source: string, captureId: string | null, items: CommitItem[]): Promise<{ organized: OrganizeRun | null }> => {
    let organized: OrganizeRun | null = null;
    try {
      const res = await api<{ organized?: OrganizeRun | null }>('/api/capture/commit', { capture_id: captureId, raw_text: raw, source, items }, 60_000);
      organized = res.organized ?? null;
    } catch (e) {
      // Worker unreachable → write directly (same idempotent DB function, RLS-protected), or queue offline.
      const args = { p_capture_id: captureId, p_raw_text: raw, p_source: source, p_items: items };
      if (e instanceof ApiError && e.status > 0 && e.status < 500 && e.status !== 404) throw e;
      try { await runOp({ id: uuid(), op: 'commit_capture', args }); }
      catch (e2) { if (isNetworkError(e2)) { setOnline(false); await enqueue({ id: uuid(), op: 'commit_capture', args }); } else throw e2; }
    }
    if (organized?.changes?.length) setLastOrganized(organized);
    await refresh();
    return { organized };
  }, [refresh]);

  // ── AI organization (projects + life areas). The server validates; every apply can be undone.
  const organizePreview = useCallback((scope: 'loose' | 'all' = 'loose') => api<OrganizePlan>('/api/ai/organize', { scope }, 90_000), []);
  const organizeApply = useCallback(async (plan: { new_projects: { ref: string; title: string; life_area_id: string | null }[]; assignments: { kind: 'action' | 'goal'; id: string; goal_id: string | null; goal_ref: string | null; life_area_id: string | null }[] }) => {
    const run = await api<OrganizeRun>('/api/organize/apply', plan);
    await refresh();
    return run;
  }, [refresh]);
  const organizeUndo = useCallback(async (runId: string) => {
    await api('/api/organize/undo', { run_id: runId });
    await refresh();
  }, [refresh]);

  // ── Email
  const emailProviders = useCallback(() => api<{ gmail: boolean; outlook: boolean; imap: boolean }>('/api/email/providers', {}), []);
  const emailConnect = useCallback(async (provider: 'gmail' | 'outlook', returnTo = '/email-accounts') => {
    const { url } = await api<{ url: string }>('/api/email/connect', { provider, return_to: returnTo });
    if (Platform.OS === 'web') window.location.assign(url);
    else await Linking.openURL(url); // the callback lands on todos.jamry.us; reopening the app refreshes the list
  }, []);
  const emailConnectImap = useCallback(async (input: { email: string; host: string; port: number; username: string; password: string; archive_folder?: string }) => {
    await api('/api/email/connect-imap', input, 45_000);
    await refresh();
  }, [refresh]);
  const emailDisconnect = useCallback(async (accountId: string) => {
    patch((s) => ({ ...s, emailAccounts: s.emailAccounts.filter((a) => a.id !== accountId), emailMessages: s.emailMessages.filter((m) => m.account_id !== accountId) }));
    await api('/api/email/disconnect', { account_id: accountId });
    await refresh();
  }, [patch, refresh]);
  const updateEmailAccount = useCallback(async (id: string, p: Partial<Pick<EmailAccount, 'display_name' | 'color' | 'life_area_id' | 'digest_enabled'>>) => {
    patch((s) => ({ ...s, emailAccounts: s.emailAccounts.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
    if (!DEMO) await check(supabase.from('email_accounts').update(p).eq('id', id));
  }, [patch]);
  const emailSync = useCallback(async (force = false) => {
    const res = await api<{ accounts: { id: string; status: string; fetched: number; error?: string }[]; triaged: number }>('/api/email/sync', { force }, 120_000);
    await refresh();
    return res;
  }, [refresh]);
  const emailRefreshDigest = useCallback(async (regenerate = false) => {
    const { digest } = await api<{ digest: EmailDigest | null }>('/api/ai/email-digest', { regenerate }, 60_000);
    patch((s) => ({ ...s, emailDigest: digest }));
    return digest;
  }, [patch]);
  const emailThread = useCallback(async (messageId: string) => {
    const out = await api<{ summary: string; next_steps: EmailStep[]; waiting_on: string | null }>('/api/ai/email-thread', { message_id: messageId }, 60_000);
    patch((s) => ({ ...s, emailMessages: s.emailMessages.map((m) => (m.id === messageId ? { ...m, thread_summary: out.summary, thread_next_steps: out.next_steps, status: m.status === 'new' ? 'reviewed' : m.status } : m)) }));
    return out;
  }, [patch]);
  const emailModify = useCallback(async (ids: string[], op: 'archive' | 'mark_read' | 'label' | 'dismiss', label?: string) => {
    const before = data.emailMessages;
    patch((s) => ({
      ...s,
      emailMessages: s.emailMessages.flatMap((m) => {
        if (!ids.includes(m.id)) return [m];
        if (op === 'archive') return [];
        if (op === 'dismiss') return [{ ...m, status: 'dismissed' as const }];
        if (op === 'mark_read') return [{ ...m, is_unread: false }];
        return [{ ...m, labels: [...new Set([...m.labels, label!])] }];
      }),
    }));
    try {
      await api('/api/email/modify', { message_ids: ids, op, label });
    } catch (e) {
      patch((s) => ({ ...s, emailMessages: before }));
      throw e;
    }
  }, [data.emailMessages, patch]);

  // ── AI chat connector
  /** Plans from chat leave the review list once saved (commitCapture marks them committed) or dismissed. */
  const dismissHandoff = useCallback(async (id: string) => {
    patch((s) => ({ ...s, handoffs: s.handoffs.filter((h) => h.id !== id) }));
    if (!DEMO) await check(supabase.from('capture_entries').update({ status: 'dismissed' }).eq('id', id));
  }, [patch]);
  /** Saves part of a day's check-in (merged with what's there). */
  const saveCheckin = useCallback(async (day: string, p: Partial<Omit<DayCheckin, 'day'>>) => {
    const blank: DayCheckin = { day, started_at: null, ended_at: null, room_minutes: null, energy: null, tomorrow_first_action_id: null, note: null };
    patch((s) => {
      const cur = s.checkins.find((c) => c.day === day) ?? blank;
      return { ...s, checkins: [{ ...cur, ...p }, ...s.checkins.filter((c) => c.day !== day)].sort((x, y) => y.day.localeCompare(x.day)) };
    });
    if (DEMO) return;
    await check(supabase.from('daily_checkins').upsert({ day, ...p, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' }));
  }, [patch]);
  const chatConnections = useCallback(async (): Promise<ChatConnection[]> => {
    if (DEMO) return demo.chatConnections;
    const { data: grants, error } = await supabase.auth.oauth.listGrants();
    if (error) throw new Error(error.message);
    return (grants ?? []).map((g) => ({ client_id: g.client.id, name: g.client.name || 'AI app', uri: g.client.uri || null, granted_at: g.granted_at }));
  }, []);
  const revokeChat = useCallback(async (clientId: string) => {
    if (DEMO) { demo.chatConnections = demo.chatConnections.filter((c) => c.client_id !== clientId); return; }
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
    if (error) throw new Error(error.message);
  }, []);

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

  /** Adds several steps to a project at once (template or AI suggestions show as 'suggested' with Keep / ✕). */
  const createSteps = useCallback(async (goalId: string, steps: { title: string; estimated_minutes: number | null }[], status: 'suggested' | 'ready' = 'suggested') => {
    if (!steps.length) return;
    const base = data.actions.filter((x) => x.goal_id === goalId).length;
    const rows = steps.map((st, i) => ({ goal_id: goalId, title: st.title, estimated_minutes: st.estimated_minutes, status, origin: 'ai' as const, sort_order: base + i }));
    const now = new Date().toISOString();
    const local: Action[] = rows.map((r, i) => ({
      id: `local-step-${Date.now()}-${i}`, life_area_id: null, notes: null, completion_criteria: null, requires_clarification: false, user_edited: false,
      times_recommended: 0, times_skipped: 0, completed_at: null, created_at: now, due_date: null, deadline_type: 'none' as const, ...r,
    }));
    if (DEMO) {
      // Demo data lives in memory; update it directly so a concurrent refresh can't drop the new steps.
      demo.current = { ...demo.current, actions: [...demo.current.actions, ...local] };
      setData({ ...demo.current });
      return;
    }
    patch((s) => ({ ...s, actions: [...s.actions, ...local] }));
    await check(supabase.from('actions').insert(rows));
    await refresh();
  }, [data.actions, patch, refresh]);

  const updateAction = useCallback(async (id: string, p: Partial<Action>) => {
    const edited = p.title !== undefined || p.estimated_minutes !== undefined ? { user_edited: true } : {};
    patch((s) => ({ ...s, actions: s.actions.map((a) => (a.id === id ? { ...a, ...p, ...edited } : a)) }));
    if (DEMO) return;
    await check(supabase.from('actions').update({ ...p, ...edited }).eq('id', id));
    refresh();
  }, [patch, refresh]);

  const createGoal = useCallback(async (g: Partial<Goal> & { title: string }) => {
    if (DEMO) {
      const t = new Date().toISOString();
      const goal = { id: `g-${uuid()}`, life_area_id: null, description: null, meaning: null, meaning_source: 'none', deadline: null, deadline_type: 'none', status: 'active', completion_criteria: null, icon: 'target', accountability: 'default', snoozed_until: null, last_meaningful_progress_at: null, completed_at: null, archived_at: null, created_at: t, updated_at: t, ...g } as Goal;
      demo.current = { ...demo.current, goals: [...demo.current.goals, goal] };
      setData({ ...demo.current });
      return goal;
    }
    const rows = await check(supabase.from('goals').insert(g).select('*'));
    await refresh();
    return (rows as Goal[])[0];
  }, [refresh]);

  const updateGoal = useCallback(async (id: string, p: Partial<Goal>) => {
    patch((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
    if (DEMO) return;
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
    if (DEMO) return;
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
    for (const t of ['progress_events', 'accomplishments', 'recommendation_feedback', 'recommendations', 'nudges', 'action_dependencies', 'actions', 'goal_context', 'goals', 'capture_entries', 'weekly_reflections', 'client_mutations', 'organize_runs', 'email_digests', 'email_messages', 'daily_checkins']) {
      await check(supabase.from(t).delete().eq('user_id', session!.user.id));
    }
    await refresh();
  }, [refresh, session]);

  return useMemo(() => ({
    session, authReady, loading, online, pending, ...data, lastOrganized, setLastOrganized,
    refresh, completeAction, uncompleteAction, recordAccomplishment, commitCapture, updateAccomplishment, deleteAccomplishment,
    createAction, createSteps, updateAction, createGoal, updateGoal, giveFeedback, respondNudge, upsertLifeArea, deleteLifeArea,
    updateProfile, updateAccountability, updateNotifications, signOut, deleteAllData,
    dismissHandoff, chatConnections, revokeChat, saveCheckin,
    organizePreview, organizeApply, organizeUndo,
    emailProviders, emailConnect, emailConnectImap, emailDisconnect, updateEmailAccount, emailSync, emailRefreshDigest, emailThread, emailModify,
  }), [session, authReady, loading, online, pending, data, lastOrganized, refresh, completeAction, uncompleteAction, recordAccomplishment, commitCapture,
    updateAccomplishment, deleteAccomplishment, createAction, createSteps, updateAction, createGoal, updateGoal, giveFeedback, respondNudge,
    upsertLifeArea, deleteLifeArea, updateProfile, updateAccountability, updateNotifications, signOut, deleteAllData,
    dismissHandoff, chatConnections, revokeChat, saveCheckin,
    organizePreview, organizeApply, organizeUndo, emailProviders, emailConnect, emailConnectImap, emailDisconnect, updateEmailAccount,
    emailSync, emailRefreshDigest, emailThread, emailModify]);
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
