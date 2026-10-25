import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { Env } from './env';
import { HttpError, serviceClient } from './supabase';

// AI is used for summarizing and expanding on projects; organizing itself is done by rules (app/src/core/rules.ts).
// Claude produces JSON that matches each operation's schema; the Zod validator then has the final say.

const DEFAULT_MODEL = 'claude-opus-5-5';

// USD per 1M tokens. Update when pricing or the configured model changes.
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
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
const TIMEOUT_MS = 60_000;

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

/** Maps a Claude API failure to the app's error codes (and a short code for the ai_operations log). */
function classify(e: unknown): { http: HttpError; code: string; status: 'rate_limited' | 'error' | 'timeout' } {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { http: new HttpError(503, 'ai_not_configured'), code: `claude_${e.status}`, status: 'error' };
  }
  if (e instanceof Anthropic.RateLimitError) return { http: new HttpError(429, 'rate_limited'), code: 'claude_429', status: 'rate_limited' };
  // An account without credit is reported as a 400; the error type carries no dedicated code, so check its wording.
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return { http: new HttpError(503, 'ai_quota'), code: 'claude_no_credit', status: 'error' };
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { http: new HttpError(502, 'ai_unavailable'), code: 'timeout', status: 'timeout' };
  if (e instanceof Anthropic.APIError) return { http: new HttpError(502, 'ai_unavailable'), code: `claude_${e.status ?? 'network'}`, status: 'error' };
  return { http: new HttpError(502, 'ai_unavailable'), code: 'network', status: 'error' };
}

export async function callStructured<T>(env: Env, call: StructuredCall<T>): Promise<T> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ai_not_configured');
  const model = env.AI_MODEL ?? DEFAULT_MODEL;
  const userContent = JSON.stringify(call.user);
  if (userContent.length > MAX_INPUT_CHARS) throw new HttpError(413, 'input_too_large');
  // The SDK retries transient failures (429/5xx/connection) itself; this loop only retries unusable output.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: TIMEOUT_MS });

  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const res = await client.beta.messages.create({
        model,
        // Thinking counts toward max_tokens, so leave room beyond the expected JSON.
        max_tokens: Math.min(16_000, Math.max(4000, call.maxOutputTokens * 4)),
        system: call.system,
        messages: [{ role: 'user', content: userContent }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: call.jsonSchema } },
        // If a safety classifier declines a benign request, the API re-runs it on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      const latency = Date.now() - started;
      const price = PRICING[res.model] ?? PRICING[model] ?? { in: 5, out: 25 };
      const cost = (res.usage.input_tokens * price.in + res.usage.output_tokens * price.out) / 1_000_000;
      let parsed: unknown;
      if (res.stop_reason === 'refusal') {
        lastErr = 'refusal';
      } else {
        const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      const result = parsed === undefined ? null : call.validator.safeParse(parsed);
      await log(env, {
        user_id: call.userId, operation: call.operation, model: res.model, prompt_version: call.promptVersion,
        status: result?.success ? 'ok' : 'invalid_output', input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens, cost_usd: cost, latency_ms: latency,
        error_code: result?.success ? null : lastErr === 'refusal' ? 'refusal' : res.stop_reason === 'max_tokens' ? 'max_tokens' : 'invalid_output',
        idempotency_key: attempt === 0 ? call.idempotencyKey ?? null : null,
      });
      if (result?.success) return result.data;
      if (lastErr !== 'refusal') lastErr = 'invalid_output';
    } catch (e) {
      const c = classify(e);
      await log(env, { user_id: call.userId, operation: call.operation, model, prompt_version: call.promptVersion, status: c.status, latency_ms: Date.now() - started, error_code: c.code });
      throw c.http; // the SDK already retried what was worth retrying
    }
  }
  throw new HttpError(502, 'ai_unavailable', lastErr);
}

/** Speech-to-text for the Speak button. Claude has no transcription API, so this optional feature uses OpenAI. */
export async function transcribe(env: Env, userId: string, audio: File): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, 'voice_not_configured');
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
