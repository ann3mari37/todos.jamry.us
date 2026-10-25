// Encryption for mailbox credentials (AES-GCM) and signed OAuth state (HMAC-SHA256), using Web Crypto.
// EMAIL_TOKEN_KEY is a base64-encoded 32-byte secret. Losing it means users must reconnect their inboxes.

import { HttpError } from './supabase';

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

function keyBytes(secret: string | undefined): Uint8Array {
  if (!secret) throw new HttpError(503, 'email_not_configured');
  const raw = unb64(secret);
  if (raw.length !== 32) throw new HttpError(503, 'email_not_configured', 'EMAIL_TOKEN_KEY must be 32 bytes');
  return raw;
}

const aesKey = (secret: string | undefined) =>
  crypto.subtle.importKey('raw', keyBytes(secret), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
const hmacKey = (secret: string | undefined) =>
  crypto.subtle.importKey('raw', keyBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** "v1.<iv>.<ciphertext>" — the version prefix leaves room for key rotation. */
export async function encrypt(secret: string | undefined, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decrypt(secret: string | undefined, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('bad ciphertext');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(secret), unb64(ct));
  return dec.decode(pt);
}

export interface OAuthState { u: string; p: 'gmail' | 'outlook'; r: string; exp: number; n: string }

export async function signState(secret: string | undefined, s: Omit<OAuthState, 'exp' | 'n'>): Promise<string> {
  const payload: OAuthState = { ...s, exp: Date.now() + 10 * 60_000, n: b64url(crypto.getRandomValues(new Uint8Array(9))) };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyState(secret: string | undefined, state: string): Promise<OAuthState> {
  const [body, sig] = state.split('.');
  if (!body || !sig) throw new HttpError(400, 'invalid_state');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body));
  if (!ok) throw new HttpError(400, 'invalid_state');
  const s = JSON.parse(dec.decode(unb64url(body))) as OAuthState;
  if (s.exp < Date.now()) throw new HttpError(400, 'state_expired');
  return s;
}
