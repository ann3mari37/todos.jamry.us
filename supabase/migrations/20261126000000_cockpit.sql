-- The MaLinda Perry cockpit (admin.malindaperryconsulting.com): one dashboard for two businesses,
-- MaLinda Perry Consulting ('mpc') and Happy Girls Don't Do That ('hg').

-- Which business each source belongs to, and whether the cockpit shows it.
--   kind 'calendar' ref = '<email_account_id>:<google calendar id>'
--   kind 'mailbox'  ref = email_accounts.id
--   kind 'area'     ref = life_areas.id   (tasks in that life area count for that business)
create table cockpit_sources (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('calendar', 'mailbox', 'area')),
  ref text not null check (char_length(ref) between 1 and 400),
  company text not null default 'both' check (company in ('mpc', 'hg', 'both')),
  shown boolean not null default true,
  label text check (char_length(label) <= 80),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

-- Payhip stores. The webhook address carries a secret; only its hash is stored.
create table payhip_stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  company text not null default 'both' check (company in ('mpc', 'hg', 'both')),
  hook_token_hash text not null unique,
  signature_check text, -- SHA-256 of the store's Payhip API key, when given
  created_at timestamptz not null default now()
);

-- One row per Payhip sale. Written only by the Worker (service role); nothing about the buyer is kept.
create table payhip_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references payhip_stores(id) on delete cascade,
  payhip_id text not null,
  amount numeric(12, 2) not null default 0,
  currency text,
  items text[] not null default '{}',
  sold_at timestamptz not null default now(),
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (store_id, payhip_id)
);
create index payhip_sales_user_sold on payhip_sales (user_id, sold_at desc);

alter table cockpit_sources enable row level security;
alter table payhip_stores enable row level security;
alter table payhip_sales enable row level security;

create policy "own rows" on cockpit_sources for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Stores are added through the Worker (it makes the secret); the owner can see, rename and delete them.
create policy "own stores read" on payhip_stores for select using (user_id = auth.uid());
create policy "own stores insert" on payhip_stores for insert with check (user_id = auth.uid());
create policy "own stores update" on payhip_stores for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own stores delete" on payhip_stores for delete using (user_id = auth.uid());
-- The hash columns aren't secret on their own, but the cockpit has no need to read them.
revoke select on payhip_stores from anon, authenticated;
grant select (id, user_id, name, company, created_at) on payhip_stores to authenticated;
revoke update on payhip_stores from anon, authenticated;
grant update (name, company) on payhip_stores to authenticated;
create policy "own sales read" on payhip_sales for select using (user_id = auth.uid());

-- The cockpit updates its sales line the moment a sale arrives.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table payhip_sales;
  end if;
end $$;
