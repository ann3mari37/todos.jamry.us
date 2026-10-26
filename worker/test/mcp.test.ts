import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: 'https://todos.jamry.us',
  APP_URL: 'https://todos.jamry.us',
};
const USER = '11111111-1111-4111-8111-111111111111';
const HOME = '00000000-0000-4000-8000-000000000901', HEALTH = '00000000-0000-4000-8000-000000000902';
const MOVE = '00000000-0000-4000-8000-000000000050';

afterEach(() => vi.unstubAllGlobals());

const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake Supabase: auth, the three list reads, and capture_entries inserts (recorded). */
function supabase() {
  const inserts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/auth/v1/user')) return jsonRes({ id: USER });
    if (url.includes('/.well-known/oauth-authorization-server/auth/v1')) return jsonRes({ issuer: 'https://sb.test/auth/v1', authorization_endpoint: 'https://sb.test/auth/v1/oauth/authorize' });
    if (url.includes('/rest/v1/life_areas')) return jsonRes([{ id: HOME, name: 'Home', archived_at: null, keywords: [] }, { id: HEALTH, name: 'Health', archived_at: null, keywords: [] }]);
    if (url.includes('/rest/v1/goals')) return jsonRes([{ id: MOVE, title: 'Move to the new apartment', status: 'active', life_area_id: HOME }]);
    if (url.includes('/rest/v1/actions')) return jsonRes([]);
    if (url.includes('/rest/v1/capture_entries') && init?.method === 'POST') {
      inserts.push(JSON.parse(String(init.body)));
      return jsonRes({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, 201);
    }
    return jsonRes([]);
  }));
  return inserts;
}

const rpc = (body: unknown, token: string | null = 'header.eyJjbGllbnRfaWQiOiJjbGF1ZGUifQ.sig') =>
  worker.fetch(new Request('https://todos.jamry.us/api/mcp', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }), env as never);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (body: unknown): Promise<any> => (await rpc(body)).json();

describe('MCP connector', () => {
  it('asks unauthenticated chats to sign in, pointing at the resource metadata', async () => {
    supabase();
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, null);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer resource_metadata="https://todos.jamry.us/.well-known/oauth-protected-resource/api/mcp"');
  });

  it('publishes protected-resource metadata naming Supabase as the authorization server', async () => {
    const res = await worker.fetch(new Request('https://todos.jamry.us/.well-known/oauth-protected-resource/api/mcp'), env as never);
    expect(await res.json()).toMatchObject({ resource: 'https://todos.jamry.us/api/mcp', authorization_servers: ['https://sb.test/auth/v1'] });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('names the address the chat connected to, when the app runs at several', async () => {
    const both = { ...env, ALLOWED_ORIGINS: 'https://todos.jamry.us,https://dashboard.malindaperryconsulting.com' };
    const res = await worker.fetch(new Request('https://dashboard.malindaperryconsulting.com/.well-known/oauth-protected-resource/api/mcp'), both as never);
    expect(await res.json()).toMatchObject({ resource: 'https://dashboard.malindaperryconsulting.com/api/mcp' });
    const other = await worker.fetch(new Request('https://evil.example/.well-known/oauth-protected-resource/api/mcp'), both as never);
    expect(await other.json()).toMatchObject({ resource: 'https://todos.jamry.us/api/mcp' });
  });

  it('passes Supabase authorization-server metadata through for older clients', async () => {
    supabase();
    const res = await worker.fetch(new Request('https://todos.jamry.us/.well-known/oauth-authorization-server'), env as never);
    expect(await res.json()).toMatchObject({ issuer: 'https://sb.test/auth/v1' });
  });

  it('initializes, lists tools, and accepts notifications', async () => {
    supabase();
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.capabilities.tools).toBeDefined();
    const odd = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(odd.result.protocolVersion).toBe('2025-11-25');
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['get_overview', 'get_today', 'send_plan', 'add_task', 'create_project', 'update_task', 'update_project', 'park_project', 'complete_task', 'get_inbox', 'read_email_thread', 'save_email_briefing', 'email_action']);
    const missing = await call({ jsonrpc: '2.0', id: 4, method: 'nope' });
    expect(missing.error.code).toBe(-32601);
  });

  it('send_plan stores a reviewable handoff filed by the rules', async () => {
    const inserts = supabase();
    const out = await call({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'send_plan', arguments: { summary: 'Getting ready for the move on the 15th: a few errands and the trip.', items: [
        { kind: 'task', title: 'Book a dentist cleaning' },
        { kind: 'task', title: 'Pack the kitchen', project: 'move' },
        { kind: 'project', title: 'Plan a trip to Portland', area: 'home' },
      ] } },
    });
    expect(out.result.isError).toBeUndefined();
    expect(out.result.structuredContent.review_link).toBe('https://todos.jamry.us/capture?handoff=cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const row = inserts[0] as { source: string; status: string; interpretation: { client: string; items: { kind: string; suggested_life_area_id: string | null; suggested_goal_id: string | null; next_actions: unknown[]; meaning: string }[] } };
    expect(row).toMatchObject({ source: 'chat', status: 'interpreted' });
    expect(row.interpretation.client).toBe('claude');
    const [dentist, pack, trip] = row.interpretation.items;
    expect(dentist.suggested_life_area_id).toBe(HEALTH);
    expect(pack.suggested_goal_id).toBe(MOVE);
    expect(trip).toMatchObject({ kind: 'goal', suggested_life_area_id: HOME });
    expect(trip.next_actions.length).toBeGreaterThan(0);
    expect(trip.meaning.length).toBeGreaterThan(0);
  });

  it('parks and unpacks a project in place: only its status and revisit info change, nothing is deleted or moved', async () => {
    supabase();
    const calls: { method: string; url: string; body: unknown }[] = [];
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/rest/v1/')) calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return base(input, init);
    }));
    const park = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'park_project', arguments: { id: MOVE, revisit_when: 'after the lease is signed' } } });
    expect(park.result.isError).toBeUndefined();
    const unpack = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'update_project', arguments: { id: MOVE, status: 'active', summary: 'Moving into the new apartment on the 15th; the lease is signed, so packing starts now.' } } });
    expect(unpack.result.isError).toBeUndefined();
    const writes = calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD');
    expect(writes.every((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/goals'))).toBe(true);
    expect(writes.map((c) => c.body)).toEqual([
      { status: 'parked', revisit_on: null, revisit_when: 'after the lease is signed' },
      { description: 'Moving into the new apartment on the 15th; the lease is signed, so packing starts now.', status: 'active' },
    ]);
  });

  it('requires a project summary and notes on what a chat adds, and says what to include', async () => {
    supabase();
    const noNotes = await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'add_task', arguments: { title: 'Call the landlord' } } });
    expect(noNotes.result.isError).toBe(true);
    expect(noNotes.result.content[0].text).toMatch(/notes are required/);
    const noSummary = await call({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'create_project', arguments: { title: 'Group coaching', steps: [{ title: 'Pick a date', notes: 'Check the calendar for a free Tuesday evening' }] } } });
    expect(noSummary.result.isError).toBe(true);
    expect(noSummary.result.content[0].text).toMatch(/summary is required/);
    const bareStep = await call({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'create_project', arguments: { title: 'Group coaching', summary: 'A six-week group program for past clients, starting in January.', steps: [{ title: 'Pick a date' }] } } });
    expect(bareStep.result.isError).toBe(true);
    expect(bareStep.result.content[0].text).toMatch(/step's notes are required/);
    const noIdeaSummary = await call({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'park_project', arguments: { title: 'Podcast' } } });
    expect(noIdeaSummary.result.isError).toBe(true);
  });

  it('returns fixable input problems as tool errors', async () => {
    supabase();
    const out = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'send_plan', arguments: { items: [] } } });
    expect(out.result.isError).toBe(true);
    expect(out.result.content[0].text).toMatch(/Invalid input/);
    const bad = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'complete_task', arguments: { id: 'not-a-uuid' } } });
    expect(bad.result.isError).toBe(true);
  });
});
