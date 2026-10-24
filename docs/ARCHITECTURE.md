# Architecture

```
Expo app (iOS / web at todos.jamry.us)
  │  reads & simple writes ──────────────► Supabase Postgres (RLS on every table)
  │  AI + capture commit ─► Cloudflare Worker (todos.jamry.us/api/*)
  │                             ├─ verifies the Supabase access token (/auth/v1/user)
  │                             ├─ queries with the *user's* token → RLS still applies
  │                             ├─ calls OpenAI with minimal context, strict JSON schema
  │                             ├─ validates output with Zod (unknown fields rejected)
  │                             ├─ applies business rules, persists, logs metadata only
  │                             └─ daily Cron: gentle check-ins + Monday reflections
```

- The client only ever holds the Supabase **anon** key. The OpenAI key and the Supabase service-role key are Worker secrets. The service role is used only for writing `ai_operations` metadata and for the cron job.
- The Worker is stateless. Rate limits and cost caps are computed from `ai_operations`.
- Everything works without AI. Capture falls back to a deterministic splitter (`app/src/core/fallback-capture.ts`). Recommendations are always deterministic (`app/src/core/recommend.ts`). Saves fall back to calling the same idempotent database function directly, or queue offline.

## Code map

| Path | Purpose |
|---|---|
| `app/src/core/` | Platform-free domain logic shared by the app and the Worker: types, recommendation engine, accountability detection, AI contracts (Zod), fallback capture parser |
| `app/src/lib/store.tsx` | Data provider: Supabase loading, optimistic updates, offline cache, idempotent outbox |
| `app/src/lib/usePlan.ts` | Today's picks. Chosen once a day and never auto-refilled |
| `app/app/` | Screens (expo-router): `(tabs)/today`, `capture`, `projects`, `progress`, `more`; `project/[id]`, `celebrate`, `history`, `life-areas`, `settings/[section]`, `welcome`, `sign-in` |
| `worker/src/` | `index.ts` routing/CORS/limits · `ops.ts` AI operations · `openai.ts` structured calls, retries, cost · `prompts.ts` versioned prompts · `schemas.ts` OpenAI JSON schemas · `cron.ts` scheduled analysis |
| `supabase/migrations/` | Schema, RLS, triggers, `complete_action`, `commit_capture`, `record_accomplishment`, `export_my_data` |

## Data model

| Table | Purpose |
|---|---|
| `profiles` | Settings: AI on/off, tone, preferred step size, learned preferences |
| `life_areas` | Organizational groups (seeded with Home, Work, Health, Finances, Relationships, Personal Growth, Other) |
| `goals` | Outcomes. `meaning` and `meaning_source` (user/AI) are separate from `deadline` and `deadline_type` (none/target/hard), plus `accountability` mode, `status`, and `last_meaningful_progress_at` |
| `actions` | Concrete steps. `origin` (user/ai), `status` (`suggested` = unconfirmed AI suggestion), `user_edited`, skip counters |
| `action_dependencies` | "Can only start after…" |
| `accomplishments` | Everything done. `planned` (came from an action) and `meaningful` (advanced a goal) are tracked separately; `occurred_at` vs `created_at` supports retroactive entry |
| `progress_events` | Durable log with a goal-title snapshot, so history reads correctly after renames and archiving |
| `capture_entries` | The original raw text, kept before any AI call, plus the interpretation |
| `goal_context` | Notes, instructions, blockers, AI questions |
| `recommendations`, `recommendation_feedback` | Suggestion feedback (accepted / deferred / not suitable / show other) |
| `accountability_preferences`, `nudges` | Inactivity threshold, weekly cap, nudge history and responses |
| `notification_preferences` | Categories, quiet hours, daily cap |
| `ai_operations` | Operation, model, prompt version, tokens, cost, latency, status. **No content.** |
| `weekly_reflections` | Deterministic facts plus an optional AI summary |
| `client_mutations` | Idempotency keys for offline replays |

Database logic:
- `complete_action()` marks the action done, creates the planned accomplishment and the progress events, and bumps the goal. It is idempotent.
- Inserting an accomplishment logs `accomplishment_recorded`. It also logs `goal_advanced` when the accomplishment is linked to a goal and marked meaningful.
- Goal status and deadline changes are logged.
- Archiving never deletes accomplishments or events.

## API (Cloudflare Worker)

All routes except `/api/health` require `Authorization: Bearer <supabase access token>`. Bodies are capped at 64 KB, and AI routes are rate-limited and cost-capped per user.

| Route | Input | Output |
|---|---|---|
| `GET /api/health` | – | `{ ok, ai, env }` |
| `POST /api/ai/interpret-capture` | `{ text, source, idempotency_key? }` | `{ capture_id, items: CaptureItem[], questions }`. Nothing is saved until commit. |
| `POST /api/capture/commit` | `{ capture_id, raw_text, source, items: CommitItem[] }` | Result of `commit_capture()`. Idempotent per `client_id`. |
| `POST /api/ai/decompose-goal` | `{ goal_id, regenerate?, constraints? }` | 1–3 new steps stored as `suggested`. Duplicates and rejected titles are filtered out. Regeneration keeps user and edited actions. |
| `POST /api/ai/classify-accomplishments` | `{ text }` | Items with a suggested goal, `advances_goal`, and `matches_action_id` / `possible_duplicate_of` |
| `POST /api/ai/blockers` | `{ goal_id }` | Possible blockers, one smaller step, an optional question |
| `POST /api/ai/weekly-summary` | `{ week_start? }` | Facts computed in SQL, plus an AI summary built only from those facts |
| `POST /api/ai/transcribe` | multipart `file` | `{ text }` |

Errors return `{ error: code }` only, with no task content. Codes: `unauthenticated`, `invalid_token`, `invalid_input`, `body_too_large`, `rate_limited`, `daily_ai_budget_reached`, `ai_disabled`, `ai_not_configured`, `ai_unavailable`.

## AI operations and contracts

Each operation has its own prompt (`worker/src/prompts.ts`, versioned), a strict JSON schema (`worker/src/schemas.ts`) and a Zod validator (`app/src/core/ai-contracts.ts`):

`interpret_capture`, `decompose_goal`, `suggest_next_actions` (deterministic, with explanations), `classify_accomplishment` / `match_accomplishment_to_goal`, `identify_possible_blockers`, `generate_accountability_nudge`, `generate_progress_summary`.

Safeguards:
- Any ID the model returns that was not in the provided context is dropped.
- Goal suggestions are capped at 3.
- Consequential submissions (legal, financial, medical, official) must start with confirming the official requirements, and are flagged `requires_clarification`.
- Nudge text containing blame words is discarded and replaced by a fixed, neutral message.
- Invalid output is retried once, then fails as `ai_unavailable`, and the client falls back to manual flows.

## Recommendation engine

This is deterministic, so eligibility never depends on AI. Tests are in `app/src/core/__tests__`.

- **Excluded:** completed or dismissed actions; paused, waiting, blocked, snoozed, completed or archived goals; actions with unmet dependencies; actions the user marked "not a good fit" or dismissed in the last 7 days.
- **Time-Sensitive:** hard deadlines within 14 days, or target dates within 5. Wording is factual, e.g. "Renew insurance is due Friday. 2 steps left."
- **Meaningful Move:** goals with a user-stated meaning or an accountability flag. Scoring favors user-stated meaning (over AI-inferred), staleness, and steps small enough to start. Repeated skips lower the score.
- **Easy Momentum:** steps of 15 minutes or less, preferring a different goal.
- **Quietly Waiting:** meaningful goals with no progress for N days (configurable), excluding "don't remind me".
- **Daily modes** change emphasis only. Today's picks are fixed once per day. Finishing them shows a "Finished for now" state, and more appears only if the user asks.
