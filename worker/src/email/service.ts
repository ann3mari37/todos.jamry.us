// Email operations: sync → AI triage (summary, category, life area, suggested tasks) → daily digest,
// plus on-demand thread summaries and mailbox actions. Works for any number of accounts per user.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { EmailDigestOutput, EmailThreadOutput, EmailTriageOutput } from '../../../app/src/core/ai-contracts';
import { localDateIn } from '../../../app/src/core/dates';
import { rulesBriefing } from '../../../app/src/core/emailBrief';
import type { Env } from '../env';
import { callStructured } from '../ai';
import { triageEmail } from '../../../app/src/core/rules';
import { keepId } from '../ops';
import { PROMPTS } from '../prompts';
import * as S from '../schemas';
import { HttpError, serviceClient } from '../supabase';
import { markAccount, providerFor } from './accounts';
import { ProviderError, type MailProvider, type ProviderKind } from './types';

interface Account { id: string; provider: ProviderKind; email_address: string; status: string; last_synced_at: string | null; digest_enabled: boolean; life_area_id: string | null }
interface Msg {
  id: string; account_id: string; provider_message_id: string; thread_id: string | null; from_name: string | null; from_address: string | null;
  subject: string | null; snippet: string | null; received_at: string; category: string | null; importance: number | null; summary: string | null;
}

const DAY = 86_400_000;
const MIN_RESYNC_MS = 2 * 60_000;

async function rows<T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new HttpError(400, 'db_error', error.message);
  return data ?? [];
}

async function withProvider<T>(env: Env, account: Account, fn: (p: MailProvider) => Promise<T>): Promise<T> {
  const p = await providerFor(env, account);
  try {
    return await fn(p);
  } catch (e) {
    if (e instanceof ProviderError && e.code === 'needs_reauth') await markAccount(env, account.id, 'needs_reauth', e.message);
    throw e;
  } finally {
    await p.close?.();
  }
}

// ───────────────────────── sync
export const SyncInput = z.object({ account_id: z.string().uuid().optional(), force: z.boolean().default(false) });

export async function syncAccounts(env: Env, db: SupabaseClient, userId: string, input: z.infer<typeof SyncInput>) {
  let q = db.from('email_accounts').select('*').eq('user_id', userId).neq('status', 'needs_reauth');
  if (input.account_id) q = q.eq('id', input.account_id);
  const accounts = await rows<Account>(q);
  const results: { id: string; status: string; fetched: number; error?: string }[] = [];

  for (const a of accounts) {
    if (!input.force && a.last_synced_at && Date.now() - new Date(a.last_synced_at).getTime() < MIN_RESYNC_MS) {
      results.push({ id: a.id, status: a.status, fetched: 0 });
      continue;
    }
    const since = a.last_synced_at
      ? new Date(Math.max(new Date(a.last_synced_at).getTime() - 2 * 3_600_000, Date.now() - 7 * DAY)).toISOString()
      : new Date(Date.now() - 3 * DAY).toISOString();
    try {
      const msgs = await withProvider(env, a, (p) => p.listRecent(since, 40));
      if (msgs.length) {
        // Gmail links are built from the message id and the account address; Outlook sends its own webLink.
        const link = (m: (typeof msgs)[number]) => m.web_link
          ?? (a.provider === 'gmail' ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(a.email_address)}#all/${m.provider_message_id}` : null);
        const { error } = await db.from('email_messages').upsert(
          msgs.map((m) => ({ ...m, web_link: link(m), user_id: userId, account_id: a.id })),
          { onConflict: 'account_id,provider_message_id' },
        );
        if (error) throw new HttpError(400, 'db_error', error.message);
      }
      await serviceClient(env).from('email_accounts').update({ last_synced_at: new Date().toISOString(), status: 'active', error_code: null }).eq('id', a.id);
      results.push({ id: a.id, status: 'active', fetched: msgs.length });
    } catch (e) {
      const code = e instanceof ProviderError || e instanceof HttpError ? e.code : 'sync_failed';
      if (code !== 'needs_reauth') await markAccount(env, a.id, 'error', code);
      results.push({ id: a.id, status: code === 'needs_reauth' ? 'needs_reauth' : 'error', fetched: 0, error: code });
    }
  }
  return results;
}

// ───────────────────────── triage
export async function triage(env: Env, db: SupabaseClient, userId: string, limit = 25) {
  const pending = await rows<Msg>(
    db.from('email_messages').select('id,account_id,provider_message_id,thread_id,from_name,from_address,subject,snippet,received_at,category,importance,summary')
      .eq('user_id', userId).is('triaged_at', null).eq('is_archived', false)
      .gte('received_at', new Date(Date.now() - 7 * DAY).toISOString())
      .order('received_at', { ascending: false }).limit(limit),
  );
  if (!pending.length) return 0;
  const [areas, goals, accounts] = await Promise.all([
    rows<{ id: string; name: string }>(db.from('life_areas').select('id,name').eq('user_id', userId).is('archived_at', null)),
    rows<{ id: string; title: string }>(db.from('goals').select('id,title').eq('user_id', userId).in('status', ['active', 'waiting', 'blocked']).limit(60)),
    rows<{ id: string; email_address: string; life_area_id: string | null }>(db.from('email_accounts').select('id,email_address,life_area_id').eq('user_id', userId)),
  ]);
  const acct = new Map(accounts.map((a) => [a.id, a]));

  const out = await callStructured(env, {
    operation: 'email_triage',
    promptVersion: PROMPTS.email_triage.version,
    system: PROMPTS.email_triage.system,
    user: {
      today: new Date().toISOString(),
      life_areas: areas,
      projects: goals,
      messages: pending.map((m) => ({
        id: m.id, from: [m.from_name, m.from_address].filter(Boolean).join(' '), subject: m.subject, preview: (m.snippet ?? '').slice(0, 500),
        received_at: m.received_at, inbox: acct.get(m.account_id)?.email_address,
        inbox_default_area: acct.get(m.account_id)?.life_area_id ?? null,
      })),
    },
    jsonSchema: S.emailTriageSchema,
    validator: EmailTriageOutput,
    maxOutputTokens: 5000,
    userId,
  });

  const ids = new Set(pending.map((m) => m.id));
  const areaIds = new Set(areas.map((a) => a.id));
  const goalIds = new Set(goals.map((g) => g.id));
  const byId = new Map(pending.map((m) => [m.id, m]));
  const now = new Date().toISOString();
  let n = 0;
  for (const t of out.messages) {
    if (!ids.has(t.id)) continue;
    ids.delete(t.id);
    const fallbackArea = acct.get(byId.get(t.id)!.account_id)?.life_area_id ?? null;
    await db.from('email_messages').update({
      category: t.category,
      importance: t.importance,
      summary: t.summary,
      life_area_id: keepId(t.life_area_id, areaIds) ?? fallbackArea,
      suggested_goal_id: keepId(t.suggested_goal_id, goalIds),
      suggested_actions: t.category === 'action_needed' ? t.suggested_actions.slice(0, 2) : [],
      triaged_at: now,
    }).eq('id', t.id);
    n++;
  }
  // Anything the model skipped is marked so it isn't re-sent forever.
  if (ids.size) await db.from('email_messages').update({ category: 'other', importance: 1, triaged_at: now }).in('id', [...ids]);
  return n;
}

/**
 * Keyword triage for when no AI is available. It fills in category/summary/suggestions but leaves triaged_at empty,
 * so AI triage picks these messages up (and improves them) once a provider is configured.
 */
export async function triageWithRules(db: SupabaseClient, userId: string, limit = 60) {
  const pending = await rows<Msg>(
    db.from('email_messages').select('id,account_id,provider_message_id,thread_id,from_name,from_address,subject,snippet,received_at,category,importance,summary')
      .eq('user_id', userId).is('triaged_at', null).is('category', null).eq('is_archived', false)
      .order('received_at', { ascending: false }).limit(limit),
  );
  if (!pending.length) return 0;
  const accounts = await rows<{ id: string; life_area_id: string | null }>(db.from('email_accounts').select('id,life_area_id').eq('user_id', userId));
  const areaFor = new Map(accounts.map((a) => [a.id, a.life_area_id]));
  for (const m of pending) {
    const t = triageEmail(m);
    await db.from('email_messages').update({
      category: t.category, importance: t.importance, summary: t.summary, suggested_actions: t.suggested_actions,
      life_area_id: areaFor.get(m.account_id) ?? null,
    }).eq('id', m.id);
  }
  return pending.length;
}

// ───────────────────────── digest
export const DigestInput = z.object({ regenerate: z.boolean().default(false) });

/** Today's date for this person, from the time zone the app saved on their profile. */
export async function personToday(db: SupabaseClient, userId: string, days = 0): Promise<string> {
  const { data } = await db.from('profiles').select('timezone').eq('id', userId).maybeSingle();
  return localDateIn((data as { timezone?: string } | null)?.timezone, days);
}

export async function buildDigest(env: Env, db: SupabaseClient, userId: string, input: z.infer<typeof DigestInput>, aiEnabled = true) {
  const today = await personToday(db, userId);
  const { data: existing } = await db.from('email_digests').select('*').eq('user_id', userId).eq('digest_date', today).maybeSingle();
  // A briefing the person's own AI chat wrote is never replaced automatically; only a new one from the chat replaces it.
  if (existing && (!input.regenerate || (existing as { source?: string }).source === 'chat')) return existing;
  const enabled = await rows<{ id: string }>(db.from('email_accounts').select('id').eq('user_id', userId).eq('digest_enabled', true));
  if (!enabled.length) return null;
  const msgs = await rows<Msg>(
    db.from('email_messages').select('id,account_id,provider_message_id,thread_id,from_name,from_address,subject,snippet,received_at,category,importance,summary,is_unread,status')
      .eq('user_id', userId).in('account_id', enabled.map((a) => a.id)).eq('is_archived', false)
      .gte('received_at', new Date(Date.now() - DAY).toISOString())
      .order('importance', { ascending: false }).order('received_at', { ascending: false }).limit(60),
  );
  // Rules first (always works, no AI): a cohesive summary and a ranked "do first" list.
  const projects = await rows<{ id: string; title: string }>(db.from('goals').select('id,title').eq('user_id', userId).in('status', ['active', 'waiting', 'blocked']).limit(60));
  const brief = rulesBriefing(msgs as never, projects);
  const counts = brief.counts;
  let summary = brief.summary;
  let doFirstList = brief.do_first;
  let source: 'rules' | 'ai' = 'rules';
  let highlights: { message_id: string; text: string }[] = doFirstList.map((d) => ({ message_id: d.message_id, text: d.why }));
  if (aiEnabled && msgs.length) {
    try {
      const out = await callStructured(env, {
        operation: 'email_digest',
        promptVersion: PROMPTS.email_digest.version,
        system: PROMPTS.email_digest.system,
        user: { counts, messages: msgs.map((m) => ({ id: m.id, from: m.from_name ?? m.from_address, subject: m.subject, category: m.category, importance: m.importance, summary: m.summary })) },
        jsonSchema: S.emailDigestSchema,
        validator: EmailDigestOutput,
        maxOutputTokens: 900,
        userId,
      });
      const ids = new Set(msgs.map((m) => m.id));
      summary = out.summary;
      highlights = out.highlights.filter((h) => ids.has(h.message_id));
      doFirstList = highlights.map((h) => ({ message_id: h.message_id, why: h.text }));
      source = 'ai';
    } catch { /* the rules briefing stands */ }
  }
  const { data, error } = await db.from('email_digests')
    .upsert({ user_id: userId, digest_date: today, summary, highlights, counts, do_first: doFirstList, source, author: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,digest_date' })
    .select('*').single();
  if (error) throw new HttpError(400, 'db_error', error.message);
  return data;
}

// ───────────────────────── thread summary
export const ThreadInput = z.object({ message_id: z.string().uuid() });

export async function summarizeThread(env: Env, db: SupabaseClient, userId: string, input: z.infer<typeof ThreadInput>) {
  const { data: msg } = await db.from('email_messages').select('id,account_id,provider_message_id,thread_id,subject').eq('id', input.message_id).maybeSingle();
  if (!msg) throw new HttpError(404, 'not_found');
  const { data: account } = await db.from('email_accounts').select('*').eq('id', msg.account_id).single();
  const text = await withProvider(env, account as Account, (p) => p.threadText(msg, 14_000));
  if (!text.trim()) throw new HttpError(422, 'empty_thread');
  const out = await callStructured(env, {
    operation: 'email_thread_summary',
    promptVersion: PROMPTS.email_thread_summary.version,
    system: PROMPTS.email_thread_summary.system,
    user: { today: new Date().toISOString(), me: (account as Account).email_address, thread: text },
    jsonSchema: S.emailThreadSchema,
    validator: EmailThreadOutput,
    maxOutputTokens: 1200,
    userId,
  });
  await db.from('email_messages').update({ thread_summary: out.summary, thread_next_steps: out.next_steps, status: 'reviewed' }).eq('id', msg.id);
  return out;
}

// ───────────────────────── mailbox actions
export const ModifyInput = z.object({
  message_ids: z.array(z.string().uuid()).min(1).max(50),
  op: z.enum(['archive', 'mark_read', 'label', 'dismiss']),
  label: z.string().trim().min(1).max(60).optional(),
});

export async function modifyMessages(env: Env, db: SupabaseClient, userId: string, input: z.infer<typeof ModifyInput>) {
  const msgs = await rows<{ id: string; account_id: string; provider_message_id: string; labels: string[] }>(
    db.from('email_messages').select('id,account_id,provider_message_id,labels').eq('user_id', userId).in('id', input.message_ids),
  );
  if (input.op === 'dismiss') {
    // App-only: hide from Needs Action without touching the mailbox.
    await db.from('email_messages').update({ status: 'dismissed' }).in('id', msgs.map((m) => m.id));
    return { ok: true, updated: msgs.length };
  }
  if (input.op === 'label' && !input.label) throw new HttpError(400, 'invalid_input');
  const byAccount = new Map<string, typeof msgs>();
  for (const m of msgs) byAccount.set(m.account_id, [...(byAccount.get(m.account_id) ?? []), m]);
  const accounts = await rows<Account>(db.from('email_accounts').select('*').in('id', [...byAccount.keys()]));
  const failed: string[] = [];
  for (const a of accounts) {
    const group = byAccount.get(a.id)!;
    const pids = group.map((m) => m.provider_message_id);
    try {
      await withProvider(env, a, (p) => (input.op === 'archive' ? p.archive(pids) : input.op === 'mark_read' ? p.markRead(pids) : p.label(pids, input.label!)));
      const ids = group.map((m) => m.id);
      if (input.op === 'archive') await db.from('email_messages').update({ is_archived: true, status: 'reviewed' }).in('id', ids);
      else if (input.op === 'mark_read') await db.from('email_messages').update({ is_unread: false }).in('id', ids);
      else for (const m of group) await db.from('email_messages').update({ labels: [...new Set([...m.labels, input.label!])] }).eq('id', m.id);
    } catch (e) {
      failed.push(a.id);
      console.warn('mailbox action failed', { op: input.op, code: e instanceof ProviderError ? e.code : 'error' });
    }
  }
  if (failed.length === accounts.length && accounts.length) throw new HttpError(502, 'mailbox_unavailable');
  return { ok: true, failed_accounts: failed };
}

// ───────────────────────── for the AI-chat connector: the person's own AI reads mail and writes the briefing

/** Plain text of a conversation (no AI involved), for the person's own AI to read. */
export async function threadTextFor(env: Env, db: SupabaseClient, messageId: string, maxChars = 12_000) {
  const { data: msg } = await db.from('email_messages').select('id,account_id,provider_message_id,thread_id,subject').eq('id', messageId).maybeSingle();
  if (!msg) throw new HttpError(404, 'not_found');
  const { data: account } = await db.from('email_accounts').select('*').eq('id', msg.account_id).single();
  const text = await withProvider(env, account as Account, (p) => p.threadText(msg, maxChars));
  return { subject: msg.subject as string | null, inbox: (account as Account).email_address, text };
}

export const BriefingInput = z.object({
  summary: z.string().trim().min(1).max(1500),
  do_first: z.array(z.object({ message_id: z.string().uuid(), why: z.string().trim().min(1).max(200) })).max(10).default([]),
  message_notes: z.array(z.object({ message_id: z.string().uuid(), summary: z.string().trim().min(1).max(300) })).max(40).default([]),
});

/**
 * Saves a briefing written by the person's AI chat as today's digest (source "chat"). It shows at the top of Inbox and on
 * Today until the chat writes a new one. Optional one-line notes replace Momentum's own per-email summaries.
 */
export async function saveChatBriefing(db: SupabaseClient, userId: string, input: z.infer<typeof BriefingInput>, author: string | null) {
  const today = await personToday(db, userId);
  const ids = [...new Set([...input.do_first.map((d) => d.message_id), ...input.message_notes.map((n) => n.message_id)])];
  const known = ids.length ? await rows<{ id: string }>(db.from('email_messages').select('id').eq('user_id', userId).in('id', ids)) : [];
  const ok = new Set(known.map((k) => k.id));
  const doFirstList = input.do_first.filter((d) => ok.has(d.message_id));
  for (const n of input.message_notes.filter((x) => ok.has(x.message_id))) {
    await db.from('email_messages').update({ summary: n.summary }).eq('id', n.message_id);
  }
  const recent = await rows<{ category: string | null }>(db.from('email_messages').select('category').eq('user_id', userId).eq('is_archived', false)
    .gte('received_at', new Date(Date.now() - DAY).toISOString()));
  const counts: Record<string, number> = { total: recent.length };
  for (const m of recent) counts[m.category ?? 'other'] = (counts[m.category ?? 'other'] ?? 0) + 1;
  const { error } = await db.from('email_digests').upsert({
    user_id: userId, digest_date: today, summary: input.summary, do_first: doFirstList,
    highlights: doFirstList.map((d) => ({ message_id: d.message_id, text: d.why })), counts,
    source: 'chat', author, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,digest_date' });
  if (error) throw new HttpError(400, 'db_error', error.message);
  return { saved: true, do_first: doFirstList.length, skipped_unknown_ids: input.do_first.length - doFirstList.length };
}
