// Just enough MIME to get readable text out of a raw message (IMAP) or a decoded part (Gmail).

const dec = new TextDecoder();

export function decodeBase64Utf8(s: string): string {
  try {
    const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
    return dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

export function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  const src = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-F]{2}$/i.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(src[i]));
    }
  }
  return dec.decode(new Uint8Array(bytes));
}

/** RFC 2047 encoded words in headers ("=?UTF-8?B?...?="). */
export function decodeHeader(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs, encoding: string, text: string) =>
    encoding.toUpperCase() === 'B' ? decodeBase64Utf8(text) : decodeQuotedPrintable(text.replace(/_/g, ' ')),
  ).replace(/\?=\s+=\?/g, '');
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Drop quoted replies and signatures so summaries focus on what's new in each message. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+ wrote:$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line) || /^From: .+/.test(line) && out.length > 3) break;
    if (line.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

function splitHeaders(raw: string): [Record<string, string>, string] {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? '' : raw.slice(idx).replace(/^\r?\n\r?\n/, '');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return [headers, body];
}

function decodeBody(body: string, transfer: string | undefined): string {
  const t = (transfer ?? '').toLowerCase();
  if (t.includes('base64')) return decodeBase64Utf8(body);
  if (t.includes('quoted-printable')) return decodeQuotedPrintable(body);
  return body;
}

/** Best plain-text rendering of a raw RFC 822 message (or part). Prefers text/plain over text/html. */
export function mimeToText(raw: string, depth = 0): string {
  const [h, body] = splitHeaders(raw);
  const ct = h['content-type'] ?? 'text/plain';
  if (/multipart\//i.test(ct) && depth < 5) {
    const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
    if (!boundary) return '';
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'));
    const texts = parts.map((p) => ({ ct: splitHeaders(p.replace(/^\r?\n/, ''))[0]['content-type'] ?? 'text/plain', text: mimeToText(p.replace(/^\r?\n/, ''), depth + 1) }));
    const plain = texts.find((t) => /text\/plain/i.test(t.ct) && t.text.trim());
    return (plain ?? texts.find((t) => t.text.trim()))?.text ?? '';
  }
  if (/text\/html/i.test(ct)) return htmlToText(decodeBody(body, h['content-transfer-encoding']));
  if (/text\//i.test(ct)) return decodeBody(body, h['content-transfer-encoding']);
  return '';
}

export function headersOf(raw: string): Record<string, string> {
  return splitHeaders(raw)[0];
}

/** "Dana Smith <dana@x.com>" → { name, address } */
export function parseAddress(v: string | null | undefined): { name: string | null; address: string | null } {
  if (!v) return { name: null, address: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(v);
  if (m) return { name: decodeHeader(m[1].trim()) || null, address: m[2].trim().toLowerCase() };
  return { name: null, address: v.trim().toLowerCase() };
}

export const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);
