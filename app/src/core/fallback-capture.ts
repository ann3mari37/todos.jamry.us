// Deterministic capture splitter used when AI is unavailable or disabled.
// It is intentionally conservative: the user reviews everything before saving.

import type { CaptureItem } from './ai-contracts';
import type { LifeArea } from './types';

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

// Keyword hints for the default life areas, matched by area name so renamed/custom areas are simply skipped.
const AREA_HINTS: Record<string, RegExp> = {
  home: /\b(garage|house|home|kitchen|yard|garden|laundry|clean|paint|repair|furniture|closet|basement|attic|groceries|dishes|declutter)\b/i,
  work: /\b(app|website|site|client|meeting|boss|report|presentation|project|code|deploy|launch|work|office|colleague|deadline|proposal)\b/i,
  health: /\b(doctor|dentist|gym|workout|exercise|run|walk|yoga|meds|medication|therapy|sleep|diet|health|checkup|appointment)\b/i,
  finances: /\b(bill|pay|tax|taxes|bank|budget|insurance|invoice|loan|mortgage|rent|savings|invest|credit|refund)\b/i,
  relationships: /\b(mom|dad|mother|father|friend|birthday|wife|husband|partner|kids|son|daughter|family|sister|brother|wedding|anniversary)\b/i,
  'personal growth': /\b(learn|read|book|course|class|practice|journal|meditate|study|language|skill|guitar|piano)\b/i,
};

export function guessLifeArea(text: string, areas: Pick<LifeArea, 'id' | 'name' | 'archived_at'>[]): string | null {
  for (const a of areas) {
    if (a.archived_at) continue;
    const hint = AREA_HINTS[a.name.trim().toLowerCase()];
    if (hint?.test(text)) return a.id;
  }
  return null;
}

export function fallbackInterpret(text: string, areas: Pick<LifeArea, 'id' | 'name' | 'archived_at'>[] = []): { items: CaptureItem[]; questions: string[] } {
  const items: CaptureItem[] = splitCapture(text).map((part) => {
    const stripped = part.replace(LEAD_IN, '').replace(/^i\s+/i, '');
    const done = PAST_TENSE.test(stripped) || /\balready\b/i.test(part);
    const kind: CaptureItem['kind'] = done ? 'accomplishment' : GOAL_HINT.test(stripped) ? 'goal' : 'action';
    return {
      kind,
      title: tidy(part).slice(0, 200),
      source_excerpt: part.slice(0, 500),
      estimated_minutes: null,
      suggested_goal_id: null,
      suggested_life_area_id: guessLifeArea(part, areas),
      possible_duplicate_of: null,
      deadline: null,
      deadline_type: 'none',
      occurred_at: null,
      confidence: 0.4,
      next_actions: [],
    };
  });
  return { items, questions: [] };
}
