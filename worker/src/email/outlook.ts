// Microsoft Graph mail (Outlook.com, Hotmail, Microsoft 365). Scope: Mail.ReadWrite (read, move, categorize — never send).

import { clip, htmlToText, stripQuoted } from './mime';
import { ProviderError, type MailMessage, type MailProvider, type MailRef } from './types';

const API = 'https://graph.microsoft.com/v1.0/me';

interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string | null;
  from?: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  bodyPreview: string;
  isRead: boolean;
  categories: string[];
  body?: { contentType: string; content: string };
}

export class OutlookProvider implements MailProvider {
  constructor(private token: string) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Prefer: 'outlook.body-content-type="text"', ...(init.headers ?? {}) },
    });
    if (res.status === 401 || res.status === 403) throw new ProviderError('needs_reauth', `graph_${res.status}`);
    if (!res.ok) throw new ProviderError('provider_error', `graph_${res.status}`);
    return (res.status === 204 ? {} : await res.json()) as T;
  }

  async listRecent(sinceISO: string, max: number): Promise<MailMessage[]> {
    const q = new URLSearchParams({
      $filter: `receivedDateTime ge ${new Date(sinceISO).toISOString()}`,
      $orderby: 'receivedDateTime desc',
      $top: String(max),
      $select: 'id,conversationId,subject,from,receivedDateTime,bodyPreview,isRead,categories',
    });
    const { value } = await this.call<{ value: GraphMessage[] }>(`/mailFolders/inbox/messages?${q}`);
    return value.map((m) => ({
      provider_message_id: m.id,
      thread_id: m.conversationId,
      from_name: m.from?.emailAddress.name ?? null,
      from_address: m.from?.emailAddress.address?.toLowerCase() ?? null,
      subject: clip(m.subject, 300),
      snippet: clip(m.bodyPreview, 600),
      received_at: m.receivedDateTime,
      is_unread: !m.isRead,
      labels: m.categories ?? [],
    }));
  }

  async threadText(ref: MailRef, maxChars: number): Promise<string> {
    const q = new URLSearchParams({
      $filter: `conversationId eq '${(ref.thread_id ?? '').replace(/'/g, "''")}'`,
      $select: 'from,receivedDateTime,subject,body',
      $top: '10',
    });
    const { value } = ref.thread_id
      ? await this.call<{ value: GraphMessage[] }>(`/messages?${q}`)
      : { value: [await this.call<GraphMessage>(`/messages/${ref.provider_message_id}?$select=from,receivedDateTime,subject,body`)] };
    return value
      .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))
      .slice(-8)
      .map((m) => {
        const body = m.body?.contentType === 'html' ? htmlToText(m.body.content) : m.body?.content ?? '';
        return `From: ${m.from?.emailAddress.name ?? ''} <${m.from?.emailAddress.address ?? ''}>\nDate: ${m.receivedDateTime}\nSubject: ${m.subject ?? ''}\n\n${stripQuoted(body)}`;
      })
      .join('\n\n---\n\n')
      .slice(-maxChars);
  }

  async archive(ids: string[]) {
    await Promise.all(ids.map((id) => this.call(`/messages/${id}/move`, { method: 'POST', body: JSON.stringify({ destinationId: 'archive' }) })));
  }

  async markRead(ids: string[]) {
    await Promise.all(ids.map((id) => this.call(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ isRead: true }) })));
  }

  async label(ids: string[], name: string) {
    await Promise.all(ids.map(async (id) => {
      const m = await this.call<{ categories: string[] }>(`/messages/${id}?$select=categories`);
      if (m.categories.includes(name)) return;
      await this.call(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ categories: [...m.categories, name] }) });
    }));
  }
}
