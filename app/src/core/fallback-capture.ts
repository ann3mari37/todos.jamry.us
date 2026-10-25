// Deterministic capture splitter used when AI is unavailable or disabled.
// It is intentionally conservative: the user reviews everything before saving.

import type { CaptureItem } from './ai-contracts';
import { estimateMinutes, guessLifeArea, matchProject, parseDue, stripDue, type AreaLike } from './rules';

export { guessLifeArea } from './rules';

const PAST_TENSE = /^(i\s+)?(already\s+)?(just\s+)?(paid|called|sent|cleaned|finished|did|made|fixed|returned|booked|bought|emailed|wrote|submitted|completed|took|went|cooked|walked|ran|read|washed|picked up|dropped off|cancelled|canceled|organized|scheduled|replied|texted|filed|signed|mailed|ordered|tidied|vacuumed|mowed|painted|started|built|launched|renewed|updated|moved|sold)\b/i;
// Outcomes that usually take several steps become projects (goals); everything else is a single action.
const GOAL_HINT = /\b(organi[sz]e|plan|launch|build|renovate|remodel|improve|learn|finish|complete|submit|prepare|redo|overhaul|paint|start|create|design|develop|write (a|my|the)|move|declutter|set up|get .* in order)\b/i;
const LEAD_IN = /^(i\s+(also\s+)?(need|have|want|should|must|gotta|got|would like)\s+to\s+|also\s+need\s+to\s+|need\s+to\s+|to\s+|and\s+(also\s+|then\s+)?|also\s+|then\s+|plus\s+)/i;

// Words that can start a new item after "and" ("…the garage and start a new app").
const VERBS = [
  'need', 'have', 'want', 'should', 'must', 'call', 'email', 'text', 'reply', 'clean', 'paint', 'start', 'build', 'create', 'design', 'write',
  'read', 'plan', 'launch', 'learn', 'renovate', 'repair', 'fix', 'cook', 'wash', 'move', 'sell', 'buy', 'order', 'book', 'schedule',
  'cancel', 'renew', 'update', 'get', 'go', 'visit', 'return', 'pick', 'drop', 'file', 'print', 'sign', 'mail', 'send', 'pay', 'submit',
  'finish', 'organi[sz]e', 'research', 'look', 'check', 'review', 'prepare', 'practice', 'exercise', 'walk', 'run', 'mow', 'water', 'make',
  'do', 'set', 'take', 'find', 'apply', 'register', 'sort', 'declutter', 'meet', 'talk', 'ask', 'remember',
  'paid', 'called', 'sent', 'cleaned', 'finished', 'fixed', 'did', 'made', 'painted', 'started', 'bought', 'booked',
].join('|');

const SPLIT = new RegExp(
  [
    '[.;\\n•!?]+',
    ',\\s*(?:and\\s+)?(?:also\\s+|then\\s+)?',
    '\\s+(?:and\\s+)?(?:also|then|plus)\\s+', // "… and also …", "… then …"
    `\\s+and\\s+(?=(?:i\\s+)?(?:already\\s+|also\\s+|just\\s+)?(?:${VERBS})\\b)`,
  ].join('|'),
  'i',
);

export function splitCapture(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !/^(i|and|also|then|plus)$/i.test(s));
}

function tidy(s: string): string {
  let t = s.replace(LEAD_IN, '').replace(LEAD_IN, '').replace(/^i\s+(already\s+|just\s+)?/i, '').trim();
  t = t.replace(/[.!]+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fallbackInterpret(
  text: string,
  areas: AreaLike[] = [],
  goals: { id: string; title: string }[] = [],
  now: Date = new Date(),
): { items: CaptureItem[]; questions: string[] } {
  const items: CaptureItem[] = splitCapture(text).map((part) => {
    const stripped = part.replace(LEAD_IN, '').replace(/^i\s+/i, '');
    const done = PAST_TENSE.test(stripped) || /\balready\b/i.test(part);
    const kind: CaptureItem['kind'] = done ? 'accomplishment' : GOAL_HINT.test(stripped) ? 'goal' : 'action';
    const due = done ? null : parseDue(part, now);
    const title = stripDue(tidy(part), due).slice(0, 200);
    // A task sharing a distinctive word with an existing project goes into it ("Buy paint" → "Paint the garage").
    const project = kind === 'goal' ? null : matchProject(title, goals);
    return {
      kind,
      title,
      source_excerpt: part.slice(0, 500),
      estimated_minutes: kind === 'action' ? estimateMinutes(title) : null,
      suggested_goal_id: project?.id ?? null,
      suggested_life_area_id: project ? null : guessLifeArea(part, areas),
      possible_duplicate_of: null,
      deadline: due?.date ?? null,
      deadline_type: due?.type ?? 'none',
      occurred_at: null,
      confidence: 0.4,
      next_actions: [],
    };
  });
  return { items, questions: [] };
}
