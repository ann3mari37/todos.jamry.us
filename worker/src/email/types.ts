export type ProviderKind = 'gmail' | 'outlook' | 'imap';

/** Provider-neutral message metadata. Bodies are never persisted. */
export interface MailMessage {
  provider_message_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string; // ISO
  is_unread: boolean;
  labels: string[];
}

export interface MailRef {
  provider_message_id: string;
  thread_id: string | null;
  subject: string | null;
}

export interface MailProvider {
  listRecent(sinceISO: string, max: number): Promise<MailMessage[]>;
  /** Plain text of the conversation, oldest first, for on-demand summaries. */
  threadText(ref: MailRef, maxChars: number): Promise<string>;
  archive(ids: string[]): Promise<void>;
  markRead(ids: string[]): Promise<void>;
  label(ids: string[], label: string): Promise<void>;
  close?(): Promise<void>;
}

export class ProviderError extends Error {
  constructor(public code: 'needs_reauth' | 'provider_error' | 'unsupported', message?: string) {
    super(message ?? code);
  }
}
