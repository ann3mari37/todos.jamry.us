// Gmail REST API (https://developers.google.com/gmail/api). Scope: gmail.modify (read, archive, label — never delete or send).

import { clip, decodeBase64Utf8, decodeHeader, htmlToText, parseAddress, stripQuoted } from './mime';
import { ProviderError, type MailMessage, type MailProvider, type MailRef } from './types';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GPart { mimeType: string; body?: { data?: string }; parts?: GPart[]; headers?: { name: string; value: string }[] }
interface GMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate: string; payload: GPart }

const b64urlText = (d: string) => decodeBase64Utf8(d.replace(/-/g, '+').replace(/_/g, '/'));

function partText(p: GPart): string {
  if (p.mimeType === 'text/plain' && p.body?.data) return b64urlText(p.body.data);
  if (p.parts?.length) {
    const plain = p.parts.map(partText).find((t) => t.trim());
    if (plain) return plain;
  }
  if (p.mimeType === 'text/html' && p.body?.data) return htmlToText(b64urlText(p.body.data));
  return '';
}

export class GmailProvider implements MailProvider {
  constructor(private token: string) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 401 || res.status === 403) throw new ProviderError('needs_reauth', `gmail_${res.status}`);
    if (!res.ok) throw new ProviderError('provider_error', `gmail_${res.status}`);
    return (res.status === 204 ? {} : await res.json()) as T;
  }

  async listRecent(sinceISO: string, max: number): Promise<MailMessage[]> {
    const after = Math.floor(new Date(sinceISO).getTime() / 1000);
    const list = await this.call<{ messages?: { id: string }[] }>(`/messages?maxResults=${max}&q=${encodeURIComponent(`in:inbox after:${after}`)}`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const meta = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID';
    const msgs = await Promise.all(ids.map((id) => this.call<GMessage>(`/messages/${id}?${meta}`)));
    return msgs.map((m) => {
      const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? null;
      const from = parseAddress(h('from'));
      return {
        provider_message_id: m.id,
        thread_id: m.threadId,
        from_name: from.name,
        from_address: from.address,
        subject: clip(decodeHeader(h('subject')), 300),
        snippet: clip(m.snippet ?? null, 600),
        received_at: new Date(Number(m.internalDate)).toISOString(),
        is_unread: (m.labelIds ?? []).includes('UNREAD'),
        labels: (m.labelIds ?? []).filter((l) => !l.startsWith('CATEGORY_') && l !== 'UNREAD'),
        message_id_header: clip(h('message-id'), 500),
      };
    });
  }

  async threadText(ref: MailRef, maxChars: number): Promise<string> {
    const t = await this.call<{ messages: GMessage[] }>(`/threads/${ref.thread_id ?? ref.provider_message_id}?format=full`);
    const chunks = t.messages.slice(-8).map((m) => {
      const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
      return `From: ${decodeHeader(h('from'))}\nDate: ${h('date')}\nSubject: ${decodeHeader(h('subject'))}\n\n${stripQuoted(partText(m.payload))}`;
    });
    return chunks.join('\n\n---\n\n').slice(-maxChars);
  }

  private modify(ids: string[], body: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
    return this.call('/messages/batchModify', { method: 'POST', body: JSON.stringify({ ids, ...body }) });
  }

  async archive(ids: string[]) { await this.modify(ids, { removeLabelIds: ['INBOX'] }); }
  async markRead(ids: string[]) { await this.modify(ids, { removeLabelIds: ['UNREAD'] }); }

  async label(ids: string[], name: string) {
    const { labels } = await this.call<{ labels: { id: string; name: string }[] }>('/labels');
    let id = labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;
    if (!id) id = (await this.call<{ id: string }>('/labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) })).id;
    await this.modify(ids, { addLabelIds: [id] });
  }
}
