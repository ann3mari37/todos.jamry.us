-- Atomically persist a user-confirmed capture review.
-- Idempotent per item via client_mutations(client_id): replays (offline queue, retries, double taps) are no-ops.

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

    if it->>'kind' = 'goal' then
      insert into goals (title, life_area_id, deadline, deadline_type, meaning, meaning_source)
      values (it->>'title', nullif(it->>'life_area_id','')::uuid, nullif(it->>'deadline','')::date,
              coalesce(nullif(it->>'deadline_type',''),'none')::deadline_type,
              nullif(it->>'meaning',''), case when nullif(it->>'meaning','') is null then 'none' else 'user' end)
      returning id into new_goal_id;
      ord := 0;
      for na in select * from jsonb_array_elements(coalesce(it->'next_actions','[]'::jsonb)) loop
        insert into actions (goal_id, title, estimated_minutes, origin, status, sort_order)
        values (new_goal_id, na->>'title', nullif(na->>'estimated_minutes','')::int, 'ai', 'ready', ord);
        ord := ord + 1;
      end loop;
      existing := jsonb_build_object('client_id', cid, 'kind', 'goal', 'id', new_goal_id);

    elsif it->>'kind' = 'action' then
      insert into actions (title, goal_id, life_area_id, estimated_minutes, origin, status)
      values (it->>'title', nullif(it->>'goal_id','')::uuid, nullif(it->>'life_area_id','')::uuid,
              nullif(it->>'estimated_minutes','')::int, 'user', 'ready')
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

    insert into client_mutations (id, kind, result) values (cid, 'commit_capture', existing);
    results := results || existing;
  end loop;

  return jsonb_build_object('capture_id', cap_id, 'items', results);
end $$;

-- Idempotent quick accomplishment ("Look What I Did") used by the offline queue.
create or replace function record_accomplishment(p_client_id uuid, p_title text, p_goal_id uuid default null,
  p_life_area_id uuid default null, p_occurred_at timestamptz default now(), p_meaningful boolean default false)
returns uuid language plpgsql security invoker as $$
declare existing jsonb; new_id uuid;
begin
  select result into existing from client_mutations where id = p_client_id;
  if found then return (existing->>'id')::uuid; end if;
  insert into accomplishments (title, goal_id, life_area_id, occurred_at, meaningful, planned)
  values (p_title, p_goal_id, p_life_area_id, coalesce(p_occurred_at, now()), p_meaningful and p_goal_id is not null, false)
  returning id into new_id;
  insert into client_mutations (id, kind, result) values (p_client_id, 'record_accomplishment', jsonb_build_object('id', new_id));
  return new_id;
end $$;

-- Export everything the user owns as JSON (user-controlled export).
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
    'weekly_reflections', coalesce((select jsonb_agg(x) from weekly_reflections x), '[]')
  );
$$;

-- Linking an accomplishment to a goal after the fact counts as progress on that goal.
create or replace function accomplishment_relinked() returns trigger
language plpgsql security invoker as $$
declare gt text;
begin
  if new.goal_id is not null and new.meaningful
     and (new.goal_id is distinct from old.goal_id or not old.meaningful) then
    select title into gt from goals where id = new.goal_id;
    update goals set last_meaningful_progress_at = greatest(coalesce(last_meaningful_progress_at, new.occurred_at), new.occurred_at)
      where id = new.goal_id;
    insert into progress_events (user_id, type, goal_id, accomplishment_id, goal_title, occurred_at)
    values (new.user_id, 'goal_advanced', new.goal_id, new.id, gt, new.occurred_at);
  end if;
  if old.goal_id is not null and new.goal_id is distinct from old.goal_id then
    delete from progress_events where accomplishment_id = new.id and goal_id = old.goal_id and type = 'goal_advanced';
  end if;
  return new;
end $$;
create trigger accomplishment_relinked after update on accomplishments
  for each row execute function accomplishment_relinked();
