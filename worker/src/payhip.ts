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

// Past sales. Payhip's API has no way to list sales (it covers coupons and license keys only), and webhooks start
// when a store is added, so history comes from the sales export (CSV) downloaded from Payhip. Columns are found by
// their header names, since the export's exact layout isn't documented. Rows of one order (same transaction id)
// are combined. Buyer details in the file are never read or kept.

/** Splits CSV text into rows of cells (quotes, commas and line breaks inside quotes, CRLF). */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const csvDate = (s: string): string | null => {
  if (!s) return null;
  for (const v of [s, s.replace(' ', 'T')]) { const t = Date.parse(v); if (!Number.isNaN(t)) return new Date(t).toISOString(); }
  return null;
};

export type ImportedSale = { payhip_id: string; amount: number; currency: string | null; items: string[]; sold_at: string; refunded: boolean };

/** Reads a Payhip sales export. Returns the sales, or null when the file doesn't look like one (no date or amount column). */
export function parseSalesCsv(text: string): ImportedSale[] | null {
  const rows = csvRows(text);
  if (rows.length < 2) return rows.length === 1 ? [] : null;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...res: RegExp[]) => { for (const re of res) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) return i; } return -1; };
  const iId = col(/transaction.?id/, /order.?id/, /^id$/, /transaction|order|reference/);
  const iDate = col(/^date$/, /date|created|paid at|purchased/);
  // The amount the buyer paid (what webhooks report), before Payhip's or PayPal/Stripe's fees.
  const iAmt = col(/^(price|total|amount)$/, /total|amount paid|price paid|^price|gross|amount/, /earning|net/);
  const iCur = col(/currency/);
  const iItem = col(/product.?name|^product$|item.?name|^item$|^title$/, /product|item/);
  const iStatus = col(/refund/, /status/);
  if (iDate < 0 || iAmt < 0) return null;
  const byId = new Map<string, ImportedSale>();
  for (const r of rows.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const amount = num(cell(iAmt));
    const sold_at = csvDate(cell(iDate));
    if (amount === null || !sold_at) continue;
    const item = cell(iItem).slice(0, 200);
    const status = cell(iStatus).toLowerCase();
    const refunded = /refund/.test(status) || status === 'yes' || status === 'true';
    // No transaction id column: build a stable one, so importing the same file twice doesn't count sales twice.
    const id = (cell(iId) || `csv-${sold_at}-${amount}-${item}`).slice(0, 120);
    const cur = cell(iCur).slice(0, 8).toUpperCase() || null;
    const prev = byId.get(id);
    if (prev) {
      prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      if (item && !prev.items.includes(item) && prev.items.length < 20) prev.items.push(item);
      prev.refunded = prev.refunded || refunded;
    } else byId.set(id, { payhip_id: id, amount, currency: cur, items: item ? [item] : [], sold_at, refunded });
  }
  return [...byId.values()];
}

export const ImportInput = z.object({ store_id: z.string().uuid(), csv: z.string().min(1).max(5_000_000) });

/** POST /api/payhip/import — add past sales from Payhip's export to one of the signed-in person's stores. */
export async function importSales(env: Env, db: SupabaseClient, input: z.infer<typeof ImportInput>) {
  const { data: store } = await db.from('payhip_stores').select('id,user_id').eq('id', input.store_id).maybeSingle(); // RLS: own stores only
  if (!store) throw new HttpError(404, 'not_found');
  const sales = parseSalesCsv(input.csv);
  if (!sales) throw new HttpError(400, 'not_a_sales_export');
  const rows = sales.map((s) => ({ user_id: store.user_id, store_id: store.id, ...s }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    // Sales already here (from the webhook or an earlier import) are left as they are.
    const { data, error } = await serviceClient(env).from('payhip_sales')
      .upsert(rows.slice(i, i + 500), { onConflict: 'store_id,payhip_id', ignoreDuplicates: true }).select('id');
    if (error) throw new HttpError(500, 'import_failed');
    added += data?.length ?? 0;
  }
  return { found: sales.length, added };
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
