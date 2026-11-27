import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { safeReturn, startOAuth } from '../src/email/accounts';
import { parseSale, parseSalesCsv } from '../src/payhip';

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

describe('cockpit: importing past Payhip sales from the export', () => {
  it('reads the columns by name, combines rows of one order and never keeps buyer details', () => {
    const csv = '\uFEFFTransaction ID,Date,Product Name,Price,Currency,Buyer Email,Status\r\n' +
      'T1,2026-11-20 14:05:00,"UNSTUCK ebook, 2nd ed.",12.00,usd,a@example.com,Completed\r\n' +
      'T1,2026-11-20 14:05:00,Planner pages,$6.00,usd,a@example.com,Completed\r\n' +
      'T2,2026-11-21T09:00:00Z,UNSTUCK ebook,12,USD,b@example.com,Refunded\r\n' +
      ',,,,,,\r\n' +
      'T3,not a date,UNSTUCK ebook,12,USD,c@example.com,Completed\r\n';
    const s = parseSalesCsv(csv)!;
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ payhip_id: 'T1', amount: 18, currency: 'USD', items: ['UNSTUCK ebook, 2nd ed.', 'Planner pages'], refunded: false });
    expect(s[1]).toMatchObject({ payhip_id: 'T2', amount: 12, refunded: true, sold_at: '2026-11-21T09:00:00.000Z' });
    expect(JSON.stringify(s)).not.toContain('example.com');
  });
  it('gives rows without a transaction id a stable id, so a second import adds nothing new', () => {
    const csv = 'Date,Item,Amount\n2026-11-01,Guide,9.5\n';
    expect(parseSalesCsv(csv)![0].payhip_id).toBe(parseSalesCsv(csv)![0].payhip_id);
  });
  it('reads Payhip\'s real export layout (Order ID, Amount Gross, Items In Cart, a date without a time)', () => {
    const head = '"Order ID",Email,"First Name","Last Name",Currency,"Amount Gross","Amount Net",Status,"Num of Items In Cart","Items In Cart","Payment Type","Fulfillment Status",Date';
    const s = parseSalesCsv(head + '\n' +
      'AbC12,x@example.com,X,Y,USD,4.99,4.24,COMPLETED,1,Unstuck,Stripe,,2026-11-25\n' +
      'Zz9,y@example.com,X,Y,USD,4.99,4.24,REFUNDED,1,Unstuck,Stripe,,2026-11-20\n')!;
    expect(s[0]).toMatchObject({ payhip_id: 'AbC12', amount: 4.99, currency: 'USD', items: ['Unstuck'], refunded: false, sold_at: '2026-11-25T12:00:00.000Z' });
    expect(s[1].refunded).toBe(true);
  });
  it('leaves out sales tax Payhip collected on top, as Payhip\'s own totals do', () => {
    const csv = '"Order ID","Amount Gross","Payhip Collected Sales Tax Amount",Date\nA1,5.43,0.44,2026-11-25\nA2,4.99,0.00,2026-11-24\n';
    expect(parseSalesCsv(csv)!.map((s) => s.amount)).toEqual([4.99, 4.99]);
  });
  it('refuses a file that is not a sales export', () => {
    expect(parseSalesCsv('Name,Email\nA,a@example.com\n')).toBeNull();
  });
  it('the import needs a signed-in user', async () => {
    const res = await worker.fetch(new Request('https://tasks.malindaperryconsulting.com/api/payhip/import', { method: 'POST', body: '{}' }), env as never);
    expect(res.status).toBe(401);
  });
});
