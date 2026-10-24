// Application contracts for AI operations. The Worker validates every model
// response against these schemas (unknown fields rejected) before returning it.

import { z } from 'zod';

const id = z.string().uuid();
const title = z.string().trim().min(1).max(200);
const minutes = z.number().int().min(1).max(600).nullable();

// ── interpret_capture
export const CaptureItem = z
  .object({
    kind: z.enum(['goal', 'action', 'accomplishment', 'note']),
    title,
    source_excerpt: z.string().max(500), // the words this came from, so nothing is silently invented
    estimated_minutes: minutes,
    suggested_goal_id: id.nullable(), // match to an existing goal
    suggested_life_area_id: id.nullable(),
    possible_duplicate_of: id.nullable(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    deadline_type: z.enum(['none', 'target', 'hard']),
    occurred_at: z.string().nullable(), // for accomplishments described in the past ("yesterday")
    confidence: z.number().min(0).max(1),
    next_actions: z
      .array(z.object({ title, estimated_minutes: minutes }).strict())
      .max(3), // for goals: a first 2–3 steps
  })
  .strict();
export type CaptureItem = z.infer<typeof CaptureItem>;

export const InterpretCaptureOutput = z
  .object({ items: z.array(CaptureItem).max(20), questions: z.array(z.string().max(300)).max(3) })
  .strict();
export type InterpretCaptureOutput = z.infer<typeof InterpretCaptureOutput>;

// ── decompose_goal
export const SuggestedAction = z
  .object({
    title,
    estimated_minutes: minutes,
    completion_criteria: z.string().max(300),
    requires_clarification: z.boolean(),
    depends_on_index: z.number().int().min(0).max(5).nullable(),
  })
  .strict();
export type SuggestedAction = z.infer<typeof SuggestedAction>;

export const DecomposeGoalOutput = z
  .object({
    goal_id: id,
    suggested_actions: z.array(SuggestedAction).max(5),
    questions: z.array(z.string().max(300)).max(3),
    uncertainty_note: z.string().max(400).nullable(), // e.g. "Check the official instructions for exact requirements."
  })
  .strict();
export type DecomposeGoalOutput = z.infer<typeof DecomposeGoalOutput>;

// ── classify_accomplishment / match_accomplishment_to_goal
export const ClassifiedAccomplishment = z
  .object({
    title,
    occurred_at: z.string().nullable(),
    suggested_goal_id: id.nullable(),
    advances_goal: z.boolean(),
    matches_action_id: id.nullable(),
    suggested_life_area_id: id.nullable(),
    possible_duplicate_of: id.nullable(),
  })
  .strict();
export const ClassifyAccomplishmentOutput = z
  .object({ items: z.array(ClassifiedAccomplishment).max(20) })
  .strict();
export type ClassifyAccomplishmentOutput = z.infer<typeof ClassifyAccomplishmentOutput>;

// ── suggest_next_actions (explanations only — eligibility is deterministic)
export const ExplainRecommendationsOutput = z
  .object({ reasons: z.array(z.object({ action_id: id, reason: z.string().max(160) }).strict()).max(8) })
  .strict();

// ── identify_possible_blockers
export const BlockersOutput = z
  .object({
    possible_blockers: z.array(z.string().max(200)).max(4),
    smaller_step: z.object({ title, estimated_minutes: minutes }).strict().nullable(),
    question: z.string().max(300).nullable(),
  })
  .strict();

// ── generate_accountability_nudge
export const NudgeOutput = z.object({ message: z.string().min(10).max(280) }).strict();

// ── generate_progress_summary
export const ProgressSummaryOutput = z
  .object({
    summary: z.string().max(1200),
    highlights: z.array(z.string().max(160)).max(5),
    quiet_goals: z.array(z.string().max(160)).max(3),
  })
  .strict();

// ── Commit (user-confirmed capture review → database)
export const CommitItem = z
  .object({
    client_id: z.string().uuid(), // idempotency per item
    kind: z.enum(['goal', 'action', 'accomplishment', 'note']),
    title,
    goal_id: id.nullable(),
    life_area_id: id.nullable(),
    estimated_minutes: minutes,
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    deadline_type: z.enum(['none', 'target', 'hard']),
    occurred_at: z.string().nullable(),
    meaningful: z.boolean(),
    meaning: z.string().max(1000).optional(), // user-stated "why it matters" (goals)
    next_actions: z.array(z.object({ title, estimated_minutes: minutes }).strict()).max(5),
  })
  .strict();
export type CommitItem = z.infer<typeof CommitItem>;
export const CommitCaptureInput = z
  .object({ capture_id: id.nullable(), raw_text: z.string().max(8000), items: z.array(CommitItem).min(1).max(20) })
  .strict();
export type CommitCaptureInput = z.infer<typeof CommitCaptureInput>;
