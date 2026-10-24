// Deterministic capture splitter used when AI is unavailable or disabled.
// It is intentionally conservative: the user reviews everything before saving.

import type { CaptureItem } from './ai-contracts';

const PAST_TENSE = /^(i\s+)?(already\s+)?(just\s+)?(paid|called|sent|cleaned|finished|did|made|fixed|returned|booked|bought|emailed|wrote|submitted|completed|took|went|cooked|walked|ran|read|washed|picked up|dropped off|cancelled|canceled|organized|scheduled|replied|texted|filed|signed|mailed|ordered|tidied|vacuumed|mowed)\b/i;
const GOAL_HINT = /\b(organi[sz]e|plan|launch|build|renovate|improve|learn|finish|complete|submit|prepare|redo|overhaul|get .* in order)\b/i;
const LEAD_IN = /^(i\s+(also\s+)?(need|have|want|should|must|gotta|got)\s+to\s+|also\s+need\s+to\s+|need\s+to\s+|to\s+|and\s+|also\s+|then\s+)/i;

export function splitCapture(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?:[.;\n•]+|,\s*(?:and\s+)?|\s+and\s+(?=(?:i\s+)?(?:already\s+|also\s+|just\s+)?(?:need|have|want|should|call|email|clean|paid|pay|submit|organi[sz]e|finish|book|buy|send|sent|called|cleaned|finished|fix|fixed|did|make|made)\b))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function tidy(s: string): string {
  let t = s.replace(LEAD_IN, '').replace(LEAD_IN, '').replace(/^i\s+(already\s+|just\s+)?/i, '').trim();
  t = t.replace(/[.!]+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fallbackInterpret(text: string): { items: CaptureItem[]; questions: string[] } {
  const items: CaptureItem[] = splitCapture(text).map((part) => {
    const stripped = part.replace(LEAD_IN, '').replace(/^i\s+/i, '');
    const done = PAST_TENSE.test(stripped) || /\balready\b/i.test(part);
    const kind: CaptureItem['kind'] = done ? 'accomplishment' : GOAL_HINT.test(part) ? 'goal' : 'action';
    return {
      kind,
      title: tidy(part).slice(0, 200),
      source_excerpt: part.slice(0, 500),
      estimated_minutes: null,
      suggested_goal_id: null,
      suggested_life_area_id: null,
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
