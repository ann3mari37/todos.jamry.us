-- Tasks can carry their own due date (not only projects), and each life area can have its own filing keywords.

alter table actions
  add column due_date date,
  add column deadline_type deadline_type not null default 'none',
  add constraint action_deadline_consistency check ((due_date is null) = (deadline_type = 'none'));
create index actions_due_idx on actions(user_id, due_date) where due_date is not null;

-- Extra words that file a task into this area ("crm", "Malinda", "church"...), on top of the built-in hints.
alter table life_areas add column keywords text[] not null default '{}';

-- commit_capture: actions now keep the date parsed from what was typed.
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
  due date;
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
    due := nullif(it->>'deadline','')::date;

    if it->>'kind' = 'goal' then
      insert into goals (title, life_area_id, deadline, deadline_type, meaning, meaning_source, source_email_id)
      values (it->>'title', nullif(it->>'life_area_id','')::uuid, due,
              case when due is null then 'none' else coalesce(nullif(it->>'deadline_type','none'),'target') end::deadline_type,
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
      insert into actions (title, goal_id, life_area_id, estimated_minutes, origin, status, source_email_id, due_date, deadline_type)
      values (it->>'title', nullif(it->>'goal_id','')::uuid, nullif(it->>'life_area_id','')::uuid,
              nullif(it->>'estimated_minutes','')::int, 'user', 'ready', email_id, due,
              case when due is null then 'none' else coalesce(nullif(it->>'deadline_type','none'),'target') end::deadline_type)
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
