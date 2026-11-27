import { describe, expect, it } from 'vitest';
import { handoff } from '../src/links';

const env = { LINKS_HANDOFF_KEY: 'k'.repeat(32), LINKS_USERNAME: 'malindaperry', LINKS_HANDOFF_EMAILS: 'hello@malindaperryconsulting.com' };

describe('cockpit: one-time LinkHub pass', () => {
  it('is given to an allowed account, for links.malindaperryconsulting.com, valid for two minutes', async () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    const { url } = await handoff(env as never, 'Hello@MalindaPerryConsulting.com', now);
    expect(url.startsWith('https://links.malindaperryconsulting.com/handoff?t=')).toBe(true);
    const body = new URL(url).searchParams.get('t')!.split('.')[0];
    const pass = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(pass).toMatchObject({ u: 'malindaperry', h: 'links.malindaperryconsulting.com', exp: now / 1000 + 120 });
    expect(pass.n.length).toBeGreaterThan(15);
  });
  it('is refused to any other account', async () => {
    await expect(handoff(env as never, 'someone@gmail.com')).rejects.toMatchObject({ status: 403 });
    await expect(handoff(env as never, null)).rejects.toMatchObject({ status: 403 });
  });
  it('still works after the account changes its email, when its account ID is listed', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const withId = { ...env, LINKS_HANDOFF_USERS: id };
    const { url } = await handoff(withId as never, 'new-address@malindaperryconsulting.com', Date.now(), id);
    expect(url.startsWith('https://links.malindaperryconsulting.com/handoff?t=')).toBe(true);
    await expect(handoff(withId as never, 'new-address@malindaperryconsulting.com', Date.now(), '22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ status: 403 });
  });
  it('is off when the secret is missing', async () => {
    await expect(handoff({ ...env, LINKS_HANDOFF_KEY: undefined } as never, 'hello@malindaperryconsulting.com')).rejects.toMatchObject({ status: 503 });
  });
});
