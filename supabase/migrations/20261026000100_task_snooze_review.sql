-- Tasks can be snoozed ("not now, remind me in two weeks") and remember when they were last looked at in a tidy-up,
-- which restarts their "sitting a while" clock.

alter table actions
  add column if not exists snoozed_until date,
  add column if not exists reviewed_at timestamptz;
