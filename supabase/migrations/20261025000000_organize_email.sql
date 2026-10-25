-- AI organization (projects + life areas) and email management.

-- ───────────────────────── Profile settings ─────────────────────────
alter table profiles
  add column auto_organize boolean not null default true,       -- file new captures into projects/areas automatically
  add column email_digest_enabled boolean not null default true;

-- capture_entries can now originate from an email.
alter table capture_entries drop constraint capture_entries_source_check;
alter table capture_entries add constraint capture_entries_source_check
  check (source in ('text','voice','brain_dump','accomplishment','goal','email'));

-- ───────────────────────── organize_runs ─────────────────────────
-- Every AI reorganization is recorded with the previous values so it can be undone.
create table organize_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger text not null default 'manual' check (trigger in ('manual','capture','email','scheduled')),
  created_goal_ids uuid[] not null default '{}',
  changes jsonb not null default '[]'::jsonb,  -- [{kind, id, title, from_goal_id, to_goal_id, from_area_id, to_area_id}]
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index organize_runs_user_idx on organize_runs(user_id, created_at desc);

-- Atomically apply an organization plan the user (or auto-organize) accepted.
-- p_new_projects: [{ref, title, life_area_id, icon}]   ref is a client/AI temporary key
-- p_assignments:  [{kind:'action'|'goal', id, goal_id?, goal_ref?, life_area_id?}]
create or replace function apply_organization(p_new_projects jsonb, p_assignments jsonb, p_trigger text default 'manual')
returns organize_runs language plpgsql security invoker as $$
declare
  np jsonb; asg jsonb; refs jsonb := '{}'::jsonb; gid uuid; created uuid[] := '{}';
  a actions; g goals; target_goal uuid; target_area uuid; changes jsonb := '[]'::jsonb; run organize_runs;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  for np in select * from jsonb_array_elements(coalesce(p_new_projects, '[]'::jsonb)) loop
    insert into goals (title, life_area_id, icon)
    values (np->>'title', nullif(np->>'life_area_id','')::uuid, coalesce(nullif(np->>'icon',''), 'target'))
    returning id into gid;
    refs := refs || jsonb_build_object(np->>'ref', gid);
    created := created || gid;
  end loop;

  for asg in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    target_goal := coalesce(nullif(asg->>'goal_id','')::uuid, nullif(refs->>(asg->>'goal_ref'),'')::uuid);
    target_area := nullif(asg->>'life_area_id','')::uuid;

    if asg->>'kind' = 'action' then
      select * into a from actions where id = (asg->>'id')::uuid and user_id = auth.uid() for update;
      if not found then continue; end if;
      update actions set
        goal_id = coalesce(target_goal, a.goal_id),
        -- an action inside a project inherits the project's area, so only loose actions keep their own
        life_area_id = case when coalesce(target_goal, a.goal_id) is null then coalesce(target_area, a.life_area_id) else null end
      where id = a.id;
      changes := changes || jsonb_build_object('kind','action','id',a.id,'title',a.title,
        'from_goal_id',a.goal_id,'to_goal_id',coalesce(target_goal, a.goal_id),
        'from_area_id',a.life_area_id,'to_area_id',coalesce(target_area, a.life_area_id));

    elsif asg->>'kind' = 'goal' then
      select * into g from goals where id = (asg->>'id')::uuid and user_id = auth.uid() for update;
      if not found or target_area is null then continue; end if;
      update goals set life_area_id = target_area where id = g.id;
      changes := changes || jsonb_build_object('kind','goal','id',g.id,'title',g.title,
        'from_area_id',g.life_area_id,'to_area_id',target_area);
    end if;
  end loop;

  -- New projects take the area most of their actions came from when the plan didn't name one.
  update goals ng set life_area_id = sub.area
  from (
    select (c->>'to_goal_id')::uuid as goal_id, (mode() within group (order by c->>'from_area_id'))::uuid as area
    from jsonb_array_elements(changes) c
    where c->>'kind' = 'action' and c->>'from_area_id' is not null
    group by 1
  ) sub
  where ng.id = sub.goal_id and ng.id = any(created) and ng.life_area_id is null;

  insert into organize_runs (trigger, created_goal_ids, changes)
  values (coalesce(p_trigger,'manual'), created, changes)
  returning * into run;
  return run;
end $$;

-- Restore the previous project/area of everything a run touched; remove projects it created if now empty.
create or replace function undo_organization(p_run_id uuid) returns void
language plpgsql security invoker as $$
declare run organize_runs; c jsonb;
begin
  select * into run from organize_runs where id = p_run_id and user_id = auth.uid() for update;
  if not found or run.undone_at is not null then return; end if;
  for c in select * from jsonb_array_elements(run.changes) loop
    if c->>'kind' = 'action' then
      update actions set goal_id = nullif(c->>'from_goal_id','')::uuid, life_area_id = nullif(c->>'from_area_id','')::uuid
      where id = (c->>'id')::uuid;
    else
      update goals set life_area_id = nullif(c->>'from_area_id','')::uuid where id = (c->>'id')::uuid;
    end if;
  end loop;
  delete from goals x where x.id = any(run.created_goal_ids)
    and not exists (select 1 from actions where goal_id = x.id)
    and not exists (select 1 from accomplishments where goal_id = x.id);
  update organize_runs set undone_at = now() where id = run.id;
end $$;

-- ───────────────────────── Email ─────────────────────────
create type email_provider as enum ('gmail','outlook','imap');

-- Non-secret account details. Users can read and edit these (e.g. default life area, digest on/off).
create table email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider email_provider not null,
  email_address text not null,
  display_name text,
  color text not null default '#47A9A6',
  life_area_id uuid references life_areas(id) on delete set null, -- default area for tasks from this inbox
  digest_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active','needs_reauth','error')),
  error_code text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email_address)
);

-- Secrets live in a separate table with RLS on and no policies: only the Worker (service role) can read them.
-- Tokens and passwords are AES-GCM encrypted by the Worker before they get here.
create table email_credentials (
  account_id uuid primary key references email_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  access_expires_at timestamptz,
  imap_host text,
  imap_port int,
  imap_username text,
  imap_password_enc text,
  imap_archive_folder text,
  sync_cursor text, -- provider-specific (Gmail historyId / Graph deltaLink / IMAP UID)
  updated_at timestamptz not null default now()
);

-- Message metadata and AI triage. Full bodies are never stored; only the provider snippet and AI summaries.
create table email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references email_accounts(id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  from_name text,
  from_address text,
  subject text,
  snippet text check (char_length(snippet) <= 1000),
  received_at timestamptz not null,
  is_unread boolean not null default true,
  is_archived boolean not null default false,
  labels text[] not null default '{}',
  -- AI triage
  category text check (category in ('action_needed','waiting_on','fyi','newsletter','receipt','personal','promotion','other')),
  importance smallint check (importance between 1 and 3),       -- 3 = needs attention
  summary text check (char_length(summary) <= 600),
  life_area_id uuid references life_areas(id) on delete set null,
  suggested_goal_id uuid references goals(id) on delete set null,
  suggested_actions jsonb not null default '[]'::jsonb,         -- [{title, estimated_minutes, deadline}]
  thread_summary text check (char_length(thread_summary) <= 2000),
  thread_next_steps jsonb not null default '[]'::jsonb,
  triaged_at timestamptz,
  status text not null default 'new' check (status in ('new','reviewed','tasks_created','dismissed')),
  created_at timestamptz not null default now(),
  unique (account_id, provider_message_id)
);
create index email_messages_user_time_idx on email_messages(user_id, received_at desc);
create index email_messages_untriaged_idx on email_messages(account_id) where triaged_at is null;

create table email_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  summary text not null,
  highlights jsonb not null default '[]'::jsonb,  -- [{message_id, text}]
  counts jsonb not null default '{}'::jsonb,       -- {total, action_needed, fyi, ...}
  created_at timestamptz not null default now(),
  unique (user_id, digest_date)
);

-- Tasks created from an email keep a link back to it.
alter table actions add column source_email_id uuid references email_messages(id) on delete set null;
alter table goals add column source_email_id uuid references email_messages(id) on delete set null;

create trigger email_accounts_updated before update on email_accounts for each row execute function set_updated_at();

do $$ declare t text; begin
  foreach t in array array['organize_runs','email_accounts','email_credentials','email_messages','email_digests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I alter column user_id set default auth.uid()', t);
  end loop;
  foreach t in array array['organize_runs','email_accounts','email_messages','email_digests'] loop
    execute format('create policy "own rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
-- email_credentials: intentionally no policies.

-- Users may change these account fields directly; provider/address/status are set by the Worker.
revoke update on email_accounts from authenticated;
grant update (display_name, color, life_area_id, digest_enabled) on email_accounts to authenticated;

-- ───────────────────────── commit_capture: email source + organize-friendly ─────────────────────────
-- Same contract as before; items may carry source_email_id, and goals created here keep their life area on actions.
create or replace function commit_capture(p_capture_id uuid, p_raw_text text, p_source text, p_items jsonb)
returns jsonb language plpgsql security invoker as $$
declare
  it jsonb;
  na jsonb;
  cid uuid;
  cap_id uuid := p_capture_id;
  new_goal_id uuid;
  new_id uuid;
  ord int;
  email_id uuid;
  results jsonb := '[]'::jsonb;
  existing jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if cap_id is null then
    insert into capture_entries (raw_text, source, status) values (p_raw_text, coalesce(p_source,'text'), 'committed')
    returning id into cap_id;
  else
    update capture_entries set status = 'committed', committed_at = now() where id = cap_id;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    cid := (it->>'client_id')::uuid;
    select result into existing from client_mutations where id = cid;
    if found then results := results || existing; continue; end if;
    email_id := nullif(it->>'source_email_id','')::uuid;

    if it->>'kind' = 'goal' then
      insert into goals (title, life_area_id, deadline, deadline_type, meaning, meaning_source, source_email_id)
      values (it->>'title', nullif(it->>'life_area_id','')::uuid, nullif(it->>'deadline','')::date,
              coalesce(nullif(it->>'deadline_type',''),'none')::deadline_type,
              nullif(it->>'meaning',''), case when nullif(it->>'meaning','') is null then 'none' else 'user' end, email_id)
      returning id into new_goal_id;
      ord := 0;
      for na in select * from jsonb_array_elements(coalesce(it->'next_actions','[]'::jsonb)) loop
        insert into actions (goal_id, title, estimated_minutes, origin, status, sort_order, source_email_id)
        values (new_goal_id, na->>'title', nullif(na->>'estimated_minutes','')::int, 'ai', 'ready', ord, email_id);
        ord := ord + 1;
      end loop;
      existing := jsonb_build_object('client_id', cid, 'kind', 'goal', 'id', new_goal_id);

    elsif it->>'kind' = 'action' then
      insert into actions (title, goal_id, life_area_id, estimated_minutes, origin, status, source_email_id)
      values (it->>'title', nullif(it->>'goal_id','')::uuid, nullif(it->>'life_area_id','')::uuid,
              nullif(it->>'estimated_minutes','')::int, 'user', 'ready', email_id)
      returning id into new_id;
      existing := jsonb_build_object('client_id', cid, 'kind', 'action', 'id', new_id);

    elsif it->>'kind' = 'accomplishment' then
      insert into accomplishments (title, goal_id, life_area_id, capture_id, planned, meaningful, occurred_at)
      values (it->>'title', nullif(it->>'goal_id','')::uuid, nullif(it->>'life_area_id','')::uuid, cap_id, false,
              coalesce((it->>'meaningful')::boolean, false) and nullif(it->>'goal_id','') is not null,
              coalesce(nullif(it->>'occurred_at','')::timestamptz, now()))
      returning id into new_id;
      existing := jsonb_build_object('client_id', cid, 'kind', 'accomplishment', 'id', new_id);

    else -- note
      if nullif(it->>'goal_id','') is not null then
        insert into goal_context (goal_id, kind, body) values ((it->>'goal_id')::uuid, 'note', it->>'title')
        returning id into new_id;
      end if;
      existing := jsonb_build_object('client_id', cid, 'kind', 'note', 'id', new_id);
    end if;

    if email_id is not null then
      update email_messages set status = 'tasks_created' where id = email_id;
    end if;

    insert into client_mutations (id, kind, result) values (cid, 'commit_capture', existing);
    results := results || existing;
  end loop;

  return jsonb_build_object('capture_id', cap_id, 'items', results);
end $$;

-- Export now includes email metadata the user owns (never credentials).
create or replace function export_my_data() returns jsonb language sql security invoker stable as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from profiles p where id = auth.uid()),
    'life_areas', coalesce((select jsonb_agg(x) from life_areas x), '[]'),
    'goals', coalesce((select jsonb_agg(x) from goals x), '[]'),
    'goal_context', coalesce((select jsonb_agg(x) from goal_context x), '[]'),
    'actions', coalesce((select jsonb_agg(x) from actions x), '[]'),
    'accomplishments', coalesce((select jsonb_agg(x) from accomplishments x), '[]'),
    'progress_events', coalesce((select jsonb_agg(x) from progress_events x), '[]'),
    'capture_entries', coalesce((select jsonb_agg(x) from capture_entries x), '[]'),
    'weekly_reflections', coalesce((select jsonb_agg(x) from weekly_reflections x), '[]'),
    'organize_runs', coalesce((select jsonb_agg(x) from organize_runs x), '[]'),
    'email_accounts', coalesce((select jsonb_agg(x) from email_accounts x), '[]'),
    'email_messages', coalesce((select jsonb_agg(x) from email_messages x), '[]'),
    'email_digests', coalesce((select jsonb_agg(x) from email_digests x), '[]')
  );
$$;
