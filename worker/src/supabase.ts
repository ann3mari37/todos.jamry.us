import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** A client acting as the signed-in user — every query is subject to RLS. */
export function userClient(env: Env, token: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...opts,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Privileged client. Only for operational logging and scheduled jobs. */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);
}

/** Verifies a Supabase-issued access token with Supabase Auth and returns the user id. */
export async function authenticate(req: Request, env: Env): Promise<{ userId: string; token: string; db: SupabaseClient }> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'unauthenticated');
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new HttpError(401, 'invalid_token');
  const user = (await res.json()) as { id?: string };
  if (!user.id) throw new HttpError(401, 'invalid_token');
  return { userId: user.id, token, db: userClient(env, token) };
}
