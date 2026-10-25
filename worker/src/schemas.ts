// JSON Schemas sent to OpenAI (strict mode: every property required, no extras).
// They mirror the Zod contracts in app/src/core/ai-contracts.ts, which remain the source of truth for validation.

type S = Record<string, unknown>;
const str: S = { type: 'string' };
const nstr: S = { type: ['string', 'null'] };
const nint: S = { type: ['integer', 'null'] };
const bool: S = { type: 'boolean' };
const arr = (items: S): S => ({ type: 'array', items });
const obj = (properties: Record<string, S>): S => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const enm = (...values: string[]): S => ({ type: 'string', enum: values });

const step = obj({ title: str, estimated_minutes: nint });

export const interpretCaptureSchema = obj({
  items: arr(
    obj({
      kind: enm('goal', 'action', 'accomplishment', 'note'),
      title: str,
      source_excerpt: str,
      estimated_minutes: nint,
      suggested_goal_id: nstr,
      suggested_life_area_id: nstr,
      possible_duplicate_of: nstr,
      deadline: nstr,
      deadline_type: enm('none', 'target', 'hard'),
      occurred_at: nstr,
      confidence: { type: 'number' },
      next_actions: arr(step),
    }),
  ),
  questions: arr(str),
});

export const decomposeGoalSchema = obj({
  goal_id: str,
  suggested_actions: arr(
    obj({
      title: str,
      estimated_minutes: nint,
      completion_criteria: str,
      requires_clarification: bool,
      depends_on_index: nint,
    }),
  ),
  questions: arr(str),
  uncertainty_note: nstr,
});

export const classifyAccomplishmentSchema = obj({
  items: arr(
    obj({
      title: str,
      occurred_at: nstr,
      suggested_goal_id: nstr,
      advances_goal: bool,
      matches_action_id: nstr,
      suggested_life_area_id: nstr,
      possible_duplicate_of: nstr,
    }),
  ),
});

export const blockersSchema = obj({
  possible_blockers: arr(str),
  smaller_step: { anyOf: [step, { type: 'null' }] },
  question: nstr,
});

export const nudgeSchema = obj({ message: str });

export const summarySchema = obj({ summary: str, highlights: arr(str), quiet_goals: arr(str) });

export const organizeSchema = obj({
  new_projects: arr(obj({ ref: str, title: str, life_area_id: nstr, reason: str })),
  assignments: arr(
    obj({
      kind: enm('action', 'goal'),
      id: str,
      goal_id: nstr,
      goal_ref: nstr,
      life_area_id: nstr,
      confidence: { type: 'number' },
      reason: str,
    }),
  ),
});

const emailStep = obj({ title: str, estimated_minutes: nint, deadline: nstr });

export const emailTriageSchema = obj({
  messages: arr(
    obj({
      id: str,
      category: enm('action_needed', 'waiting_on', 'fyi', 'newsletter', 'receipt', 'personal', 'promotion', 'other'),
      importance: { type: 'integer' },
      summary: str,
      life_area_id: nstr,
      suggested_goal_id: nstr,
      suggested_actions: arr(emailStep),
    }),
  ),
});

export const emailDigestSchema = obj({ summary: str, highlights: arr(obj({ message_id: str, text: str })) });

export const emailThreadSchema = obj({ summary: str, next_steps: arr(emailStep), waiting_on: nstr });
