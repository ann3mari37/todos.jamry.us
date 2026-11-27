// A one-time pass from the MaLinda Perry cockpit to her LinkHub (links.malindaperryconsulting.com).
// LinkHub signs families in by username alone, so it must not do that for anyone who just knows the address.
// Instead the cockpit, signed in as an allowed Tasks account, asks here for a pass: a signed note saying
// "sign in as <username> at <host>", good once and for two minutes. LinkHub checks the signature with the same
// secret (its HANDOFF_KEY), the address, the time and that the pass hasn't been used, then signs the visitor in.
// Anyone reaching LinkHub any other way gets its normal sign-in page.

import { b64url } from './crypto';
import type { Env } from './env';
import { HttpError } from './supabase';

export const LINKS_HOST = 'links.malindaperryconsulting.com';
const enc = new TextEncoder();

export interface HandoffPass { u: string; h: string; exp: number; n: string }

/** Signs a pass with the shared secret: base64url(JSON).base64url(HMAC-SHA256). exp is in seconds. */
export async function signPass(secret: string, pass: HandoffPass): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(pass)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))))}`;
}

const list = (v: string | undefined) => String(v ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

/**
 * POST /api/links/handoff — only for the accounts in LINKS_HANDOFF_USERS (by account ID) or LINKS_HANDOFF_EMAILS.
 * The ID is the one to rely on: it stays the same when the account's email changes, the email doesn't.
 */
export async function handoff(env: Env, email: string | null, now = Date.now(), userId: string | null = null) {
  if (!env.LINKS_HANDOFF_KEY || !env.LINKS_USERNAME) throw new HttpError(503, 'links_not_configured');
  const byId = !!userId && list(env.LINKS_HANDOFF_USERS).includes(userId.toLowerCase());
  const byEmail = !!email && list(env.LINKS_HANDOFF_EMAILS).includes(email.toLowerCase());
  if (!byId && !byEmail) throw new HttpError(403, 'links_not_allowed');
  const pass: HandoffPass = {
    u: env.LINKS_USERNAME, h: LINKS_HOST, exp: Math.floor(now / 1000) + 120,
    n: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  return { url: `https://${LINKS_HOST}/handoff?t=${await signPass(env.LINKS_HANDOFF_KEY, pass)}` };
}
