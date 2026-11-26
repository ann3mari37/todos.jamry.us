import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { safeReturn, startOAuth } from '../src/email/accounts';
import { parseSale } from '../src/payhip';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: 'https://todos.jamry.us,https://dashboard.malindaperryconsulting.com,https://admin.malindaperryconsulting.com',
};
afterEach(() => vi.unstubAllGlobals());

describe('cockpit: connecting Google sends the browser back to our own sites only', () => {
  it('accepts app paths and our own https sites', () => {
    expect(safeReturn(env as never, '/email-accounts')).toBe('/email-accounts');
    expect(safeReturn(env as never, 'https://admin.malindaperryconsulting.com/?connected=1')).toBe('https://admin.malindaperryconsulting.com/?connected=1');
  });
  it('refuses anything else', () => {
    expect(safeReturn(env as never, 'https://evil.example/')).toBe('/email-accounts');
    expect(safeReturn(env as never, '//evil.example')).toBe('/email-accounts');
    expect(safeReturn(env as never, 'http://admin.malindaperryconsulting.com/')).toBe('/email-accounts');
    expect(safeReturn(env as never, undefined)).toBe('/email-accounts');
  });
});

describe('cockpit: Payhip sales', () => {
  it('reads a paid webhook', () => {
    const s = parseSale({ id: 'T1', type: 'paid', price: '12.00', currency: 'usd', date: 1764100000, items: [{ product_name: 'UNSTUCK ebook', price: 12, quantity: 1 }], email: 'buyer@example.com' });
    expect(s).toMatchObject({ type: 'paid', payhip_id: 'T1', amount: 12, currency: 'USD', items: ['UNSTUCK ebook'] });
    expect(s.sold_at).toBe(new Date(1764100000 * 1000).toISOString());
    expect(JSON.stringify(s)).not.toContain('buyer@example.com');
  });
  it('falls back to the item total when there is no price', () => {
    expect(parseSale({ id: 'T2', items: [{ name: 'Planner pages', price: '6', quantity: 2 }] }).amount).toBe(12);
  });
  it('rejects a webhook address that is not a store secret, without touching the database', async () => {
    const f = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', f);
    const res = await worker.fetch(new Request('https://dashboard.malindaperryconsulting.com/api/payhip/hook/x', { method: 'POST', body: '{}' }), env as never);
    expect(res.status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects an unknown store secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
    const res = await worker.fetch(new Request('https://dashboard.malindaperryconsulting.com/api/payhip/hook/' + 'a'.repeat(32), { method: 'POST', body: '{"id":"T1"}' }), env as never);
    expect(res.status).toBe(404);
  });
});

describe('cockpit: calendar routes need a signed-in user', () => {
  for (const path of ['/api/calendar/list', '/api/calendar/events', '/api/calendar/create', '/api/payhip/stores']) {
    it(path, async () => {
      const res = await worker.fetch(new Request(`https://dashboard.malindaperryconsulting.com${path}`, { method: 'POST', headers: { Origin: 'https://admin.malindaperryconsulting.com' }, body: '{}' }), env as never);
      expect(res.status).toBe(401);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.malindaperryconsulting.com');
    });
  }
});

describe('cockpit features stay on malindaperryconsulting.com', () => {
  for (const path of ['/api/calendar/list', '/api/payhip/stores', '/api/payhip/hook/' + 'a'.repeat(32)]) {
    it(`${path} does not exist on todos.jamry.us`, async () => {
      const f = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', f);
      const res = await worker.fetch(new Request(`https://todos.jamry.us${path}`, { method: 'POST', headers: { Origin: 'https://todos.jamry.us', Authorization: 'Bearer t' }, body: '{}' }), env as never);
      expect(res.status).toBe(404);
      expect(f).not.toHaveBeenCalled();
    });
  }

  const oauthEnv = { ...env, EMAIL_TOKEN_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))), GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
  it('connecting Gmail on todos.jamry.us asks Google for exactly what it always did', async () => {
    const { url } = await startOAuth({ ...oauthEnv, APP_URL: 'https://todos.jamry.us' } as never, 'u1', 'gmail');
    expect(new URL(url).searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.modify');
  });
  it('connecting from tasks.malindaperryconsulting.com also asks for calendar access', async () => {
    const { url } = await startOAuth({ ...oauthEnv, APP_URL: 'https://tasks.malindaperryconsulting.com', API_URL: 'https://tasks.malindaperryconsulting.com' } as never, 'u1', 'gmail');
    const scope = new URL(url).searchParams.get('scope')!;
    expect(scope).toContain('calendar.readonly');
    expect(scope).toContain('calendar.events');
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://tasks.malindaperryconsulting.com/api/email/oauth/callback');
  });
});
