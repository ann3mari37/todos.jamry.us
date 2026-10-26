-- A task added to a project without an explicit place joins the end of its steps. Before this, tasks added later (by
-- the chat connector, or moved into a project by auto-organize) kept sort_order 0 and sorted among the first steps.
create or replace function actions_append_to_project() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.goal_id is null then return new; end if;
  if tg_op = 'INSERT' and new.sort_order <> 0 then return new; end if;
  if tg_op = 'UPDATE' and (new.goal_id is not distinct from old.goal_id or new.sort_order is distinct from old.sort_order) then
    return new;
  end if;
  select coalesce(max(sort_order) + 1, 0) into new.sort_order
  from actions where goal_id = new.goal_id and id is distinct from new.id;
  return new;
end $$;

drop trigger if exists actions_append_to_project on actions;
create trigger actions_append_to_project
  before insert or update of goal_id on actions
  for each row execute function actions_append_to_project();
