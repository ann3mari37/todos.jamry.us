// One sign-in for every MaLinda Perry address. On *.malindaperryconsulting.com the Supabase session
// lives in a cookie for the whole domain instead of this page's localStorage, so the cockpit
// (admin.malindaperryconsulting.com) and this app (shown inside it, or opened on its own address)
// share it. Elsewhere (todos.jamry.us, phones) nothing changes.
//
// The cockpit has a plain-JS copy of this in its own repo (cockpit/session.js). Keep the cookie name,
// domain and chunking the same in both.

export const SHARED_DOMAIN = 'malindaperryconsulting.com';
const CHUNK = 3000; // cookies top out near 4 KB; a session is about 2-3 KB, so it is split
const MAX_AGE = 60 * 60 * 24 * 400; // the longest a browser keeps a cookie (400 days)

export interface CookieJar {
  read(): string; // document.cookie
  write(cookie: string): void; // document.cookie = …
}

export function usesSharedSession(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === SHARED_DOMAIN || h.endsWith('.' + SHARED_DOMAIN);
}

function cookies(jar: CookieJar): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of jar.read().split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

const attrs = (maxAge: number) => `; Domain=.${SHARED_DOMAIN}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;

export function readShared(jar: CookieJar, key: string): string | null {
  const all = cookies(jar);
  let value = '';
  for (let i = 0; all.has(`${key}.${i}`); i++) value += all.get(`${key}.${i}`);
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

export function removeShared(jar: CookieJar, key: string): void {
  const all = cookies(jar);
  for (let i = 0; all.has(`${key}.${i}`); i++) jar.write(`${key}.${i}=${attrs(0)}`);
}

export function writeShared(jar: CookieJar, key: string, value: string): void {
  const enc = encodeURIComponent(value);
  const parts: string[] = [];
  for (let i = 0; i < enc.length; i += CHUNK) parts.push(enc.slice(i, i + CHUNK));
  removeShared(jar, key); // a shorter session must not leave an old tail behind
  parts.forEach((p, i) => jar.write(`${key}.${i}=${p}${attrs(MAX_AGE)}`));
}

/** A storage for supabase-js that keeps the session in the shared cookie. Copies an existing
 *  localStorage session over the first time, so nobody already signed in is signed out. */
export function sharedSessionStorage(jar: CookieJar, local: Pick<Storage, 'getItem' | 'removeItem'> | null) {
  return {
    getItem(key: string): string | null {
      const v = readShared(jar, key);
      if (v !== null) return v;
      const old = local?.getItem(key) ?? null;
      if (old) { writeShared(jar, key, old); local?.removeItem(key); }
      return old;
    },
    setItem(key: string, value: string) { writeShared(jar, key, value); },
    removeItem(key: string) { removeShared(jar, key); local?.removeItem(key); },
  };
}
