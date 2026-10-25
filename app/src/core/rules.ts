// Rule-based organizing used when no AI provider is configured or reachable.
// Shared by the app (capture fallback) and the Worker (organize + email triage fallback).
// Everything here is deterministic and conservative: it only fills in what the words clearly say.

import type { EmailCategory, EmailStep } from './ai-contracts';
import { toISODate } from './dates';
import type { LifeArea } from './types';

// ───────────────────────── Dates ─────────────────────────

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "Hard" only when missing the date has an outside consequence; everything else is a target date.
const HARD_WORDS = /\b(due|deadline|expires?|expiring|overdue|renew(al)?|late fee|no later than|must)\b/i;

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export interface ParsedDue { date: string; type: 'hard' | 'target'; matched: string }

/** Finds the first date the text states ("by Friday", "tomorrow", "Nov 1", "11/1", "in 2 weeks", "end of month"). */
export function parseDue(text: string, now: Date = new Date()): ParsedDue | null {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // "next" is not a lead-in: "next Friday" means the Friday after the coming one.
  const lead = '(?:(?:due|by|on|before|until|for|this|no later than)\\s+)*';
  const found = (date: Date, m: RegExpMatchArray): ParsedDue => ({
    date: toISODate(date),
    type: HARD_WORDS.test(text) ? 'hard' : 'target',
    matched: text.slice(m.index!, m.index! + m[0].length),
  });
  let m: RegExpMatchArray | null;

  if ((m = t.match(new RegExp(`\\b${lead}(today|tonight)\\b`)))) return found(today, m);
  if ((m = t.match(new RegExp(`\\b${lead}tomorrow\\b`)))) return found(addDays(today, 1), m);
  if ((m = t.match(/\b(?:by\s+|before\s+)?(?:the\s+)?end of (?:the\s+)?(week|month)\b/))) {
    if (m[1] === 'week') return found(addDays(today, (5 - today.getDay() + 7) % 7 || 7), m); // Friday
    return found(new Date(today.getFullYear(), today.getMonth() + 1, 0), m);
  }
  if ((m = t.match(new RegExp(`\\b${lead}(this )?weekend\\b`)))) return found(addDays(today, (6 - today.getDay() + 7) % 7 || 7), m);
  if ((m = t.match(/\bnext week\b/))) return found(addDays(today, ((8 - today.getDay()) % 7) || 7), m); // next Monday
  if ((m = t.match(/\bin (\d{1,2}|a|one|two|three) (day|week)s?\b/))) {
    const n = ({ a: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[m[1]] ?? Number(m[1]);
    return found(addDays(today, m[2] === 'week' ? n * 7 : n), m);
  }
  if ((m = t.match(new RegExp(`\\b${lead}(next )?(${WEEKDAY_NAMES.join('|')}|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\b`)))) {
    const word = m[2].slice(0, 3);
    const target = WEEKDAY_NAMES.findIndex((d) => d.startsWith(word));
    let diff = (target - today.getDay() + 7) % 7 || 7;
    if (m[1]) diff += diff < 7 ? 7 : 0; // "next Friday" = the one after this coming one
    return found(addDays(today, diff), m);
  }
  // "Nov 1", "November 1st", "1 Nov", optionally with a year
  if ((m = t.match(new RegExp(`\\b${lead}(${MONTH_NAMES.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`)))) {
    return found(rollForward(today, MONTH_NAMES.indexOf(m[1]), Number(m[2]), m[3]), m);
  }
  if ((m = t.match(new RegExp(`\\b${lead}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES.join('|')})[a-z]*(?:\\s+(\\d{4}))?\\b`)))) {
    return found(rollForward(today, MONTH_NAMES.indexOf(m[2]), Number(m[1]), m[3]), m);
  }
  if ((m = t.match(new RegExp(`\\b${lead}(\\d{4})-(\\d{2})-(\\d{2})\\b`)))) {
    return found(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), m);
  }
  if ((m = t.match(new RegExp(`\\b${lead}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`)))) {
    const month = Number(m[1]) - 1, day = Number(m[2]);
    if (month > 11 || day > 31 || day < 1) return null;
    const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
    return found(rollForward(today, month, day, year), m);
  }
  return null;
}

/** A month/day without a year means the next occurrence (Jan 5 said in December is next year). */
function rollForward(today: Date, month: number, day: number, year?: string): Date {
  if (year) return new Date(Number(year), month, day);
  const d = new Date(today.getFullYear(), month, day);
  return d < addDays(today, -1) ? new Date(today.getFullYear() + 1, month, day) : d;
}

/** Removes the date phrase from a title: "Pay rent by Friday" → "Pay rent". */
export function stripDue(title: string, due: ParsedDue | null): string {
  if (!due) return title;
  return title.replace(due.matched, '').replace(/\s{2,}/g, ' ').replace(/[\s,;-]+$/, '').trim() || title;
}

// ───────────────────────── Time estimates ─────────────────────────

const MINUTE_RULES: [RegExp, number][] = [
  [/\b(text|reply|respond|rsvp|confirm|remind)\b/i, 5],
  [/\b(call|phone|email|message|book|schedule|order|pay|renew|cancel|sign|submit|send|mail|print|return)\b/i, 10],
  [/\b(update|edit|log|note|file|back ?up|fill (out|in)|clean|tidy|wash|water|sort|pick up|drop off|buy|shop|groceries|review|check|laundry)\b/i, 15],
  [/\b(prepare|plan|organi[sz]e|fix|repair|cook|bake)\b/i, 30],
  [/\b(read|write|draft|research|study|practice|workout|exercise|run|walk|yoga|cook|meal prep)\b/i, 30],
  [/\b(meeting|appointment|class|lesson|doctor|dentist)\b/i, 60],
];

/** Rough minutes for a single action, or null when the words don't say. */
export function estimateMinutes(title: string): number | null {
  const explicit = title.match(/\b(\d{1,3})\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i);
  if (explicit) return Math.min(600, Number(explicit[1]) * (/^h/i.test(explicit[2]) ? 60 : 1));
  for (const [re, minutes] of MINUTE_RULES) if (re.test(title)) return minutes;
  return null;
}

// ───────────────────────── Why it matters ─────────────────────────

// Specific wording wins; then the life area; then a general line for projects. Gentle, factual, never pushy.
const WHY_BY_WORDS: [RegExp, string][] = [
  // Paperwork first, so "Renew passport" reads as an obligation rather than money.
  [/\b(document|form|application|submit|passport|license|licence|permit|visa|register)\b/i, 'Gets an obligation off your mind for good.'],
  [/\b(pay|bill|rent|tax|taxes|invoice|insurance|renew|bank|budget|loan|mortgage)\b/i, 'Keeps your finances on track and avoids late fees or penalties.'],
  [/\b(doctor|dentist|meds|medication|prescription|workout|exercise|gym|therapy|checkup|physio)\b/i, 'Looking after your health now saves bigger problems later.'],
  [/\b(mom|dad|mother|father|friend|family|birthday|kids|son|daughter|wife|husband|partner|anniversary|wedding)\b/i, 'Time and care for the people who matter to you.'],
  [/\b(client|crm|customer|boss|team|report|proposal|meeting|presentation|deadline)\b/i, 'Keeps your work, and the people relying on it, moving.'],
  [/\b(app|website|site|launch|business|product|portfolio|book)\b/i, 'Turns an idea into something real.'],
  [/\b(garage|clean|laundry|kitchen|declutter|organi[sz]e|repair|paint|closet|yard|garden)\b/i, 'A calmer, easier home to live in.'],
  [/\b(learn|course|study|practice|class|language|guitar|piano)\b/i, "An investment in who you're becoming."],
];
const WHY_BY_AREA: Record<string, string> = {
  home: 'A calmer, easier home to live in.',
  work: 'Keeps your work, and the people relying on it, moving.',
  health: 'Looking after your health now saves bigger problems later.',
  finances: 'Keeps your finances on track and avoids surprises.',
  relationships: 'Time and care for the people who matter to you.',
  'personal growth': "An investment in who you're becoming.",
};

/**
 * A suggested "why it matters" for anything that isn't a quick task. Returns null for quick tasks (15 min or less),
 * which don't need a reason to be done.
 */
export function suggestWhy(
  title: string,
  opts: { areaName?: string | null; isProject?: boolean; minutes?: number | null; due?: { date: string; type: string } | null; now?: Date } = {},
): string | null {
  const minutes = opts.minutes ?? estimateMinutes(title);
  if (!opts.isProject && minutes !== null && minutes <= 15) return null;
  const base = WHY_BY_WORDS.find(([re]) => re.test(title))?.[1]
    ?? (opts.areaName ? WHY_BY_AREA[opts.areaName.trim().toLowerCase()] : undefined)
    // No area yet: use the built-in area hints ("hooks" → home) to pick the wording.
    ?? WHY_BY_AREA[Object.keys(AREA_HINTS).find((k) => AREA_HINTS[k].test(title)) ?? '']
    ?? (opts.isProject || looksLikeProject(title) ? 'Finishing this frees up space in your head.' : 'One less thing waiting on your list.');
  if (opts.due && opts.due.type === 'hard') return `It has a real deadline. ${base}`;
  return base;
}

// ───────────────────────── Project detection ─────────────────────────

// Word stems, so typos and endings still count ("createa new app", "building a deck").
const PROJECT_WORDS = /\b(creat\w*|build\w*|start\w*|launch\w*|design\w*|develop\w*|plan|planning|organi[sz]\w*|renovat\w*|remodel\w*|redo|overhaul\w*|set ?up|write (a|an|my|the)|learn\w*|move|moving|declutter\w*|paint\w*|prepar\w* for|get .* in order)\b/i;

/** A task that reads like an outcome needing several steps ("Create a project management app for Malinda"). */
export function looksLikeProject(title: string): boolean {
  const words = title.trim().split(/\s+/).length;
  const minutes = estimateMinutes(title);
  return words >= 3 && PROJECT_WORDS.test(title) && (minutes === null || minutes > 30);
}

// ───────────────────────── Life areas ─────────────────────────

// Keyword hints for the default life areas, matched by area name so renamed/custom areas are simply skipped.
const AREA_HINTS: Record<string, RegExp> = {
  home: /\b(garage|house|home|kitchen|yard|garden|laundry|clean|paint|repair|furniture|closet|basement|attic|groceries|dishes|declutter|bins?|hooks?|shelves?|lawn|mow)\b/i,
  work: /\b(app|website|site|client|meeting|boss|report|presentation|project|code|deploy|launch|work|office|colleague|deadline|proposal|invoice client|slides|team)\b/i,
  health: /\b(doctor|dentist|gym|workout|exercise|run|walk|yoga|meds|medication|prescription|therapy|sleep|diet|health|checkup|appointment|physio|vitamins)\b/i,
  finances: /\b(bill|pay|tax|taxes|bank|budget|insurance|invoice|loan|mortgage|rent|savings|invest|credit|refund|policy|premium|electric|utilities)\b/i,
  relationships: /\b(mom|dad|mother|father|friend|birthday|wife|husband|partner|kids|son|daughter|family|sister|brother|wedding|anniversary|brunch|dinner with|date night)\b/i,
  'personal growth': /\b(learn|read|book|course|class|practice|journal|meditate|study|language|skill|guitar|piano|podcast)\b/i,
};

export type AreaLike = Pick<LifeArea, 'id' | 'name' | 'archived_at'> & { keywords?: string[] | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The user's own words for an area win over the built-in hints; then the area's own name counts as a keyword. */
function userWordsMatch(text: string, a: AreaLike): boolean {
  const words = [...(a.keywords ?? []), a.name].map((w) => w.trim()).filter((w) => w.length >= 2);
  return words.some((w) => new RegExp(`\\b${escapeRe(w)}`, 'i').test(text));
}

export function guessLifeArea(text: string, areas: AreaLike[]): string | null {
  const live = areas.filter((a) => !a.archived_at);
  const custom = live.find((a) => (a.keywords?.length ?? 0) > 0 && userWordsMatch(text, a));
  if (custom) return custom.id;
  for (const a of live) {
    if (!AREA_HINTS[a.name.trim().toLowerCase()] && userWordsMatch(text, a)) return a.id; // e.g. an area called "Church"
  }
  for (const a of areas) {
    if (a.archived_at) continue;
    const hint = AREA_HINTS[a.name.trim().toLowerCase()];
    if (hint?.test(text)) return a.id;
  }
  return null;
}

// ───────────────────────── Projects ─────────────────────────

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'on', 'in', 'at', 'my', 'our', 'your', 'with', 'from', 'about', 'up', 'out', 'new',
  'get', 'make', 'do', 'set', 'finish', 'start', 'call', 'email', 'buy', 'book', 'send', 'find', 'take', 'go', 'plan', 'organize', 'organise',
  'some', 'more', 'all', 'this', 'that', 'it', 'is', 'be', 'need', 'needs', 'want', 'have', 'list', 'stuff', 'things', 'thing', 'task',
  // Everyday verbs say what to do, not what it's about: "Renew the car registration" isn't part of "Renew insurance".
  'renew', 'pay', 'write', 'read', 'review', 'update', 'check', 'schedule', 'cancel', 'order', 'submit', 'reply', 'prepare', 'research',
  'sign', 'print', 'register', 'apply', 'look', 'ask', 'talk', 'create', 'build', 'design', 'launch', 'fix', 'clean', 'pick', 'drop', 'return',
]);

/** Meaningful words, lightly stemmed so "shelves"/"shelf", "painting"/"paint" match. */
export function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ers|er|es|s)$/, '').replace(/ves$/, 'f'))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** The existing project a task clearly belongs to (shares a distinctive word), or null. */
export function matchProject(title: string, goals: { id: string; title: string }[]): { id: string; word: string } | null {
  const mine = new Set(keywords(title));
  let best: { id: string; word: string; score: number } | null = null;
  for (const g of goals) {
    const shared = keywords(g.title).filter((w) => mine.has(w));
    if (!shared.length) continue;
    const score = shared.length * 10 + Math.max(...shared.map((w) => w.length));
    if (!best || score > best.score) best = { id: g.id, word: shared[0], score };
  }
  return best && best.word.length >= 4 ? { id: best.id, word: best.word } : null;
}

// ───────────────────────── Email triage ─────────────────────────

export interface EmailLike { from_name: string | null; from_address: string | null; subject: string | null; snippet: string | null }
export interface EmailTriage { category: EmailCategory; importance: 1 | 2 | 3; summary: string; suggested_actions: EmailStep[] }

const AUTOMATED_SENDER = /(no-?reply|do-?not-?reply|notifications?|mailer|newsletter|news|digest|updates?|info|support|billing|team|hello|marketing|offers|deals|promo|account|alerts?)@/i;
const PROMOTION = /(\d+% off|\bsale\b|\bdeals?\b|coupon|promo code|limited time|free shipping|shop now|exclusive offer|don'?t miss)/i;
const NEWSLETTER = /(newsletter|digest|weekly|monthly|issue #?\d+|this week in|roundup|edition)/i;
const RECEIPT = /(receipt|payment (received|confirmation|successful)|order (confirmation|confirmed|#)|thank you for your (order|purchase|payment)|invoice paid|your purchase)/i;
const WAITING = /(has shipped|on its way|out for delivery|we('| a)re (reviewing|processing)|will (get back|follow up|be in touch)|in progress|we received your|application (received|submitted)|pending review|is propagating)/i;
const ACTION = /(action required|please (reply|respond|confirm|review|sign|complete|submit|update|verify|pay)|\bdue\b|deadline|expires?|expiring|overdue|reminder|renew|verify your|can you|could you|would you|let me know|are you (free|available)|rsvp|needs? your)/i;
const URGENT = /(urgent|asap|today|tomorrow|overdue|final notice|expires?|deadline|\bdue\b|past due|late fee)/i;
const MONEY = /(\$\d|payment|invoice|bill|renew|premium|tax|bank|refund)/i;

function firstSentence(text: string | null | undefined, max = 160): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  const s = t.match(/^(.{20,}?[.!?])(\s|$)/)?.[1] ?? t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Category, importance, a one-line summary and (for requests) a suggested task — from the visible words only. */
export function triageEmail(m: EmailLike, now: Date = new Date()): EmailTriage {
  const text = `${m.subject ?? ''}\n${m.snippet ?? ''}`;
  const automated = AUTOMATED_SENDER.test(m.from_address ?? '') || /\b(team|support|store|shop|bank|inc|llc)\b/i.test(m.from_name ?? '');
  const person = !automated;

  let category: EmailCategory;
  if (PROMOTION.test(text) && automated) category = 'promotion';
  else if (RECEIPT.test(text)) category = 'receipt';
  else if (WAITING.test(text)) category = 'waiting_on';
  else if (ACTION.test(text) || (person && /\?/.test(m.subject ?? ''))) category = 'action_needed';
  else if (NEWSLETTER.test(text) || (automated && /unsubscribe/i.test(m.snippet ?? ''))) category = 'newsletter';
  else if (person) category = 'personal';
  else category = 'fyi';

  const importance: 1 | 2 | 3 =
    category === 'action_needed' ? (URGENT.test(text) || MONEY.test(text) || person ? 3 : 2)
    : category === 'personal' || category === 'waiting_on' ? 2
    : 1;

  const who = (m.from_name || m.from_address || 'sender').split(/[<@]/)[0].trim() || 'sender';
  const subject = (m.subject ?? '').replace(/^((re|fwd?|aw):\s*)+/i, '').trim();
  const summary = firstSentence(m.snippet) || subject || `Email from ${who}`;

  const suggested_actions: EmailStep[] = [];
  if (category === 'action_needed') {
    const due = parseDue(text, now);
    let title: string;
    if (/\b(pay|payment|invoice|bill|past due)\b/i.test(text)) title = `Pay: ${subject || who}`;
    else if (/\brenew/i.test(text)) title = `Renew: ${subject || who}`;
    else if (/\b(sign|signature)\b/i.test(text)) title = `Sign: ${subject || who}`;
    else if (/\b(verify|confirm)\b/i.test(text) && automated) title = `Confirm: ${subject || who}`;
    else title = `Reply to ${who}${subject ? ` about ${subject}` : ''}`;
    suggested_actions.push({ title: title.slice(0, 200), estimated_minutes: estimateMinutes(title) ?? 10, deadline: due?.date ?? null });
  }
  return { category, importance, summary, suggested_actions };
}
