import { z } from 'zod';
import { ApplyOrganizeInput, CommitCaptureInput } from '../../app/src/core/ai-contracts';
import { runScheduled } from './cron';
import { availableProviders, connectImap, disconnect, finishOAuth, startOAuth } from './email/accounts';
import * as email from './email/service';
import type { Env } from './env';
import { enforceLimits, transcribe } from './openai';
import * as ops from './ops';
import * as organize from './organize';
import { authenticate, HttpError } from './supabase';

const MAX_BODY = 64 * 1024;

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://todos.jamry.us').split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || (env.ENVIRONMENT === 'dev' && /^http:\/\/localhost:\d+$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'body_too_large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'body_too_large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new HttpError(400, 'invalid_input', JSON.stringify(r.error.issues.slice(0, 3)));
  return r.data;
}

type Handler = (req: Request, env: Env, ctx: { db: Awaited<ReturnType<typeof authenticate>>['db']; userId: string }) => Promise<unknown>;

const AI_ROUTES: Record<string, Handler> = {
  '/api/ai/interpret-capture': async (req, env, c) => ops.interpretCapture({ env, ...c }, parse(ops.InterpretInput, await readJson(req))),
  '/api/ai/decompose-goal': async (req, env, c) => ops.decomposeGoal({ env, ...c }, parse(ops.DecomposeInput, await readJson(req))),
  '/api/ai/classify-accomplishments': async (req, env, c) => ops.classifyAccomplishments({ env, ...c }, parse(ops.ClassifyInput, await readJson(req))),
  '/api/ai/blockers': async (req, env, c) => ops.identifyBlockers({ env, ...c }, parse(ops.BlockersInput, await readJson(req))),
  '/api/ai/weekly-summary': async (req, env, c) => ops.weeklySummary({ env, ...c }, parse(ops.SummaryInput, await readJson(req))),
  '/api/ai/organize': async (req, env, c) => organize.organizePreview({ env, ...c }, parse(organize.OrganizePreviewInput, await readJson(req))),
  '/api/ai/email-digest': async (req, env, c) => {
    const input = parse(email.DigestInput, await readJson(req));
    await ops.profile({ env, ...c });
    return { digest: await email.buildDigest(env, c.db, c.userId, input) };
  },
  '/api/ai/email-thread': async (req, env, c) => {
    const input = parse(email.ThreadInput, await readJson(req));
    await ops.profile({ env, ...c });
    return email.summarizeThread(env, c.db, c.userId, input);
  },
  '/api/ai/transcribe': async (req, env, c) => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'missing_audio');
    return { text: await transcribe(env, c.userId, file) };
  },
};

const DATA_ROUTES: Record<string, Handler> = {
  '/api/capture/commit': async (req, env, c) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const source = typeof body.source === 'string' ? body.source : 'text';
    delete body.source;
    const ctx = { env, ...c };
    const result = (await ops.commitCapture(ctx, { ...parse(CommitCaptureInput, body), source })) as { items?: { kind: string; id: string }[] };
    // File new loose tasks into projects/areas when auto-organize is on. Never blocks or fails the commit.
    let organized = null;
    if (env.OPENAI_API_KEY && result.items?.length) {
      try {
        await enforceLimits(env, c.userId);
        organized = await organize.autoOrganize(ctx, result.items, source === 'email' ? 'email' : 'capture');
      } catch { /* over limit — skip */ }
    }
    return { ...result, organized };
  },
  '/api/organize/apply': async (req, env, c) => organize.organizeApply({ env, ...c }, parse(ApplyOrganizeInput, await readJson(req))),
  '/api/organize/undo': async (req, env, c) => organize.organizeUndo({ env, ...c }, parse(organize.UndoOrganizeInput, await readJson(req))),

  '/api/email/providers': async (_req, env) => availableProviders(env),
  '/api/email/connect': async (req, env, c) => {
    const input = parse(z.object({ provider: z.enum(['gmail', 'outlook']), return_to: z.string().max(200).optional() }), await readJson(req));
    return startOAuth(env, c.userId, input.provider, input.return_to);
  },
  '/api/email/connect-imap': async (req, env, c) => {
    const input = parse(z.object({
      email: z.string().email().max(200), host: z.string().trim().min(3).max(200).regex(/^[a-z0-9.-]+$/i), port: z.number().int().default(993),
      username: z.string().min(1).max(200), password: z.string().min(1).max(500), archive_folder: z.string().max(100).optional(),
    }), await readJson(req));
    if (input.port !== 993) throw new HttpError(400, 'imap_tls_required');
    return connectImap(env, c.userId, input);
  },
  '/api/email/disconnect': async (req, env, c) => {
    const { account_id } = parse(z.object({ account_id: z.string().uuid() }), await readJson(req));
    const { data } = await c.db.from('email_accounts').select('id,provider').eq('id', account_id).maybeSingle(); // RLS: own accounts only
    if (!data) throw new HttpError(404, 'not_found');
    await disconnect(env, data);
    return { ok: true };
  },
  '/api/email/sync': async (req, env, c) => {
    const input = parse(email.SyncInput, await readJson(req));
    const accounts = await email.syncAccounts(env, c.db, c.userId, input);
    let triaged = 0;
    const { data: prof } = await c.db.from('profiles').select('ai_enabled').single();
    if (env.OPENAI_API_KEY && prof?.ai_enabled) {
      try {
        await enforceLimits(env, c.userId);
        triaged = await email.triage(env, c.db, c.userId);
      } catch { /* messages stay visible untriaged; next sync retries */ }
    }
    return { accounts, triaged };
  },
  '/api/email/modify': async (req, env, c) => email.modifyMessages(env, c.db, c.userId, parse(email.ModifyInput, await readJson(req))),
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const { pathname } = new URL(req.url);
    try {
      if (pathname === '/api/health') return json({ ok: true, ai: !!env.OPENAI_API_KEY, email: availableProviders(env), env: env.ENVIRONMENT ?? 'production' }, 200, headers);
      // OAuth providers redirect the browser here (GET, no bearer token); the signed state identifies the user.
      if (pathname === '/api/email/oauth/callback' && req.method === 'GET') return finishOAuth(env, new URL(req.url));
      const handler = AI_ROUTES[pathname] ?? DATA_ROUTES[pathname];
      if (!handler) throw new HttpError(404, 'not_found');
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const auth = await authenticate(req, env);
      if (AI_ROUTES[pathname]) {
        if (!env.OPENAI_API_KEY) throw new HttpError(503, 'ai_not_configured');
        await enforceLimits(env, auth.userId);
      }
      return json(await handler(req, env, { db: auth.db, userId: auth.userId }), 200, headers);
    } catch (e) {
      if (e instanceof HttpError) {
        // Error responses carry codes only — never task content.
        const extra = (e as HttpError & { capture_id?: string }).capture_id;
        return json({ error: e.code, ...(extra ? { capture_id: extra } : {}) }, e.status, headers);
      }
      console.error('unhandled', { path: pathname, name: (e as Error).name });
      return json({ error: 'internal_error' }, 500, headers);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
