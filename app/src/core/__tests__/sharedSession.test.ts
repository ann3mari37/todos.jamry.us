import { describe, expect, it } from 'vitest';
import { readShared, removeShared, sharedSessionStorage, usesSharedSession, writeShared } from '../../lib/sharedSession';

// A tiny stand-in for document.cookie: writes set or delete one cookie, reads list them all.
function fakeJar() {
  const store = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    store,
    read: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    write: (c: string) => {
      writes.push(c);
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (/Max-Age=0(;|$)/.test(c)) store.delete(name); else store.set(name, value);
    },
  };
}

describe('shared session cookie', () => {
  it('is used only on malindaperryconsulting.com addresses', () => {
    expect(usesSharedSession('admin.malindaperryconsulting.com')).toBe(true);
    expect(usesSharedSession('dashboard.malindaperryconsulting.com')).toBe(true);
    expect(usesSharedSession('malindaperryconsulting.com')).toBe(true);
    expect(usesSharedSession('todos.jamry.us')).toBe(false);
    expect(usesSharedSession('evilmalindaperryconsulting.com')).toBe(false);
  });

  it('splits a long session into chunks for the whole domain and reads it back', () => {
    const jar = fakeJar();
    const session = JSON.stringify({ access_token: 'a'.repeat(5000), refresh_token: 'r' });
    writeShared(jar, 'sb-x-auth-token', session);
    expect(jar.store.size).toBeGreaterThan(1);
    expect(jar.writes.every((w) => w.includes('Domain=.malindaperryconsulting.com') && w.includes('Secure'))).toBe(true);
    expect(readShared(jar, 'sb-x-auth-token')).toBe(session);
  });

  it('drops an old tail when the session gets shorter, and removes everything on sign-out', () => {
    const jar = fakeJar();
    writeShared(jar, 'k', 'x'.repeat(7000));
    writeShared(jar, 'k', 'short');
    expect(readShared(jar, 'k')).toBe('short');
    expect(jar.store.size).toBe(1);
    removeShared(jar, 'k');
    expect(readShared(jar, 'k')).toBeNull();
  });

  it('moves an existing localStorage session into the cookie so nobody is signed out', () => {
    const jar = fakeJar();
    const local = new Map<string, string>([['k', '{"refresh_token":"r"}']]);
    const storage = sharedSessionStorage(jar, { getItem: (k) => local.get(k) ?? null, removeItem: (k) => { local.delete(k); } });
    expect(storage.getItem('k')).toBe('{"refresh_token":"r"}');
    expect(local.has('k')).toBe(false);
    expect(readShared(jar, 'k')).toBe('{"refresh_token":"r"}');
  });
});
