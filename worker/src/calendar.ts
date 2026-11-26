// Google Calendar for the MaLinda Perry cockpit: every calendar of every connected Google account, in one week view,
// and adding events from the cockpit. Reuses the Gmail connection (same Google sign-in, calendar scopes added).
// Each call is one Worker request; the cockpit loads the week once and again after an add.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { googleAccessToken } from './email/accounts';
import { ProviderError } from './email/types';
import { HttpError } from './supabase';

const API = 'https://www.googleapis.com/calendar/v3';
const MAX_CALENDARS = 20;

interface Account { id: string; email_address: string; status: string }

async function gcal<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (res.status === 401 || res.status === 403) throw new ProviderError('needs_reauth', `calendar_${res.status}`);
  if (!res.ok) throw new ProviderError('provider_error', `calendar_${res.status}`);
  return (await res.json()) as T;
}

/** The user's Gmail accounts (RLS limits this to their own). */
async function googleAccounts(db: SupabaseClient): Promise<Account[]> {
  const { data, error } = await db.from('email_accounts').select('id,email_address,status').eq('provider', 'gmail');
  if (error) throw new HttpError(500, 'accounts_failed');
  return (data ?? []) as Account[];
}

async function ownAccount(db: SupabaseClient, accountId: string): Promise<Account> {
  const acct = (await googleAccounts(db)).find((a) => a.id === accountId);
  if (!acct) throw new HttpError(404, 'not_found');
  return acct;
}

/** POST /api/calendar/list — every calendar on every connected Google account. */
export async function listCalendars(env: Env, db: SupabaseClient) {
  const accounts = await googleAccounts(db);
  const out = await Promise.all(accounts.map(async (a) => {
    try {
      const token = await googleAccessToken(env, a.id);
      const r = await gcal<{ items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; accessRole?: string }[] }>(token, '/users/me/calendarList?minAccessRole=reader&maxResults=100');
      return {
        account_id: a.id, email: a.email_address, status: 'ok' as const,
        calendars: (r.items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, color: c.backgroundColor ?? null, primary: !!c.primary, can_add: c.accessRole === 'owner' || c.accessRole === 'writer' })),
      };
    } catch (e) {
      // An account connected before calendar access was added has to reconnect once.
      const code = e instanceof ProviderError ? e.code : 'provider_error';
      return { account_id: a.id, email: a.email_address, status: code === 'needs_reauth' ? 'needs_calendar_access' as const : 'error' as const, calendars: [] };
    }
  }));
  return { accounts: out };
}

export const EventsInput = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  calendars: z.array(z.object({ account_id: z.string().uuid(), calendar_id: z.string().min(1).max(300) })).max(MAX_CALENDARS),
});

/** POST /api/calendar/events — events between from and to on the chosen calendars, flattened. */
export async function listEvents(env: Env, db: SupabaseClient, input: z.infer<typeof EventsInput>) {
  if (new Date(input.to).getTime() - new Date(input.from).getTime() > 45 * 86400_000) throw new HttpError(400, 'range_too_long');
  const own = new Set((await googleAccounts(db)).map((a) => a.id));
  const tokens = new Map<string, Promise<string>>();
  const token = (id: string) => { if (!tokens.has(id)) tokens.set(id, googleAccessToken(env, id)); return tokens.get(id)!; };
  const q = new URLSearchParams({ timeMin: input.from, timeMax: input.to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const failed: { account_id: string; calendar_id: string }[] = [];
  const lists = await Promise.all(input.calendars.filter((c) => own.has(c.account_id)).map(async (c) => {
    try {
      const r = await gcal<{ items?: GEvent[] }>(await token(c.account_id), `/calendars/${encodeURIComponent(c.calendar_id)}/events?${q}`);
      return (r.items ?? []).filter((e) => e.status !== 'cancelled').map((e) => ({
        id: e.id, account_id: c.account_id, calendar_id: c.calendar_id, title: e.summary ?? '(No title)', location: e.location ?? null,
        all_day: !e.start?.dateTime, start: e.start?.dateTime ?? e.start?.date ?? null, end: e.end?.dateTime ?? e.end?.date ?? null,
        link: e.htmlLink ?? null,
      }));
    } catch {
      failed.push(c);
      return [];
    }
  }));
  return { events: lists.flat(), failed };
}
interface GEvent { id: string; status?: string; summary?: string; location?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }

export const CreateInput = z.object({
  account_id: z.string().uuid(),
  calendar_id: z.string().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  time_zone: z.string().max(60).optional(),
  location: z.string().max(300).optional(),
});

/** POST /api/calendar/create — add an event to one of the user's Google calendars. */
export async function createEvent(env: Env, db: SupabaseClient, input: z.infer<typeof CreateInput>) {
  await ownAccount(db, input.account_id);
  if (new Date(input.end) <= new Date(input.start)) throw new HttpError(400, 'end_before_start');
  const token = await googleAccessToken(env, input.account_id);
  const ev = await gcal<GEvent>(token, `/calendars/${encodeURIComponent(input.calendar_id)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: input.title, location: input.location,
      start: { dateTime: input.start, ...(input.time_zone ? { timeZone: input.time_zone } : {}) },
      end: { dateTime: input.end, ...(input.time_zone ? { timeZone: input.time_zone } : {}) },
    }),
  });
  return { id: ev.id, link: ev.htmlLink ?? null };
}
