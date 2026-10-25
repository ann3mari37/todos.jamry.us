import type { z } from 'zod';
import type { Env } from './env';
import { HttpError, serviceClient } from './supabase';

// USD per 1M tokens. Update when pricing or the configured model changes.
const PRICING: Record<string, { in: number; out: number }> = {
  'gpt-5-mini': { in: 0.25, out: 2.0 },
  'gpt-5-nano': { in: 0.05, out: 0.4 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
};

export interface StructuredCall<T> {
  operation: string;
  promptVersion: string;
  system: string;
  user: unknown; // serialised as JSON — only the minimal context for this operation
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  maxOutputTokens: number;
  userId: string;
  idempotencyKey?: string;
}

const MAX_INPUT_CHARS = 24_000;
const TIMEOUT_MS = 25_000;

async function log(env: Env, row: Record<string, unknown>) {
  try {
    await serviceClient(env).from('ai_operations').insert(row);
  } catch {
    /* logging must never break a request */
  }
}

/** Per-user hourly count and daily cost caps, enforced from ai_operations (Workers are stateless). */
export async function enforceLimits(env: Env, userId: string) {
  const db = serviceClient(env);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db
    .from('ai_operations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', hourAgo);
  if ((count ?? 0) >= Number(env.AI_HOURLY_LIMIT ?? 60)) throw new HttpError(429, 'rate_limited');
  const { data } = await db.from('ai_operations').select('cost_usd').eq('user_id', userId).gte('created_at', dayAgo);
  const spent = (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  if (spent >= Number(env.AI_DAILY_COST_CAP_USD ?? 1)) throw new HttpError(429, 'daily_ai_budget_reached');
}

export async function callStructured<T>(env: Env, call: StructuredCall<T>): Promise<T> {
  const model = env.OPENAI_MODEL ?? 'gpt-5-mini';
  const userContent = JSON.stringify(call.user);
  if (userContent.length > MAX_INPUT_CHARS) throw new HttpError(413, 'input_too_large');

  const body = {
    model,
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: userContent },
    ],
    max_completion_tokens: call.maxOutputTokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: call.operation, strict: true, schema: call.jsonSchema },
    },
  };

  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const latency = Date.now() - started;
      if (!res.ok) {
        // OpenAI uses 429 both for "slow down" and for "account has no credit"; only the first is worth retrying.
        // Log OpenAI's machine-readable reason (e.g. rate_limit_exceeded, model_not_found) — never message text.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string | null; type?: string | null } } | null;
        const errCode = body?.error?.code ?? body?.error?.type ?? undefined;
        const noCredit = errCode === 'insufficient_quota';
        lastErr = noCredit ? 'openai_insufficient_quota' : `openai_${res.status}${errCode ? `_${String(errCode).slice(0, 40)}` : ''}`;
        await log(env, { user_id: call.userId, operation: call.operation, model, prompt_version: call.promptVersion, status: res.status === 429 ? 'rate_limited' : 'error', latency_ms: latency, error_code: lastErr });
        if (noCredit) throw new HttpError(503, 'ai_quota', lastErr);
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        if (res.status >= 500) continue;
        break;
      }
      const json = (await res.json()) as {
        choices: { message: { content: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const price = PRICING[model] ?? { in: 1, out: 4 };
      const usage = json.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
      const cost = (usage.prompt_tokens * price.in + usage.completion_tokens * price.out) / 1_000_000;
      const content = json.choices[0]?.message?.content ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = undefined;
      }
      const result = call.validator.safeParse(parsed);
      await log(env, {
        user_id: call.userId, operation: call.operation, model, prompt_version: call.promptVersion,
        status: result.success ? 'ok' : 'invalid_output', input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens, cost_usd: cost, latency_ms: latency,
        idempotency_key: attempt === 0 ? call.idempotencyKey ?? null : null,
      });
      if (result.success) return result.data;
      lastErr = 'invalid_output';
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof HttpError) throw e;
      lastErr = (e as Error).name === 'AbortError' ? 'timeout' : 'network';
      await log(env, { user_id: call.userId, operation: call.operation, model, prompt_version: call.promptVersion, status: lastErr === 'timeout' ? 'timeout' : 'error', error_code: lastErr });
    }
  }
  throw new HttpError(502, 'ai_unavailable', lastErr);
}

export async function transcribe(env: Env, userId: string, audio: File): Promise<string> {
  if (audio.size > 10 * 1024 * 1024) throw new HttpError(413, 'audio_too_large');
  const model = env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';
  const form = new FormData();
  form.append('file', audio, audio.name || 'speech.m4a');
  form.append('model', model);
  const started = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  await log(env, { user_id: userId, operation: 'transcribe', model, prompt_version: 'v1', status: res.ok ? 'ok' : 'error', latency_ms: Date.now() - started, error_code: res.ok ? null : `openai_${res.status}` });
  if (!res.ok) throw new HttpError(502, 'transcription_failed');
  const json = (await res.json()) as { text: string };
  return json.text;
}
