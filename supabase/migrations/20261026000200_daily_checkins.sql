-- "Start my day" / "End my day": one row per person per calendar day (their local date), shared across devices.

create table daily_checkins (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  started_at timestamptz,
  ended_at timestamptz,
  -- Start: how much room the day has (minutes) and how the person feels.
  room_minutes int check (room_minutes between 0 and 720),
  energy text check (energy in ('low','okay','high')),
  -- End: the task picked to start tomorrow with, and a short note.
  tomorrow_first_action_id uuid references actions(id) on delete set null,
  note text check (char_length(note) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table daily_checkins enable row level security;
create policy "own rows" on daily_checkins for all using (user_id = auth.uid()) with check (user_id = auth.uid());
