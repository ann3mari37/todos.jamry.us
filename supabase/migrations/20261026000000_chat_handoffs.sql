-- Chat handoffs: an AI chat (Claude, ChatGPT…) connected through the MCP connector sends a plan, which waits as a
-- capture entry (source 'chat', status 'interpreted') until the user reviews it in the app. Plus onboarding progress.

alter table capture_entries drop constraint if exists capture_entries_source_check;
alter table capture_entries add constraint capture_entries_source_check
  check (source in ('text','voice','brain_dump','accomplishment','goal','email','chat'));

-- A handoff the user chose not to keep.
alter type capture_status add value if not exists 'dismissed';

create index if not exists capture_entries_pending_chat_idx on capture_entries(user_id, created_at desc)
  where source = 'chat' and status = 'interpreted';

-- Set when the welcome walkthrough is finished or skipped. Existing accounts count as onboarded.
alter table profiles add column if not exists onboarded_at timestamptz;
update profiles set onboarded_at = created_at where onboarded_at is null;
