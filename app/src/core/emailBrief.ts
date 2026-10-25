// Inbox briefing without AI: which emails to do first (and why), a one-line gist per email, a cohesive summary
// paragraph, and a link that opens each email in its own mail app. Shared by the app, the Worker and the AI connector;
// an AI-written briefing (from the person's own AI chat) replaces the summary and order when there is one.

import { daysSince, friendlyDate } from './dates';
import { matchProject, parseDue } from './rules';

export interface BriefMessage {
  id: string;
  account_id: string;
  provider_message_id: string;
  thread_id?: string | null;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  snippet: string | null;
  summary?: string | null;
  received_at: string;
  is_unread?: boolean;
  is_archived?: boolean;
  category: string | null;
  importance: number | null;
  status?: string;
  web_link?: string | null;
  message_id_header?: string | null;
}

export interface BriefAccount { id: string; provider: 'gmail' | 'outlook' | 'imap'; email_address: string }

export interface DoFirst { message_id: string; why: string }

export interface Briefing {
  summary: string;
  do_first: DoFirst[];
  counts: Record<string, number>;
}

// ───────────────────────── Open in the mail app

const WEBMAIL: [RegExp, string, string][] = [
  [/@(icloud|me|mac)\.com$/i, 'https://www.icloud.com/mail', 'iCloud Mail'],
  [/@(yahoo|ymail)\./i, 'https://mail.yahoo.com', 'Yahoo Mail'],
  [/@(aol|aim)\.com$/i, 'https://mail.aol.com', 'AOL Mail'],
  [/@(fastmail\.(com|fm)|messagingengine\.com)$/i, 'https://app.fastmail.com', 'Fastmail'],
  [/@(outlook|hotmail|live|msn)\.com$/i, 'https://outlook.live.com/mail', 'Outlook'],
  [/@proton(mail)?\.(me|com)$/i, 'https://mail.proton.me', 'Proton Mail'],
];

/**
 * Where "Open" goes for one email, best first:
 *   the provider's own link to that message (Gmail by id, Outlook's webLink) · Gmail search by Message-ID for Gmail
 *   addresses connected over IMAP · Apple Mail's message:// link · the account's webmail inbox.
 */
export function emailLink(m: BriefMessage, account: BriefAccount | undefined): { url: string; label: string } | null {
  const addr = account?.email_address ?? '';
  const gmailUser = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(addr)}`;
  if (account?.provider === 'gmail') return { url: `${gmailUser}#all/${m.provider_message_id}`, label: 'Open in Gmail' };
  if (m.web_link) return { url: m.web_link, label: account?.provider === 'outlook' ? 'Open in Outlook' : 'Open in your mail' };
  const mid = m.message_id_header?.replace(/^<|>$/g, '').trim();
  if (mid && /@(gmail|googlemail)\.com$/i.test(addr)) {
    return { url: `${gmailUser}#search/${encodeURIComponent(`rfc822msgid:${mid}`)}`, label: 'Open in Gmail' };
  }
  const web = WEBMAIL.find(([re]) => re.test(addr));
  if (mid && !web) return { url: `message://${encodeURIComponent(`<${mid}>`)}`, label: 'Open in Mail' };
  if (web) return { url: web[1], label: `Open ${web[2]}` };
  return mid ? { url: `message://${encodeURIComponent(`<${mid}>`)}`, label: 'Open in Mail' } : null;
}

// ───────────────────────── One line per email

const GREETING = /^(hi|hey|hello|dear|good (morning|afternoon|evening))\b[^,.!\n]{0,40}[,.!]?\s*/i;
const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?|newsletter|mailer|news@|updates@|marketing|info@|hello@|support@|billing@|receipts?@)/i;

const firstName = (m: BriefMessage) => (m.from_name || m.from_address || 'Someone').replace(/["']/g, '').split(/[\s@<]/)[0];

/** "Dana: needs the signed cover page before Thursday." Uses the stored summary when there is one. */
export function oneLine(m: BriefMessage): string {
  const base = (m.summary || m.snippet || m.subject || '').replace(/\s+/g, ' ').trim().replace(GREETING, '');
  const sentence = (base.match(/^.{12,}?[.!?](\s|$)/)?.[0] ?? base).trim();
  const clipped = sentence.length > 140 ? `${sentence.slice(0, 137).trimEnd()}…` : sentence;
  return m.summary ? clipped : `${firstName(m)}: ${clipped || m.subject || '(no subject)'}`;
}

// ───────────────────────── Do first

const ASKS = /\b(can you|could you|would you|please|let me know|need (you|your)|asap|urgent|by (eod|end of day|tomorrow|today)|confirm|sign|approve|rsvp|action required|reminder)\b|\?/i;
// "No reply needed", "no action required", "for your information": explicitly nothing to do.
const NO_ACTION = /\b(no (reply|response|action) (is )?(needed|required|necessary)|nothing (you need )?to do|for your (information|records)|fyi)\b/i;
const SKIP = new Set(['newsletter', 'promotion', 'receipt']);

/**
 * Scores an email for "do first" and says why. Points:
 *   needs action +40 · importance ×8 · a date in it (+20, +15 more if within 2 days) · a question or request +12
 *   a person, not an automated sender +10 · unread +4 · relates to an open project +8
 *   an action waiting a few days +2/day (max +10) · waiting on someone 5+ days: follow up +12.
 * Newsletters, promotions and receipts never make the list.
 */
export function scoreEmail(m: BriefMessage, projects: { id: string; title: string }[] = [], now: Date = new Date()): { score: number; why: string } {
  if (SKIP.has(m.category ?? '') || m.is_archived || m.status === 'dismissed' || m.status === 'tasks_created') return { score: 0, why: '' };
  const text = `${m.subject ?? ''} ${m.snippet ?? ''}`;
  const reasons: string[] = [];
  let score = 0;
  const age = daysSince(m.received_at, now) ?? 0;
  if (m.category === 'action_needed') { score += 40; }
  score += (m.importance ?? 1) * 8;
  const due = parseDue(text, now);
  if (due) {
    const days = Math.round((new Date(`${due.date}T12:00:00`).getTime() - now.getTime()) / 86_400_000);
    score += 20 + (days <= 2 ? 15 : 0);
    reasons.push(`mentions ${friendlyDate(due.date, now)}`);
  }
  const asks = ASKS.test(text) && !NO_ACTION.test(text);
  if (asks) { score += 12; if (!reasons.length) reasons.push('asks something of you'); }
  const automated = AUTOMATED.test(m.from_address ?? '');
  if (!automated) score += 10;
  if (m.is_unread) score += 4;
  const project = matchProject(text, projects);
  if (project) { score += 8; reasons.push(`about “${projects.find((p) => p.id === project.id)?.title}”`); }
  if (m.category === 'action_needed' && age >= 2) { score += Math.min(age, 5) * 2; reasons.push(`waiting ${age} days`); }
  if (m.category === 'waiting_on' && age >= 5) { score += 12; reasons.push(`no answer in ${age} days, worth a nudge`); }
  // Only action emails, follow-ups, real requests or near dates can make the list.
  if (NO_ACTION.test(text) && m.category !== 'action_needed') score = Math.min(score, 25);
  if (m.category !== 'action_needed' && m.category !== 'waiting_on' && !due && !asks) score = Math.min(score, 25);
  const why = reasons.length ? reasons.join(', ') : m.category === 'action_needed' ? 'needs a reply or action' : 'from a person';
  return { score, why: why.charAt(0).toUpperCase() + why.slice(1) };
}

/** Up to `max` emails worth doing first, best first (score 40+). */
export function doFirst(msgs: BriefMessage[], projects: { id: string; title: string }[] = [], now: Date = new Date(), max = 5): DoFirst[] {
  return msgs
    .map((m) => ({ m, ...scoreEmail(m, projects, now) }))
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score || b.m.received_at.localeCompare(a.m.received_at))
    .slice(0, max)
    .map((x) => ({ message_id: x.m.id, why: x.why }));
}

// ───────────────────────── Cohesive summary

/** People by first name ("Dana"); companies and automated senders by their full name ("Acme Insurance"). */
const senderName = (m: BriefMessage) =>
  (AUTOMATED.test(m.from_address ?? '') || !m.from_name ? (m.from_name || m.from_address || 'Someone').replace(/["']/g, '') : firstName(m));

/** "Dana: needs the signed cover page by Thursday" — the sender, then the gist (once, even if the gist names them). */
const gist = (m: BriefMessage) => {
  const who = senderName(m);
  const text = (m.summary ? oneLine(m) : oneLine(m).replace(/^[^:]+:\s*/, '')).replace(/[.!]$/, '');
  const lower = text.toLowerCase();
  return lower.startsWith(who.toLowerCase()) || lower.startsWith(firstName(m).toLowerCase()) ? text : `${who}: ${text}`;
};
/** Ends a sentence with a period unless it already ends in . ? or ! */
const end = (x: string) => (/[.?!]$/.test(x) ? x : `${x}.`);
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('; ')}; and ${xs[xs.length - 1]}`);

/**
 * A short paragraph that reads like a person wrote it: what needs you (most urgent first), who you're waiting on, and
 * what can wait. Built from the same "do first" order the list shows.
 */
export function rulesBriefing(msgs: BriefMessage[], projects: { id: string; title: string }[] = [], now: Date = new Date()): Briefing {
  const live = msgs.filter((m) => !m.is_archived && m.status !== 'dismissed');
  const counts: Record<string, number> = { total: live.length };
  for (const m of live) counts[m.category ?? 'other'] = (counts[m.category ?? 'other'] ?? 0) + 1;
  const first = doFirst(live, projects, now);
  const byId = new Map(live.map((m) => [m.id, m]));
  if (!live.length) return { summary: 'Nothing new in your inbox. Enjoy the quiet.', do_first: [], counts };

  const parts: string[] = [];
  if (first.length) {
    const top = byId.get(first[0].message_id)!;
    parts.push(`${first.length === 1 ? 'One email needs you' : `${first.length} emails need you`}. Start with ${end(gist(top))}`);
    const rest = first.slice(1, 4).map((f) => gist(byId.get(f.message_id)!));
    if (rest.length) parts.push(`Then: ${end(listJoin(rest))}`);
  } else {
    parts.push('Nothing in your inbox needs a reply right now.');
  }
  const waiting = live.filter((m) => m.category === 'waiting_on');
  if (waiting.length) {
    const names = [...new Set(waiting.map(senderName))].slice(0, 3);
    parts.push(end(`You’re waiting to hear back from ${names.join(', ')}${waiting.length > names.length ? ' and others' : ''}`));
  }
  const later: string[] = [];
  for (const [k, word] of [['fyi', 'FYI'], ['personal', 'personal'], ['receipt', 'receipt'], ['newsletter', 'newsletter'], ['promotion', 'promotion']] as const) {
    const n = counts[k] ?? 0;
    if (n) later.push(`${n} ${word}${n === 1 || word === 'FYI' ? '' : 's'}`);
  }
  if (later.length) parts.push(`The rest (${listJoin(later).replace('; and', ' and').replace(/; /g, ', ')}) can wait.`);
  return { summary: parts.join(' '), do_first: first, counts };
}
