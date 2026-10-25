import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizeOutput } from '../../app/src/core/ai-contracts';
import { decrypt, encrypt, signState, verifyState } from '../src/crypto';
import { GmailProvider } from '../src/email/gmail';
import { fetchMap, parseItems, quote } from '../src/email/imap';
import { decodeHeader, mimeToText, parseAddress, stripQuoted } from '../src/email/mime';
import worker from '../src/index';
import { confidentSubset, refinePlan } from '../src/organize';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOME = id(901), WORK = id(902);

afterEach(() => vi.unstubAllGlobals());

describe('organize business rules', () => {
  const ctx = {
    areas: [{ id: HOME }, { id: WORK }],
    goals: [{ id: id(50), title: 'Renew insurance', life_area_id: null }],
    actions: [
      { id: id(1), title: 'Buy shelves', goal_id: null, life_area_id: null },
      { id: id(2), title: 'Sort tools', goal_id: null, life_area_id: null },
      { id: id(3), title: 'Call agent', goal_id: null, life_area_id: null },
      { id: id(4), title: 'Email boss', goal_id: null, life_area_id: WORK },
    ],
    goalsToFile: [{ id: id(50), title: 'Renew insurance', life_area_id: null }],
  };
  const a = (n: number, extra: Partial<OrganizeOutput['assignments'][number]>) => ({
    kind: 'action' as const, id: id(n), goal_id: null, goal_ref: null, life_area_id: null, confidence: 0.9, reason: 'fits', ...extra,
  });

  it('keeps multi-task projects, drops single-task ones, and ignores unknown ids', () => {
    const plan = refinePlan({
      new_projects: [
        { ref: 'p1', title: 'Organize the garage', life_area_id: HOME, reason: 'garage tasks' },
        { ref: 'p2', title: 'Lonely project', life_area_id: HOME, reason: 'x' },
      ],
      assignments: [
        a(1, { goal_ref: 'p1' }), a(2, { goal_ref: 'p1', life_area_id: HOME }), a(3, { goal_ref: 'p2', life_area_id: HOME }),
        a(99, { life_area_id: HOME }), // not something we asked about
        a(1, { life_area_id: WORK }), // duplicate id — first wins
      ],
    }, ctx);
    expect(plan.new_projects.map((p) => p.title)).toEqual(['Organize the garage']);
    expect(plan.new_projects[0].action_count).toBe(2);
    expect(plan.assignments.find((x) => x.id === id(3))).toMatchObject({ goal_ref: null, life_area_id: HOME });
    expect(plan.assignments.some((x) => x.id === id(99))).toBe(false);
    expect(plan.assignments.filter((x) => x.id === id(1))).toHaveLength(1);
  });

  it('maps a "new" project with an existing title onto the existing project, and drops no-op changes', () => {
    const plan = refinePlan({
      new_projects: [{ ref: 'p1', title: 'renew insurance', life_area_id: null, reason: '' }],
      assignments: [
        a(3, { goal_ref: 'p1' }),
        a(4, { life_area_id: WORK }), // already in Work
        { kind: 'goal', id: id(50), goal_id: null, goal_ref: null, life_area_id: id(12345), confidence: 0.9, reason: '' }, // bad area
      ],
    }, ctx);
    expect(plan.new_projects).toEqual([]);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]).toMatchObject({ id: id(3), goal_id: id(50), goal_ref: null });
  });

  it('auto-apply keeps only confident items and re-checks the 2-task rule', () => {
    const plan = refinePlan({
      new_projects: [{ ref: 'p1', title: 'Organize the garage', life_area_id: HOME, reason: '' }],
      assignments: [a(1, { goal_ref: 'p1' }), a(2, { goal_ref: 'p1', confidence: 0.5, life_area_id: HOME }), a(3, { life_area_id: HOME, confidence: 0.6 })],
    }, ctx);
    expect(confidentSubset(plan)).toBeNull(); // p1 left with one confident task → nothing useful remains
    const plan2 = refinePlan({
      new_projects: [{ ref: 'p1', title: 'Organize the garage', life_area_id: HOME, reason: '' }],
      assignments: [a(1, { goal_ref: 'p1' }), a(2, { goal_ref: 'p1' }), a(3, { life_area_id: HOME, confidence: 0.6 })],
    }, ctx);
    const sub = confidentSubset(plan2)!;
    expect(sub.new_projects).toHaveLength(1);
    expect(sub.assignments.map((x) => x.id)).toEqual([id(1), id(2)]);
  });
});

describe('credential crypto', () => {
  it('round-trips and never stores plaintext', async () => {
    const sealed = await encrypt(KEY, 'refresh-token-123');
    expect(sealed).not.toContain('refresh-token-123');
    expect(await decrypt(KEY, sealed)).toBe('refresh-token-123');
  });

  it('rejects tampered OAuth state', async () => {
    const s = await signState(KEY, { u: id(1), p: 'gmail', r: '/inbox' });
    expect((await verifyState(KEY, s)).u).toBe(id(1));
    const [body, sig] = s.split('.');
    const forged = btoa(JSON.stringify({ u: id(2), p: 'gmail', r: '/', exp: Date.now() + 1e6, n: 'x' })).replace(/=+$/, '');
    await expect(verifyState(KEY, `${forged}.${sig}`)).rejects.toThrow();
    await expect(verifyState(KEY, `${body}.AAAA`)).rejects.toThrow();
  });
});

describe('mime + imap parsing', () => {
  it('extracts plain text from multipart mail and decodes headers', () => {
    const raw = [
      'From: =?UTF-8?B?RGFuYSBTbWl0aA==?= <Dana@Example.com>',
      'Subject: =?UTF-8?Q?Caf=C3=A9_plans?=',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html',
      '',
      '<p>Hello <b>there</b></p>',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'See you at the caf=C3=A9 on Friday.',
      '--b1--',
    ].join('\r\n');
    expect(mimeToText(raw).trim()).toBe('See you at the café on Friday.');
    expect(decodeHeader('=?UTF-8?Q?Caf=C3=A9_plans?=')).toBe('Café plans');
    expect(parseAddress(decodeHeader('=?UTF-8?B?RGFuYSBTbWl0aA==?= <Dana@Example.com>'))).toEqual({ name: 'Dana Smith', address: 'dana@example.com' });
    expect(stripQuoted('Sounds good!\n\nOn Mon, Dana wrote:\n> old text')).toBe('Sounds good!');
  });

  it('parses FETCH responses with literals, lists and NIL', () => {
    const body = 'Subject: Hi\r\n\r\nBody';
    const resp = `(UID 42 FLAGS (\\Seen \\Flagged) INTERNALDATE "24-Oct-2026 10:00:00 +0000" BODY[]<0> {${body.length}}\r\n${body} X NIL)`;
    const m = fetchMap(parseItems(resp)[0] as never);
    expect(m.UID).toBe('42');
    expect(m.FLAGS).toEqual(['\\Seen', '\\Flagged']);
    expect(m['BODY[]']).toBe(body);
    expect(m.X).toBeNull();
    expect(quote('pa"ss\\word')).toBe('"pa\\"ss\\\\word"');
  });
});

describe('gmail provider', () => {
  it('maps metadata without fetching bodies', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      if (u.includes('/messages?')) return Response.json({ messages: [{ id: 'm1' }] });
      return Response.json({
        id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'], snippet: 'Your policy renews Nov 1', internalDate: '1792850000000',
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Acme Insurance <billing@acme.com>' }, { name: 'Subject', value: 'Renewal notice' }] },
      });
    }));
    const [m] = await new GmailProvider('tok').listRecent('2026-10-20T00:00:00Z', 10);
    expect(m).toMatchObject({ provider_message_id: 'm1', thread_id: 't1', from_name: 'Acme Insurance', from_address: 'billing@acme.com', subject: 'Renewal notice', is_unread: true, labels: ['INBOX'] });
    expect(calls[1]).toContain('format=metadata');
  });
});

describe('email routes', () => {
  const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', OPENAI_API_KEY: 'sk', EMAIL_TOKEN_KEY: KEY, GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' };

  it('health reports which providers are configured', async () => {
    const res = await worker.fetch(new Request('https://todos.jamry.us/api/health'), env);
    expect(((await res.json()) as { email: unknown }).email).toEqual({ gmail: true, outlook: false, imap: true });
  });

  it('OAuth callback with a forged state redirects back with an error and stores nothing', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await worker.fetch(new Request('https://todos.jamry.us/api/email/oauth/callback?code=abc&state=bogus.sig'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('email_error=invalid_state');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('connect returns a Google consent URL with offline access and the app callback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/auth/v1/user') ? Response.json({ id: id(1) }) : Response.json({}))));
    const res = await worker.fetch(new Request('https://todos.jamry.us/api/email/connect', {
      method: 'POST', headers: { Authorization: 'Bearer t', Origin: 'https://todos.jamry.us' }, body: JSON.stringify({ provider: 'gmail' }),
    }), env);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(u.host).toBe('accounts.google.com');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('redirect_uri')).toBe('https://todos.jamry.us/api/email/oauth/callback');
    expect(u.searchParams.get('scope')).toContain('gmail.modify');
  });

  it('refuses plaintext IMAP ports', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/auth/v1/user') ? Response.json({ id: id(1) }) : Response.json({}))));
    const res = await worker.fetch(new Request('https://todos.jamry.us/api/email/connect-imap', {
      method: 'POST', headers: { Authorization: 'Bearer t', Origin: 'https://todos.jamry.us' },
      body: JSON.stringify({ email: 'me@icloud.com', host: 'imap.mail.me.com', port: 143, username: 'me', password: 'x' }),
    }), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('imap_tls_required');
  });
});
