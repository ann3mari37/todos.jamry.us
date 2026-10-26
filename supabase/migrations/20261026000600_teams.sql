-- Teams: a shared workspace. People join by invite link; each member holds one or more job roles (Coach, Developer…).
-- A project can belong to a team: every member sees it and its steps, and each step can be assigned to a person or,
-- until someone takes it, to a role. Everything personal (life areas, history, check-ins, email) stays private.

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on team_members(user_id);

create table team_roles (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 300),
  created_at timestamptz not null default now()
);
create unique index team_roles_name_idx on team_roles(team_id, lower(name));

create table team_member_roles (
  team_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references team_roles(id) on delete cascade,
  primary key (user_id, role_id),
  foreign key (team_id, user_id) references team_members(team_id, user_id) on delete cascade
);

create table team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  code text not null unique default encode(gen_random_bytes(12), 'hex'),
  name text check (char_length(name) <= 80),
  role_id uuid references team_roles(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

alter table goals add column team_id uuid references teams(id) on delete set null;
create index goals_team_idx on goals(team_id) where team_id is not null;
alter table actions
  add column assignee_id uuid references auth.users(id) on delete set null,
  add column assigned_role_id uuid references team_roles(id) on delete set null,
  -- Completion is shared on team projects: everyone sees the step done, and by whom.
  add column completed_by uuid references auth.users(id) on delete set null;
create index actions_assignee_idx on actions(assignee_id) where assignee_id is not null;

-- ───────────────────────── access helpers (definer: they read membership without tripping RLS recursion)
create or replace function is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid());
$$;

create or replace function is_team_admin(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and is_admin);
$$;

-- True when the goal belongs to a team the current person is in.
create or replace function can_access_goal(p_goal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from goals g join team_members m on m.team_id = g.team_id
    where g.id = p_goal and m.user_id = auth.uid()
  );
$$;

-- ───────────────────────── row level security
alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_roles enable row level security;
alter table team_member_roles enable row level security;
alter table team_invites enable row level security;

create policy "members read" on teams for select using (is_team_member(id));
create policy "admins change" on teams for update using (is_team_admin(id)) with check (is_team_admin(id));
create policy "admins delete" on teams for delete using (is_team_admin(id));

create policy "members read" on team_members for select using (is_team_member(team_id));
create policy "admins or self change" on team_members for update
  using (is_team_admin(team_id) or user_id = auth.uid()) with check (is_team_admin(team_id) or (user_id = auth.uid() and not is_admin));
create policy "admins or self leave" on team_members for delete using (is_team_admin(team_id) or user_id = auth.uid());
-- Only the name and admin flag change in place (never which team or person a membership is for).
revoke update on team_members from authenticated;
grant update (display_name, is_admin) on team_members to authenticated;

create policy "members read" on team_roles for select using (is_team_member(team_id));
create policy "admins manage" on team_roles for all using (is_team_admin(team_id)) with check (is_team_admin(team_id));

create policy "members read" on team_member_roles for select using (is_team_member(team_id));
create policy "admins manage" on team_member_roles for all using (is_team_admin(team_id)) with check (is_team_admin(team_id));

create policy "admins manage" on team_invites for all using (is_team_admin(team_id)) with check (is_team_admin(team_id));

-- Team projects and their steps and notes: every member reads and works on them (on top of "own rows").
-- (Deleting a team project stays with its owner, through "own rows".)
create policy "team goals read" on goals for select using (team_id is not null and is_team_member(team_id));
create policy "team goals change" on goals for update
  using (team_id is not null and is_team_member(team_id)) with check (team_id is not null and is_team_member(team_id));
create policy "team tasks" on actions for all
  using (goal_id is not null and can_access_goal(goal_id)) with check (goal_id is not null and can_access_goal(goal_id));
create policy "team notes" on goal_context for all
  using (can_access_goal(goal_id)) with check (can_access_goal(goal_id));

-- ───────────────────────── consistency: teams, assignees and roles must line up
create or replace function goals_team_check() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.team_id is not null and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id) and not is_team_member(new.team_id) then
    raise exception 'not a member of that team';
  end if;
  return new;
end $$;
create trigger goals_team_check before insert or update of team_id on goals
  for each row execute function goals_team_check();

create or replace function actions_assignment_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if new.assignee_id is null and new.assigned_role_id is null then return new; end if;
  select team_id into t from goals where id = new.goal_id;
  if t is null then
    -- Personal tasks can only be "mine".
    new.assigned_role_id := null;
    if new.assignee_id is distinct from new.user_id then new.assignee_id := null; end if;
    return new;
  end if;
  if new.assignee_id is not null and not exists (select 1 from team_members where team_id = t and user_id = new.assignee_id) then
    raise exception 'assignee is not on this team';
  end if;
  if new.assigned_role_id is not null and not exists (select 1 from team_roles where id = new.assigned_role_id and team_id = t) then
    raise exception 'role is not on this team';
  end if;
  return new;
end $$;
create trigger actions_assignment_check before insert or update of assignee_id, assigned_role_id, goal_id on actions
  for each row execute function actions_assignment_check();

-- Goal events belong to the goal's owner, also when a teammate changes it.
alter function goal_state_event() security definer set search_path = public;

-- ───────────────────────── team actions
create or replace function create_team(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into teams (name, created_by) values (trim(p_name), auth.uid()) returning id into t;
  insert into team_members (team_id, user_id, display_name, is_admin) values (t, auth.uid(), trim(p_display_name), true);
  return t;
end $$;

-- What an invite link is for, shown before joining (the code is the secret).
create or replace function invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team', t.name, 'role', r.name, 'name', i.name,
    'invited_by', (select display_name from team_members where team_id = i.team_id and user_id = i.created_by),
    'valid', i.accepted_at is null and i.expires_at > now(),
    'already_member', exists (select 1 from team_members where team_id = i.team_id and user_id = auth.uid()))
  from team_invites i join teams t on t.id = i.team_id left join team_roles r on r.id = i.role_id
  where i.code = p_code;
$$;

create or replace function accept_invite(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i team_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into i from team_invites where code = p_code for update;
  if not found then raise exception 'invite not found'; end if;
  if exists (select 1 from team_members where team_id = i.team_id and user_id = auth.uid()) then return i.team_id; end if;
  if i.accepted_at is not null or i.expires_at <= now() then raise exception 'invite expired'; end if;
  insert into team_members (team_id, user_id, display_name) values (i.team_id, auth.uid(), trim(coalesce(nullif(p_display_name, ''), i.name, 'Teammate')));
  if i.role_id is not null then
    insert into team_member_roles (team_id, user_id, role_id) values (i.team_id, auth.uid(), i.role_id) on conflict do nothing;
  end if;
  update team_invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.team_id;
end $$;

-- Completing and un-completing work on team steps: the step is done for everyone, and the accomplishment goes into
-- the history of whoever did it (each person's history, rings and suggestions stay their own).
create or replace function complete_action(p_action_id uuid, p_occurred_at timestamptz default now())
returns accomplishments language plpgsql security invoker as $$
declare a actions; g goals; acc accomplishments;
begin
  select * into a from actions where id = p_action_id
    and (user_id = auth.uid() or (goal_id is not null and can_access_goal(goal_id))) for update;
  if not found then raise exception 'action not found'; end if;

  select * into acc from accomplishments where action_id = a.id and user_id = auth.uid();
  if found then return acc; end if; -- idempotent

  update actions set status = 'completed', completed_at = p_occurred_at, completed_by = auth.uid() where id = a.id;

  if a.goal_id is not null then select * into g from goals where id = a.goal_id; end if;

  insert into accomplishments (user_id, title, goal_id, action_id, life_area_id, planned, meaningful, occurred_at)
  values (auth.uid(), a.title, a.goal_id, a.id, case when a.user_id = auth.uid() then coalesce(a.life_area_id, g.life_area_id) end,
          true, a.goal_id is not null, p_occurred_at)
  returning * into acc;

  insert into progress_events (user_id, type, goal_id, action_id, accomplishment_id, goal_title, occurred_at)
  values (auth.uid(), 'action_completed', a.goal_id, a.id, acc.id, g.title, p_occurred_at);

  if a.goal_id is not null then
    update goals set last_meaningful_progress_at = greatest(coalesce(last_meaningful_progress_at, p_occurred_at), p_occurred_at)
      where id = a.goal_id;
    insert into progress_events (user_id, type, goal_id, action_id, goal_title, occurred_at)
    values (auth.uid(), 'goal_advanced', a.goal_id, a.id, g.title, p_occurred_at);
  end if;
  return acc;
end $$;

create or replace function uncomplete_action(p_action_id uuid) returns void
language plpgsql security invoker as $$
begin
  update actions set status = 'ready', completed_at = null, completed_by = null
    where id = p_action_id and (user_id = auth.uid() or (goal_id is not null and can_access_goal(goal_id)));
  delete from progress_events where action_id = p_action_id and type in ('action_completed','goal_advanced') and user_id = auth.uid();
  delete from accomplishments where action_id = p_action_id and user_id = auth.uid();
end $$;
