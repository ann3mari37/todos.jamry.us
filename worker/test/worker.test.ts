import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { callStructured } from '../src/ai';
import { NudgeOutput } from '../../app/src/core/ai-contracts';
import { nudgeSchema } from '../src/schemas';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  ALLOWED_ORIGINS: 'https://todos.jamry.us',
};

type Route = (url: string, init?: RequestInit) => Response | undefined;
function mockFetch(...routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const r of routes) {
      const res = r(url, init);
      if (res) return res;
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const claude = (text: string): Route => (url) =>
  url.includes('api.anthropic.com')
    ? jsonRes({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 } })
    : undefined;

afterEach(() => vi.unstubAllGlobals());

const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://todos.jamry.us${path}`, { method: 'POST', ...init, headers: { Origin: 'https://todos.jamry.us', ...(init.headers ?? {}) } });

describe('worker routing & security', () => {
  it('health is public and CORS is restricted to the app origin', async () => {
    const res = await worker.fetch(new Request('https://todos.jamry.us/api/health', { headers: { Origin: 'https://evil.example' } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://todos.jamry.us');
  });

  it('rejects requests without a Supabase token', async () => {
    mockFetch();
    const res = await worker.fetch(req('/api/ai/interpret-capture', { body: '{"text":"hi"}' }), env);
    expect(res.status).toBe(401);
  });

  it('rejects tokens Supabase does not recognise', async () => {
    mockFetch((u) => (u.includes('/auth/v1/user') ? jsonRes({ msg: 'bad' }, 401) : undefined));
    const res = await worker.fetch(req('/api/ai/interpret-capture', { body: '{"text":"hi"}', headers: { Authorization: 'Bearer x' } }), env);
    expect(res.status).toBe(401);
  });

  it('rejects oversized bodies and invalid input', async () => {
    mockFetch((u) => (u.includes('/auth/v1/user') ? jsonRes({ id: '11111111-1111-4111-8111-111111111111' }) : undefined));
    const big = await worker.fetch(req('/api/capture/commit', { body: 'x'.repeat(70_000), headers: { Authorization: 'Bearer t' } }), env);
    expect(big.status).toBe(413);
    const bad = await worker.fetch(req('/api/capture/commit', { body: '{"items":[]}', headers: { Authorization: 'Bearer t' } }), env);
    expect(bad.status).toBe(400);
  });

  it('reports ai_not_configured instead of failing when no Claude key is set', async () => {
    mockFetch((u) => (u.includes('/auth/v1/user') ? jsonRes({ id: '11111111-1111-4111-8111-111111111111' }) : undefined));
    const res = await worker.fetch(req('/api/ai/interpret-capture', { body: '{"text":"hi"}', headers: { Authorization: 'Bearer t' } }), { ...env, ANTHROPIC_API_KEY: '' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_not_configured' });
  });
});

describe('structured AI calls', () => {
  const call = { operation: 'generate_accountability_nudge', promptVersion: 'v1', system: 's', user: {}, jsonSchema: nudgeSchema, validator: NudgeOutput, maxOutputTokens: 100, userId: 'u' };

  it('returns validated output', async () => {
    mockFetch(claude(JSON.stringify({ message: 'Want help finding a smaller step?' })));
    expect(await callStructured(env, call)).toEqual({ message: 'Want help finding a smaller step?' });
  });

  it('rejects output with unexpected fields (after one retry)', async () => {
    const calls = mockFetch(claude(JSON.stringify({ message: 'Want help finding a smaller step?', extra: true })));
    await expect(callStructured(env, call)).rejects.toMatchObject({ code: 'ai_unavailable' });
    expect(calls.filter((c) => c.includes('api.anthropic.com')).length).toBe(2);
  });

  it('rejects oversized context before calling the model', async () => {
    const calls = mockFetch();
    await expect(callStructured(env, { ...call, user: 'x'.repeat(30_000) })).rejects.toMatchObject({ status: 413 });
    expect(calls.length).toBe(0);
  });
});
