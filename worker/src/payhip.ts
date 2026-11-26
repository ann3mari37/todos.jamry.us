// Payhip sales for the MaLinda Perry cockpit. Each Payhip store gets its own secret webhook address; Payhip calls it
// on every sale ("paid") and refund, and the sale is saved for the cockpit to read (RLS: the owner only).
// One Worker request per sale. Nothing about the buyer (name, email) is stored: only what was sold and for how much.
//
// Payhip webhooks: https://help.payhip.com/article/115-webhooks. The secret address is the main check. Payhip also
// sends a "signature" field; when a store is added with its Payhip API key, the Worker keeps a SHA-256 of that key
// and requires signature to match it. (Confirm this against the article before relying on it.)

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { b64url } from './crypto';
import type { Env } from './env';
import { HttpError, serviceClient } from './supabase';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export const StoreInput = z.object({
  name: z.string().trim().min(1).max(80),
  company: z.enum(['mpc', 'hg', 'both']),
  api_key: z.string().trim().min(8).max(200).optional(),
});

/** POST /api/payhip/stores — add a store; returns its webhook address once (only a hash is kept). */
export async function addStore(env: Env, db: SupabaseClient, userId: string, input: z.infer<typeof StoreInput>) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const { data, error } = await db.from('payhip_stores').insert({
    user_id: userId, name: input.name, company: input.company,
    hook_token_hash: await sha256(token),
    signature_check: input.api_key ? await sha256(input.api_key) : null,
  }).select('id,name,company,created_at').single();
  if (error || !data) throw new HttpError(500, 'store_save_failed');
  return { store: data, webhook_url: `${(env.API_URL ?? env.APP_URL ?? 'https://todos.jamry.us').replace(/\/$/, '')}/api/payhip/hook/${token}` };
}

/** POST /api/payhip/stores/delete — remove a store and its sales. */
export async function deleteStore(db: SupabaseClient, storeId: string) {
  const { data } = await db.from('payhip_stores').delete().eq('id', storeId).select('id');
  if (!data?.length) throw new HttpError(404, 'not_found');
  return { ok: true };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const when = (v: unknown): string => {
  const n = num(v);
  if (n !== null && n > 1e9) return new Date(n < 1e12 ? n * 1000 : n).toISOString(); // unix seconds or ms
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return new Date().toISOString();
};

/** Pull what the cockpit needs out of a Payhip webhook body, tolerating field-name differences. */
export function parseSale(body: Record<string, unknown>) {
  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  const names = items.map((i) => String(i.product_name ?? i.name ?? i.product ?? '')).filter(Boolean).slice(0, 20);
  const itemTotal = items.reduce((s, i) => s + (num(i.price) ?? 0) * (num(i.quantity) ?? 1), 0);
  return {
    type: String(body.type ?? body.event ?? 'paid'),
    payhip_id: String(body.id ?? body.transaction_id ?? ''),
    amount: num(body.price) ?? num(body.amount) ?? num(body.total) ?? (itemTotal || 0),
    currency: typeof body.currency === 'string' ? body.currency.slice(0, 8).toUpperCase() : null,
    items: names,
    sold_at: when(body.date ?? body.created_at ?? body.paid_at),
  };
}

/** POST /api/payhip/hook/<token> — called by Payhip, no sign-in. Always answers quickly; never echoes data. */
export async function handleHook(req: Request, env: Env, token: string): Promise<Response> {
  const ok = () => new Response('ok', { status: 200 });
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response('not found', { status: 404 });
  const db = serviceClient(env);
  const { data: store } = await db.from('payhip_stores').select('id,user_id,signature_check').eq('hook_token_hash', await sha256(token)).maybeSingle();
  if (!store) return new Response('not found', { status: 404 });
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 64 * 1024) return new Response('too large', { status: 413 });
    body = (req.headers.get('Content-Type') ?? '').includes('application/x-www-form-urlencoded')
      ? Object.fromEntries(new URLSearchParams(text))
      : JSON.parse(text);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (store.signature_check && body.signature !== store.signature_check) return new Response('forbidden', { status: 403 });
  const sale = parseSale(body);
  if (!sale.payhip_id) return ok();
  if (sale.type === 'refunded') {
    await db.from('payhip_sales').update({ refunded: true }).eq('store_id', store.id).eq('payhip_id', sale.payhip_id);
    return ok();
  }
  if (sale.type !== 'paid') return ok(); // subscription events are ignored for now
  const { error } = await db.from('payhip_sales').upsert({
    user_id: store.user_id, store_id: store.id, payhip_id: sale.payhip_id, amount: sale.amount, currency: sale.currency,
    items: sale.items, sold_at: sale.sold_at,
  }, { onConflict: 'store_id,payhip_id' });
  if (error) {
    console.error('payhip save failed', { code: error.code });
    return new Response('error', { status: 500 }); // tells Payhip the delivery failed
  }
  return ok();
}
