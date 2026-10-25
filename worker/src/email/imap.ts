// Minimal IMAP4rev1 client over Cloudflare TCP sockets (TLS on 993), for providers without OAuth support here
// (iCloud, Yahoo, Fastmail, custom domains...). Users connect with an app-specific password.
// Implements only what Momentum needs: LOGIN, SELECT, UID SEARCH/FETCH/STORE/MOVE/COPY, CREATE, LOGOUT.

import { connect } from 'cloudflare:sockets';
import { clip, decodeHeader, headersOf, mimeToText, parseAddress, stripQuoted } from './mime';
import { ProviderError, type MailMessage, type MailProvider, type MailRef } from './types';

const TIMEOUT_MS = 15_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const latin1 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; };
const utf8 = (bin: string) => new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
const imapDate = (d: Date) => `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
export const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ── Response parsing (exported for tests)
export type Tok = string | null | Tok[];

/** Parses IMAP data items: atoms, "quoted", {n}\r\n literals, NIL, and (lists). Input is a latin1 string. */
export function parseItems(s: string): Tok[] {
  let i = 0;
  const parseOne = (): Tok => {
    while (s[i] === ' ') i++;
    const c = s[i];
    if (c === '(') {
      i++;
      const list: Tok[] = [];
      while (i < s.length && s[i] !== ')') {
        list.push(parseOne());
        while (s[i] === ' ') i++;
      }
      i++;
      return list;
    }
    if (c === '"') {
      let out = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') i++;
        out += s[i++];
      }
      i++;
      return out;
    }
    if (c === '{') {
      const close = s.indexOf('}', i);
      const n = Number(s.slice(i + 1, close));
      i = close + 3; // skip "}\r\n"
      const lit = s.slice(i, i + n);
      i += n;
      return lit;
    }
    let atom = '';
    while (i < s.length && !' ()'.includes(s[i])) {
      if (s[i] === '[') {
        const close = s.indexOf(']', i);
        atom += s.slice(i, close + 1);
        i = close + 1;
      } else atom += s[i++];
    }
    return atom === 'NIL' ? null : atom;
  };
  const out: Tok[] = [];
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\r' || s[i] === '\n') i++;
    if (i < s.length) out.push(parseOne());
  }
  return out;
}

/** FETCH attribute list → map ("UID" → "12", "BODY[]<0>" → raw, ...). */
export function fetchMap(list: Tok[]): Record<string, Tok> {
  const m: Record<string, Tok> = {};
  for (let k = 0; k + 1 < list.length; k += 2) m[String(list[k]).toUpperCase().replace(/^BODY\[\]<\d+>$/, 'BODY[]')] = list[k + 1];
  return m;
}

class ImapConnection {
  private buf = '';
  private tag = 0;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private socket!: ReturnType<typeof connect>;

  static async open(host: string, port: number) {
    const c = new ImapConnection();
    c.socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
    c.reader = c.socket.readable.getReader();
    c.writer = c.socket.writable.getWriter();
    const greeting = await c.readResponse();
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) throw new ProviderError('provider_error', 'imap_greeting');
    return c;
  }

  private async fill() {
    const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new ProviderError('provider_error', 'imap_timeout')), TIMEOUT_MS));
    const { value, done } = await Promise.race([this.reader.read(), timer]);
    if (done) throw new ProviderError('provider_error', 'imap_closed');
    this.buf += latin1(value!);
  }

  private async readLine(): Promise<string> {
    let idx: number;
    while ((idx = this.buf.indexOf('\r\n')) === -1) await this.fill();
    const line = this.buf.slice(0, idx);
    this.buf = this.buf.slice(idx + 2);
    return line;
  }

  /** One complete server response, with any {n} literals inlined as "{n}\r\n<bytes>". */
  private async readResponse(): Promise<string> {
    let out = '';
    for (;;) {
      const line = await this.readLine();
      out += line;
      const lit = /\{(\d+)\}$/.exec(line);
      if (!lit) return out;
      const n = Number(lit[1]);
      while (this.buf.length < n) await this.fill();
      out += `\r\n${this.buf.slice(0, n)}`;
      this.buf = this.buf.slice(n);
    }
  }

  /** Sends a tagged command; returns untagged responses. Throws on NO/BAD. */
  async run(cmd: string): Promise<string[]> {
    const t = `M${++this.tag}`;
    await this.writer.write(new TextEncoder().encode(`${t} ${cmd}\r\n`));
    const untagged: string[] = [];
    for (;;) {
      const r = await this.readResponse();
      if (r.startsWith(`${t} `)) {
        if (!/^\S+ OK/i.test(r)) {
          const err = new ProviderError(/AUTHENTICATIONFAILED|LOGIN|credentials/i.test(r) ? 'needs_reauth' : 'provider_error', `imap_${cmd.split(' ')[0].toLowerCase()}_failed`);
          throw err;
        }
        return untagged;
      }
      if (r.startsWith('* ')) untagged.push(r);
    }
  }

  async close() {
    try { await this.run('LOGOUT'); } catch { /* best effort */ }
    try { await this.socket.close(); } catch { /* already closed */ }
  }
}

export interface ImapConfig { host: string; port: number; username: string; password: string; archiveFolder: string }

export class ImapProvider implements MailProvider {
  private conn: ImapConnection | null = null;
  private uidValidity = '';
  constructor(private cfg: ImapConfig) {}

  /** Opens, logs in and selects INBOX. Also used to validate settings when connecting. */
  async open() {
    if (this.conn) return this.conn;
    const c = await ImapConnection.open(this.cfg.host, this.cfg.port);
    await c.run(`LOGIN ${quote(this.cfg.username)} ${quote(this.cfg.password)}`);
    const sel = await c.run('SELECT INBOX');
    this.uidValidity = /UIDVALIDITY (\d+)/i.exec(sel.join('\n'))?.[1] ?? '0';
    this.conn = c;
    return c;
  }

  async close() {
    await this.conn?.close();
    this.conn = null;
  }

  /** Our ids are "<uidvalidity>:<uid>" so a mailbox reset never makes us act on the wrong message. */
  private uids(ids: string[]): string {
    const uids = ids.map((id) => id.split(':')).filter(([v]) => v === this.uidValidity).map(([, u]) => u).filter((u) => /^\d+$/.test(u));
    if (!uids.length) throw new ProviderError('provider_error', 'imap_stale_ids');
    return uids.join(',');
  }

  private async fetchRaw(uidSet: string, bytes: number) {
    const c = await this.open();
    const rows = await c.run(`UID FETCH ${uidSet} (UID FLAGS INTERNALDATE BODY.PEEK[]<0.${bytes}>)`);
    return rows
      .map((r) => {
        const m = /^\* \d+ FETCH /i.exec(r);
        if (!m) return null;
        const items = parseItems(r.slice(m[0].length))[0];
        return Array.isArray(items) ? fetchMap(items) : null;
      })
      .filter((x): x is Record<string, Tok> => !!x && !!x.UID);
  }

  async listRecent(sinceISO: string, max: number): Promise<MailMessage[]> {
    const c = await this.open();
    const found = (await c.run(`UID SEARCH SINCE ${imapDate(new Date(sinceISO))}`)).join(' ');
    const uids = (/^\* SEARCH(.*)$/im.exec(found)?.[1] ?? '').trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => b - a).slice(0, max);
    if (!uids.length) return [];
    const rows = await this.fetchRaw(uids.join(','), 8000);
    return rows.map((f) => {
      const raw = utf8(String(f['BODY[]'] ?? '')); // literal bytes → text once; base64/QP parts are decoded by mimeToText
      const h = headersOf(raw);
      const from = parseAddress(decodeHeader(h.from));
      const flags = Array.isArray(f.FLAGS) ? (f.FLAGS as string[]) : [];
      const text = mimeToText(raw).replace(/\s+/g, ' ').trim();
      const subject = decodeHeader(h.subject);
      return {
        provider_message_id: `${this.uidValidity}:${f.UID}`,
        thread_id: `subj:${(subject ?? '').replace(/^((re|fwd?|aw):\s*)+/i, '').trim().toLowerCase().slice(0, 120)}`,
        from_name: from.name,
        from_address: from.address,
        subject: clip(subject, 300),
        snippet: clip(text, 600),
        received_at: new Date(String(f.INTERNALDATE ?? Date.now())).toISOString(),
        is_unread: !flags.some((x) => /\\Seen/i.test(x)),
        labels: [],
        message_id_header: clip(h['message-id'] ?? null, 500),
      };
    }).filter((m) => new Date(m.received_at) >= new Date(sinceISO));
  }

  async threadText(ref: MailRef, maxChars: number): Promise<string> {
    const c = await this.open();
    const subject = (ref.subject ?? '').replace(/^((re|fwd?|aw):\s*)+/i, '').trim();
    let uidSet = this.uids([ref.provider_message_id]);
    if (subject && /^[\x20-\x7e]+$/.test(subject)) {
      const since = imapDate(new Date(Date.now() - 60 * 86_400_000));
      const found = (await c.run(`UID SEARCH SINCE ${since} SUBJECT ${quote(subject.slice(0, 80))}`)).join(' ');
      const uids = (/^\* SEARCH(.*)$/im.exec(found)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
      if (uids.length) uidSet = uids.slice(-6).join(',');
    }
    const rows = await this.fetchRaw(uidSet, 20000);
    return rows
      .map((f) => {
        const raw = utf8(String(f['BODY[]'] ?? ''));
        const h = headersOf(raw);
        return `From: ${decodeHeader(h.from) ?? ''}\nDate: ${h.date ?? ''}\nSubject: ${decodeHeader(h.subject) ?? ''}\n\n${stripQuoted(mimeToText(raw))}`;
      })
      .join('\n\n---\n\n')
      .slice(-maxChars);
  }

  async archive(ids: string[]) {
    const c = await this.open();
    const set = this.uids(ids);
    const folder = quote(this.cfg.archiveFolder || 'Archive');
    try {
      await c.run(`UID MOVE ${set} ${folder}`);
    } catch {
      try { await c.run(`CREATE ${folder}`); } catch { /* may already exist */ }
      await c.run(`UID MOVE ${set} ${folder}`);
    }
  }

  async markRead(ids: string[]) {
    const c = await this.open();
    await c.run(`UID STORE ${this.uids(ids)} +FLAGS.SILENT (\\Seen)`);
  }

  /** IMAP has no labels; copy into a folder with that name (how Gmail-over-IMAP models labels too). */
  async label(ids: string[], name: string) {
    const c = await this.open();
    try { await c.run(`CREATE ${quote(name)}`); } catch { /* exists */ }
    await c.run(`UID COPY ${this.uids(ids)} ${quote(name)}`);
  }
}
