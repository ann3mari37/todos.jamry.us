-- Open any email in its own mail app, and inbox briefings written by rules, Momentum's AI, or the person's own AI chat.

alter table email_messages
  add column if not exists web_link text check (char_length(web_link) <= 2000),          -- Gmail/Outlook web link to this message
  add column if not exists message_id_header text check (char_length(message_id_header) <= 500); -- RFC Message-ID, for Mail apps and search

alter table email_digests
  add column if not exists source text not null default 'rules' check (source in ('rules','ai','chat')),
  add column if not exists author text check (char_length(author) <= 100),                 -- e.g. the AI app that wrote it
  add column if not exists do_first jsonb not null default '[]'::jsonb,                     -- [{message_id, why}] in order
  add column if not exists updated_at timestamptz not null default now();

-- Today's plan (cards, skips, finished, day settings) syncs across devices instead of living in each browser.
alter table daily_checkins add column if not exists plan jsonb;
