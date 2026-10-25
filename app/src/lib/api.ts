import { Platform } from 'react-native';
import { DEMO, demoApi } from './demo';
import { supabase } from './supabase';

// Web is served from todos.jamry.us with the Worker on /api, so a relative path works there.
const BASE =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'https://todos.jamry.us');

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body?: Record<string, unknown>) {
    super(code);
  }
  /** True when the failure means "AI can't help right now" — callers fall back to manual flows. */
  get aiUnavailable() {
    return this.status === 0 || this.status >= 500 || ['ai_disabled', 'rate_limited', 'daily_ai_budget_reached'].includes(this.code);
  }
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ApiError(401, 'unauthenticated');
  return data.session.access_token;
}

export async function api<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  if (DEMO) {
    try { return (await demoApi(path, body as Record<string, unknown>)) as T; }
    catch { throw new ApiError(503, 'ai_unavailable'); }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
      body: isForm ? (body as FormData) : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new ApiError(res.status, String(json?.error ?? 'request_failed'), json ?? undefined);
    // A 200 that isn't JSON means the API isn't deployed on this host — treat as unavailable.
    if (!json) throw new ApiError(502, 'bad_response');
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, (e as Error).name === 'AbortError' ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
}

export function friendlyAiError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Your work is safe.';
  switch (e.code) {
    case 'ai_disabled':
      return 'AI is turned off in Settings. You can still organize things yourself.';
    case 'rate_limited':
    case 'daily_ai_budget_reached':
      return "AI has reached today's limit. Everything else still works.";
    case 'offline':
      return "You're offline. Organized without AI — please check the items.";
    case 'ai_not_configured':
      return "AI isn't set up yet. Organized without AI — please check the items.";
    case 'email_not_configured':
    case 'gmail_not_configured':
    case 'outlook_not_configured':
      return "Email connections aren't set up on the server yet.";
    case 'needs_reauth':
      return 'This inbox needs to be reconnected.';
    case 'imap_login_failed':
      return 'The mail server rejected that username or app password.';
    case 'imap_unreachable':
      return "Couldn't reach that mail server. Check the server name.";
    case 'mailbox_unavailable':
      return "Your mailbox didn't respond. Nothing was changed.";
    default:
      return "AI couldn't help this time. Organized without AI — please check the items.";
  }
}
