// Inbox briefing without AI: which emails to do first (and why), a short gist per email, a summary paragraph that reads
// like a person wrote it, and a link that opens each email in its own mail app. Shared by the app, the Worker and the AI
// connector; a briefing written by the person's own AI chat replaces the summary and order when there is one.

import { daysSince, daysUntil, friendlyDate } from './dates';
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

export interface BriefAccount { id: string; provider: 'gmail' | 'outlook' | 'imap'; email_address: string; webmail_url?: string | null }

export interface DoFirst { message_id: string; why: string }

export interface Briefing {
  summary: string;
  do_first: DoFirst[];
  counts: Record<string, number>;
}

// ───────────────────────── Senders

// Local parts and domains that mean a machine sent it (alerts, CI runs, receipts, marketing).
const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|news(letter)?|mailer(-daemon)?|updates?|marketing|info|hello|support|billing|receipts?|team|accounts?|security|bounce|digest)([+.-].*)?@/i;
const AUTOMATED_SUBDOMAIN = /@(mail|news|notify|notifications|info|em\d*|email|e|m|send|bounce|marketing|updates|alerts|reply)\./i;
const SERVICES = /@([a-z0-9-]+\.)*(github|gitlab|bitbucket|atlassian|slack|linkedin|facebookmail|twitter|x|notion|figma|vercel|netlify|cloudflare|railway|hostinger|supabase|stripe|paypal|zoom|calendly|asana|trello|discord|medium|substack|mailchimp|hubspot|anthropic|openai|google|apple|amazon|microsoft|dropbox|docusign|intercom|zendesk)\.[a-z.]+$/i;

/** A machine sent it: notifications, alerts, receipts, marketing. People's mail is never matched. */
export function isAutomated(m: Pick<BriefMessage, 'from_address' | 'category'>): boolean {
  const a = m.from_address ?? '';
  return AUTOMATED_LOCAL.test(a) || AUTOMATED_SUBDOMAIN.test(a) || SERVICES.test(a) || ['newsletter', 'promotion', 'receipt'].includes(m.category ?? '');
}

const NICE: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', linkedin: 'LinkedIn', paypal: 'PayPal', openai: 'OpenAI', hubspot: 'HubSpot', docusign: 'DocuSign' };

/** Who it's from, the way a person would say it: "Dana" for people, "GitHub" for services. */
export function senderLabel(m: Pick<BriefMessage, 'from_name' | 'from_address' | 'category'>): string {
  if (isAutomated(m)) {
    // Known services by brand ("GitHub", whatever name the notification uses); anything else by its display name.
    if (!SERVICES.test(m.from_address ?? '') && m.from_name) return m.from_name.replace(/["']/g, '');
    const domain = (m.from_address ?? '').split('@')[1] ?? '';
    const parts = domain.split('.').filter(Boolean);
    const org = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? '';
    if (org) return NICE[org.toLowerCase()] ?? org.charAt(0).toUpperCase() + org.slice(1);
    return (m.from_name || 'A service').replace(/["']/g, '');
  }
  return (m.from_name || m.from_address || 'Someone').replace(/["']/g, '').split(/[\s@<]/)[0];
}

/** The subject without reply prefixes, bracket tags, ids and numbers, for spotting repeats ("Run failed: Test & deploy"). */
export function subjectKey(subject: string | null): string {
  return (subject ?? '')
    .replace(/^((re|fwd?|aw)\s*:\s*)+/i, '')
    .replace(/\[[^\]]*\]\s*/g, '')
    .replace(/#?\b[0-9a-f]{7,}\b|\b\d+(\.\d+)?\b/gi, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s:,–-]+$/, '')
    .trim();
}

// ───────────────────────── Open in the mail app

const WEBMAIL_BY_ADDRESS: [RegExp, string][] = [
  [/@(icloud|me|mac)\.com$/i, 'https://www.icloud.com/mail'],
  [/@(yahoo|ymail)\./i, 'https://mail.yahoo.com'],
  [/@(aol|aim)\.com$/i, 'https://mail.aol.com'],
  [/@(fastmail\.(com|fm)|messagingengine\.com)$/i, 'https://app.fastmail.com'],
  [/@(outlook|hotmail|live|msn)\.com$/i, 'https://outlook.live.com/mail'],
  [/@proton(mail)?\.(me|com)$/i, 'https://mail.proton.me'],
];

/** The webmail for an IMAP server (set when the inbox is connected). */
export const WEBMAIL_BY_IMAP_HOST: [RegExp, string][] = [
  [/(^|\.)spacemail\.com$/i, 'https://www.spacemail.com/mail/'],
  [/^imap\.gmail\.com$/i, 'https://mail.google.com/mail/'],
  [/^imap\.mail\.me\.com$/i, 'https://www.icloud.com/mail'],
  [/yahoo\.com$/i, 'https://mail.yahoo.com'],
  [/aol\.com$/i, 'https://mail.aol.com'],
  [/fastmail\.com$/i, 'https://app.fastmail.com'],
  [/(office365|outlook)\.com$/i, 'https://outlook.office.com/mail'],
  [/zoho\.(com|eu|in)$/i, 'https://mail.zoho.com'],
  [/hostinger\.com$/i, 'https://mail.hostinger.com'],
  [/secureserver\.net$/i, 'https://email.secureserver.net'],
  [/privateemail\.com$/i, 'https://privateemail.com'],
  [/ionos\.(com|de|co\.uk)$/i, 'https://mail.ionos.com'],
];
export function webmailForImapHost(host: string): string | null {
  return WEBMAIL_BY_IMAP_HOST.find(([re]) => re.test(host.trim()))?.[1] ?? null;
}

const siteName = (url: string) => {
  const host = url.replace(/^https?:\/\//, '').split('/')[0].replace(/^(www|mail|app|email)\./, '');
  const name = host.split('.')[0];
  return { icloud: 'iCloud Mail', google: 'Gmail', live: 'Outlook', office: 'Outlook', proton: 'Proton Mail', secureserver: 'GoDaddy Mail' }[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
};

/**
 * Where "Open" goes for one email, best first:
 *   the provider's own link to that message (Gmail by id, Outlook's webLink) · Gmail search by Message-ID for Gmail
 *   addresses over IMAP · the inbox's webmail (from its IMAP server or address) · Apple Mail's message:// on Apple devices.
 */
export function emailLink(m: BriefMessage, account: BriefAccount | undefined, apple = false): { url: string; label: string } | null {
  const addr = account?.email_address ?? '';
  const gmailUser = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(addr)}`;
  if (account?.provider === 'gmail') return { url: `${gmailUser}#all/${m.provider_message_id}`, label: 'Open in Gmail' };
  if (m.web_link) return { url: m.web_link, label: account?.provider === 'outlook' ? 'Open in Outlook' : 'Open in your mail' };
  const mid = m.message_id_header?.replace(/^<|>$/g, '').trim();
  if (mid && (/@(gmail|googlemail)\.com$/i.test(addr) || account?.webmail_url?.includes('mail.google.com'))) {
    return { url: `${gmailUser}#search/${encodeURIComponent(`rfc822msgid:${mid}`)}`, label: 'Open in Gmail' };
  }
  const web = account?.webmail_url ?? WEBMAIL_BY_ADDRESS.find(([re]) => re.test(addr))?.[1] ?? null;
  if (apple && mid) return { url: `message://${encodeURIComponent(`<${mid}>`)}`, label: 'Open in Mail' };
  if (web) return { url: web, label: `Open in ${siteName(web)}` };
  return null;
}

// ───────────────────────── One line per email

const GREETING = /^(hi|hey|hello|dear|good (morning|afternoon|evening))\b[^,.!\n]{0,40}[,.!]?\s*/i;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * What an email is about, in one short line. Machine mail uses its subject (its preview is usually a wall of labels);
 * people's mail uses its summary, or the first real sentence of the preview.
 */
export function gistOf(m: BriefMessage): string {
  if (isAutomated(m) && !m.summary) return clip(subjectKey(m.subject) || m.subject || '(no subject)', 90);
  const base = (m.summary || m.snippet || m.subject || '').replace(/\s+/g, ' ').trim().replace(GREETING, '');
  const sentence = (base.match(/^.{12,}?[.!?](\s|$)/)?.[0] ?? base).trim();
  return clip(sentence || m.subject || '(no subject)', 110);
}

/** "Dana: Can you send the signed cover page before Thursday?" */
export function oneLine(m: BriefMessage): string {
  const who = senderLabel(m);
  const g = gistOf(m);
  return g.toLowerCase().startsWith(who.toLowerCase()) ? g : `${who}: ${g}`;
}

// ───────────────────────── Do first

const ASKS = /\b(can you|could you|would you|please|let me know|need (you|your)|asap|urgent|by (eod|end of day|tomorrow|today)|confirm|sign|approve|rsvp|action required)\b|\?/i;
const NO_ACTION = /\b(no (reply|response|action) (is )?(needed|required|necessary)|nothing (you need )?to do|for your (information|records)|fyi)\b/i;
const RELATIVE_ONLY = /^(today|tonight|this (morning|afternoon|evening))$/i;

/**
 * Scores an email for "do first" and says why.
 *   From a person: needs action +40 · a question or request +20 · a date in it (+20, +15 more within 2 days)
 *     · importance ×6 · unread +4 · about an open project +8 · waiting on your reply a few days +2/day (max +10).
 *   From a machine (alerts, CI, receipts, marketing): only an action email with a real upcoming date counts
 *     (a bill or renewal due by a date); everything else stays out of "do first".
 *   Waiting on someone 5+ days: worth a nudge. "No reply needed" never counts.
 */
export function scoreEmail(m: BriefMessage, projects: { id: string; title: string }[] = [], now: Date = new Date()): { score: number; why: string } {
  if (m.is_archived || m.status === 'dismissed' || m.status === 'tasks_created') return { score: 0, why: '' };
  const text = `${m.subject ?? ''} ${m.snippet ?? ''}`;
  const due = parseDue(text, now);
  const dueDays = due ? daysUntil(due.date, now) : null;
  const age = daysSince(m.received_at, now) ?? 0;
  const reasons: string[] = [];

  if (isAutomated(m)) {
    // A bill, renewal or appointment with a real date can matter; alerts and notifications don't need you first.
    if (m.category === 'action_needed' && due && !RELATIVE_ONLY.test(due.matched.trim()) && dueDays !== null && dueDays >= 0 && dueDays <= 14) {
      return { score: 45 + (dueDays <= 2 ? 15 : 0), why: `Due ${friendlyDate(due.date, now)}` };
    }
    return { score: 0, why: '' };
  }
  if (NO_ACTION.test(text) && m.category !== 'action_needed') return { score: 0, why: '' };

  let score = 0;
  const asks = ASKS.test(text);
  if (m.category === 'action_needed') { score += 40; reasons.push('needs a reply or action'); }
  if (asks) { score += 20; if (!reasons.length) reasons.push('asks you something'); }
  if (due && dueDays !== null && dueDays >= -1) {
    score += 20 + (dueDays <= 2 ? 15 : 0) + Math.max(0, 7 - dueDays); // sooner dates first
    reasons.unshift(`mentions ${friendlyDate(due.date, now)}`);
  }
  score += (m.importance ?? 1) * 6;
  if (m.is_unread) score += 4;
  const project = matchProject(text, projects);
  if (project) { score += 8; reasons.push(`about “${projects.find((p) => p.id === project.id)?.title}”`); }
  if ((m.category === 'action_needed' || asks) && age >= 2) { score += Math.min(age, 5) * 2; reasons.push(`${age} days ago`); }
  if (m.category === 'waiting_on') return { score: age >= 5 ? 45 : 0, why: `No answer in ${age} days, worth a nudge` };
  const why = (reasons.length ? reasons.slice(0, 2).join(', ') : 'from a person');
  return { score, why: why.charAt(0).toUpperCase() + why.slice(1) };
}

/** Up to `max` emails worth doing first, best first (score 40+), one per conversation. */
export function doFirst(msgs: BriefMessage[], projects: { id: string; title: string }[] = [], now: Date = new Date(), max = 5): DoFirst[] {
  const seen = new Set<string>();
  return msgs
    .map((m) => ({ m, ...scoreEmail(m, projects, now) }))
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score || b.m.received_at.localeCompare(a.m.received_at))
    .filter((x) => { const k = x.m.thread_id ?? x.m.id; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max)
    .map((x) => ({ message_id: x.m.id, why: x.why }));
}

// ───────────────────────── Notifications, grouped

export interface NotificationGroup { sender: string; count: number; topic: string; unread: number; latest: BriefMessage; ids: string[] }

/** Machine mail grouped by service: "GitHub · 18 · mostly Run failed: Test & deploy". Biggest groups first. */
export function notificationGroups(msgs: BriefMessage[]): NotificationGroup[] {
  const groups = new Map<string, BriefMessage[]>();
  for (const m of msgs) {
    if (!isAutomated(m) || m.is_archived || m.status === 'dismissed') continue;
    const k = senderLabel(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.entries()].map(([sender, list]) => {
    const topics = new Map<string, number>();
    for (const m of list) { const t = subjectKey(m.subject); if (t) topics.set(t, (topics.get(t) ?? 0) + 1); }
    const topic = [...topics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const sorted = [...list].sort((a, b) => b.received_at.localeCompare(a.received_at));
    return { sender, count: list.length, topic, unread: list.filter((m) => m.is_unread).length, latest: sorted[0], ids: sorted.map((m) => m.id) };
  }).sort((a, b) => b.count - a.count);
}

// ───────────────────────── The summary paragraph

const end = (x: string) => (/[.?!…]$/.test(x) ? x : `${x}.`);
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);

/**
 * A short paragraph: what needs you (most urgent first), who you're waiting on, other mail from people, then the
 * notifications by service ("18 from GitHub, mostly “Run failed: Test & deploy”") and what can wait.
 */
export function rulesBriefing(msgs: BriefMessage[], projects: { id: string; title: string }[] = [], now: Date = new Date()): Briefing {
  const live = msgs.filter((m) => !m.is_archived && m.status !== 'dismissed');
  const counts: Record<string, number> = { total: live.length };
  for (const m of live) counts[m.category ?? 'other'] = (counts[m.category ?? 'other'] ?? 0) + 1;
  if (!live.length) return { summary: 'Nothing new in your inbox. Enjoy the quiet.', do_first: [], counts };

  const first = doFirst(live, projects, now);
  const byId = new Map(live.map((m) => [m.id, m]));
  const parts: string[] = [];
  if (first.length) {
    const [top, ...rest] = first.map((f) => byId.get(f.message_id)!);
    parts.push(`${first.length === 1 ? 'One email needs you' : `${first.length} emails need you`}. Start with ${end(oneLine(top))}`);
    if (rest.length) parts.push(`Then ${listJoin(rest.slice(0, 3).map((m) => senderLabel(m)))}.`);
  } else {
    parts.push('Nothing in your inbox needs a reply right now.');
  }
  const firstIds = new Set(first.map((f) => f.message_id));
  const waiting = live.filter((m) => m.category === 'waiting_on' && !firstIds.has(m.id));
  if (waiting.length) parts.push(`You’re waiting to hear back from ${listJoin([...new Set(waiting.map(senderLabel))].slice(0, 3))}.`);
  const people = live.filter((m) => !isAutomated(m) && !firstIds.has(m.id) && m.category !== 'waiting_on');
  if (people.length) {
    const names = [...new Set(people.map(senderLabel))];
    parts.push(`${people.length === 1 ? 'One other email' : `${people.length} other emails`} from ${listJoin(names.slice(0, 3))}${names.length > 3 ? ' and others' : ''}, nothing urgent.`);
  }
  const groups = notificationGroups(live.filter((m) => !firstIds.has(m.id) && m.category !== 'waiting_on'));
  if (groups.length) {
    const top = groups.slice(0, 3).map((g) => `${g.count} from ${g.sender}${g.count > 2 && g.topic ? ` (mostly “${clip(g.topic, 40)}”)` : ''}`);
    const others = groups.slice(3).reduce((s, g) => s + g.count, 0);
    parts.push(`Notifications: ${listJoin(others ? [...top, `${others} more`] : top)}.`);
  }
  return { summary: parts.join(' '), do_first: first, counts };
}
