-- Momentum: initial schema
-- Every user-owned table carries user_id and is protected by Row Level Security.

create extension if not exists "pgcrypto";

-- ───────────────────────── Enumerations ─────────────────────────
create type goal_status as enum ('active','waiting','blocked','paused','completed','archived');
create type action_status as enum ('suggested','ready','in_progress','waiting','blocked','completed','dismissed');
create type recommendation_status as enum ('active','accepted','dismissed','deferred','expired');
create type deadline_type as enum ('none','target','hard');
create type action_origin as enum ('user','ai');
create type recommendation_kind as enum ('meaningful_move','time_sensitive','easy_momentum','quietly_waiting');
create type capture_status as enum ('pending','interpreted','committed','failed','manual');
create type accountability_mode as enum ('default','keep_visible','help_me','i_avoid_this','do_not_remind');
create type progress_event_type as enum (
  'action_completed','goal_advanced','accomplishment_recorded','goal_completed',
  'goal_paused','blocker_resolved','deadline_updated','goal_archived','goal_created','goal_reactivated'
);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────────────────────── profiles ─────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  preferred_action_minutes int not null default 15 check (preferred_action_minutes between 1 and 240),
  tone text not null default 'warm' check (tone in ('warm','neutral','brief')),
  ai_enabled boolean not null default true,
  ai_disclosure_accepted_at timestamptz,
  weekly_reflection_enabled boolean not null default true,
  daily_mode text check (daily_mode in ('meaningful','small_tasks','off_my_mind','show_all')),
  daily_mode_date date,
  learned_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── life_areas ─────────────────────────
create table life_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#9CA3AF',
  icon text not null default 'circle',
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index life_areas_user_idx on life_areas(user_id) where archived_at is null;

-- ───────────────────────── goals ─────────────────────────
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  life_area_id uuid references life_areas(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  meaning text,                         -- "Why does this matter to you?"
  meaning_source text not null default 'none' check (meaning_source in ('none','user','ai_suggested')),
  deadline date,
  deadline_type deadline_type not null default 'none',
  status goal_status not null default 'active',
  completion_criteria text,
  icon text not null default 'target',
  accountability accountability_mode not null default 'default',
  snoozed_until timestamptz,
  last_meaningful_progress_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deadline_consistency check ((deadline is null) = (deadline_type = 'none'))
);
create index goals_user_status_idx on goals(user_id, status);

-- ───────────────────────── goal_context ─────────────────────────
create table goal_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references goals(id) on delete cascade,
  kind text not null check (kind in ('note','constraint','instruction','blocker','question','answer')),
  body text not null check (char_length(body) <= 4000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index goal_context_goal_idx on goal_context(goal_id);

-- ───────────────────────── actions ─────────────────────────
create table actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references goals(id) on delete set null,
  life_area_id uuid references life_areas(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  completion_criteria text,
  estimated_minutes int check (estimated_minutes between 1 and 600),
  status action_status not null default 'ready',
  origin action_origin not null default 'user',
  requires_clarification boolean not null default false,
  user_edited boolean not null default false,
  sort_order int not null default 0,
  times_recommended int not null default 0,
  times_skipped int not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index actions_user_status_idx on actions(user_id, status);
create index actions_goal_idx on actions(goal_id);

create table action_dependencies (
  action_id uuid not null references actions(id) on delete cascade,
  depends_on_id uuid not null references actions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (action_id, depends_on_id),
  check (action_id <> depends_on_id)
);

-- ───────────────────────── capture_entries ─────────────────────────
create table capture_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_text text not null check (char_length(raw_text) <= 8000),
  source text not null default 'text' check (source in ('text','voice','brain_dump','accomplishment','goal')),
  status capture_status not null default 'pending',
  interpretation jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);
create index capture_entries_user_idx on capture_entries(user_id, created_at desc);

-- ───────────────────────── accomplishments ─────────────────────────
create table accomplishments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  notes text,
  goal_id uuid references goals(id) on delete set null,
  action_id uuid references actions(id) on delete set null,
  life_area_id uuid references life_areas(id) on delete set null,
  capture_id uuid references capture_entries(id) on delete set null,
  planned boolean not null default false,          -- came from an existing action
  meaningful boolean not null default false,       -- advanced a goal
  occurred_at timestamptz not null default now(),  -- when it happened
  created_at timestamptz not null default now(),   -- when it was entered
  updated_at timestamptz not null default now()
);
create index accomplishments_user_time_idx on accomplishments(user_id, occurred_at desc);
create index accomplishments_goal_idx on accomplishments(goal_id);
-- one accomplishment per completed action (avoids double counting)
create unique index accomplishments_action_unique on accomplishments(action_id) where action_id is not null;

-- ───────────────────────── progress_events ─────────────────────────
-- Durable log. goal_id is intentionally not a cascading FK target so history survives reorganisation.
create table progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type progress_event_type not null,
  goal_id uuid references goals(id) on delete set null,
  action_id uuid references actions(id) on delete set null,
  accomplishment_id uuid references accomplishments(id) on delete cascade, -- deleting a mistaken record removes its events
  goal_title text,     -- snapshot so history reads correctly after renames/deletes
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index progress_events_user_time_idx on progress_events(user_id, occurred_at desc);
create index progress_events_goal_idx on progress_events(goal_id, occurred_at desc);

-- ───────────────────────── recommendations ─────────────────────────
create table recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid references actions(id) on delete cascade,
  goal_id uuid references goals(id) on delete cascade,
  kind recommendation_kind not null,
  reason text not null,
  status recommendation_status not null default 'active',
  for_date date not null default current_date,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recommendations_user_date_idx on recommendations(user_id, for_date);

create table recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  action_id uuid references actions(id) on delete set null,
  goal_id uuid references goals(id) on delete set null,
  response text not null check (response in ('accepted','dismissed','deferred','not_suitable','show_other')),
  created_at timestamptz not null default now()
);
create index recommendation_feedback_user_idx on recommendation_feedback(user_id, created_at desc);

-- ───────────────────────── accountability / nudges ─────────────────────────
create table accountability_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  inactivity_days int not null default 10 check (inactivity_days between 2 and 90),
  max_nudges_per_week int not null default 2 check (max_nudges_per_week between 0 and 14),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references goals(id) on delete cascade,
  message text not null,
  response text check (response in ('smaller_step','identify_blocker','waiting','pause','not_important','remind_later','dismiss')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index nudges_user_idx on nudges(user_id, created_at desc);

create table notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deadlines boolean not null default true,
  meaningful_reminders boolean not null default false,
  waiting_followups boolean not null default false,
  weekly_reflection boolean not null default false,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  max_per_day int not null default 2 check (max_per_day between 0 and 10),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── ai_operations ─────────────────────────
-- Metadata only. Prompts/responses containing personal content are NOT stored here.
create table ai_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  model text,
  prompt_version text,
  status text not null check (status in ('ok','invalid_output','error','timeout','rate_limited','disabled')),
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  latency_ms int,
  error_code text,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create index ai_operations_user_time_idx on ai_operations(user_id, created_at desc);
create unique index ai_operations_idem on ai_operations(user_id, operation, idempotency_key) where idempotency_key is not null;

create table weekly_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  facts jsonb not null,
  summary text,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- Idempotency of client writes (offline queue replays, double taps).
create table client_mutations (
  id uuid primary key,          -- client-generated
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  result jsonb,
  created_at timestamptz not null default now()
);

-- ───────────────────────── updated_at triggers ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['profiles','life_areas','goals','actions','accomplishments','recommendations'] loop
    execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ───────────────────────── Row Level Security ─────────────────────────
alter table profiles enable row level security;
create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());

do $$ declare t text; begin
  foreach t in array array[
    'life_areas','goals','goal_context','actions','action_dependencies','capture_entries','accomplishments',
    'progress_events','recommendations','recommendation_feedback','accountability_preferences','nudges',
    'notification_preferences','ai_operations','weekly_reflections','client_mutations'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I alter column user_id set default auth.uid()', t);
    execute format('create policy "own rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ai_operations is written by the Worker only; users may read their own.
drop policy "own rows" on ai_operations;
create policy "read own ai ops" on ai_operations for select using (user_id = auth.uid());

-- ───────────────────────── New user bootstrap ─────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name) values (new.id, split_part(new.email, '@', 1));
  insert into life_areas (user_id, name, color, icon, sort_order) values
    (new.id, 'Home',            '#F07A8C', 'home',     0),
    (new.id, 'Work',            '#3FA7A3', 'briefcase',1),
    (new.id, 'Health',          '#7DB46C', 'leaf',     2),
    (new.id, 'Finances',        '#F2B84B', 'wallet',   3),
    (new.id, 'Relationships',   '#F59A6B', 'heart',    4),
    (new.id, 'Personal Growth', '#A98BDB', 'sparkle',  5),
    (new.id, 'Other',           '#9CA3AF', 'circle',   6);
  insert into accountability_preferences (user_id) values (new.id);
  insert into notification_preferences (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ───────────────────────── Progress bookkeeping ─────────────────────────
-- Completing an action: record an accomplishment + progress events, bump the goal.
create or replace function complete_action(p_action_id uuid, p_occurred_at timestamptz default now())
returns accomplishments language plpgsql security invoker as $$
declare a actions; g goals; acc accomplishments;
begin
  select * into a from actions where id = p_action_id and user_id = auth.uid() for update;
  if not found then raise exception 'action not found'; end if;

  select * into acc from accomplishments where action_id = a.id;
  if found then return acc; end if; -- idempotent

  update actions set status = 'completed', completed_at = p_occurred_at where id = a.id;

  if a.goal_id is not null then select * into g from goals where id = a.goal_id; end if;

  insert into accomplishments (user_id, title, goal_id, action_id, life_area_id, planned, meaningful, occurred_at)
  values (a.user_id, a.title, a.goal_id, a.id, coalesce(a.life_area_id, g.life_area_id), true, a.goal_id is not null, p_occurred_at)
  returning * into acc;

  insert into progress_events (user_id, type, goal_id, action_id, accomplishment_id, goal_title, occurred_at)
  values (a.user_id, 'action_completed', a.goal_id, a.id, acc.id, g.title, p_occurred_at);

  if a.goal_id is not null then
    update goals set last_meaningful_progress_at = greatest(coalesce(last_meaningful_progress_at, p_occurred_at), p_occurred_at)
      where id = a.goal_id;
    insert into progress_events (user_id, type, goal_id, action_id, goal_title, occurred_at)
    values (a.user_id, 'goal_advanced', a.goal_id, a.id, g.title, p_occurred_at);
  end if;
  return acc;
end $$;

-- Undo a completion (correction). History of the completion is removed only for this action.
create or replace function uncomplete_action(p_action_id uuid) returns void
language plpgsql security invoker as $$
begin
  update actions set status = 'ready', completed_at = null where id = p_action_id and user_id = auth.uid();
  delete from progress_events where action_id = p_action_id and type in ('action_completed','goal_advanced') and user_id = auth.uid();
  delete from accomplishments where action_id = p_action_id and user_id = auth.uid();
end $$;

-- Recording an accomplishment directly (unplanned / retroactive).
create or replace function record_accomplishment_event() returns trigger
language plpgsql security invoker as $$
declare gt text;
begin
  if new.action_id is not null then return new; end if; -- handled by complete_action
  if new.goal_id is not null then
    select title into gt from goals where id = new.goal_id;
    update goals set last_meaningful_progress_at = greatest(coalesce(last_meaningful_progress_at, new.occurred_at), new.occurred_at)
      where id = new.goal_id and new.meaningful;
  end if;
  insert into progress_events (user_id, type, goal_id, accomplishment_id, goal_title, occurred_at)
  values (new.user_id, 'accomplishment_recorded', new.goal_id, new.id, gt, new.occurred_at);
  if new.goal_id is not null and new.meaningful then
    insert into progress_events (user_id, type, goal_id, accomplishment_id, goal_title, occurred_at)
    values (new.user_id, 'goal_advanced', new.goal_id, new.id, gt, new.occurred_at);
  end if;
  return new;
end $$;
create trigger accomplishment_recorded after insert on accomplishments
  for each row execute function record_accomplishment_event();

-- Goal state changes are logged.
create or replace function goal_state_event() returns trigger
language plpgsql security invoker as $$
begin
  if tg_op = 'INSERT' then
    insert into progress_events (user_id, type, goal_id, goal_title) values (new.user_id, 'goal_created', new.id, new.title);
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
      insert into progress_events (user_id, type, goal_id, goal_title) values (new.user_id, 'goal_completed', new.id, new.title);
    elsif new.status = 'paused' then
      insert into progress_events (user_id, type, goal_id, goal_title) values (new.user_id, 'goal_paused', new.id, new.title);
    elsif new.status = 'archived' then
      new.archived_at := coalesce(new.archived_at, now());
      insert into progress_events (user_id, type, goal_id, goal_title) values (new.user_id, 'goal_archived', new.id, new.title);
    elsif new.status = 'active' then
      if old.status = 'blocked' then
        insert into progress_events (user_id, type, goal_id, goal_title) values (new.user_id, 'blocker_resolved', new.id, new.title);
      else
        insert into progress_events (user_id, type, goal_id, goal_title) values (new.user_id, 'goal_reactivated', new.id, new.title);
      end if;
    end if;
  end if;
  if new.deadline is distinct from old.deadline or new.deadline_type is distinct from old.deadline_type then
    insert into progress_events (user_id, type, goal_id, goal_title, detail)
    values (new.user_id, 'deadline_updated', new.id, new.title,
      jsonb_build_object('from', old.deadline, 'to', new.deadline, 'type', new.deadline_type));
  end if;
  return new;
end $$;
create trigger goal_created after insert on goals for each row execute function goal_state_event();
create trigger goal_changed before update on goals for each row execute function goal_state_event();
