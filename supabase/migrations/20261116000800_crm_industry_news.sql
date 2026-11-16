-- Oboya CRM 8/8: Industry News (Insights).
-- Config + fetched news items for the TrendRadar-inspired industry news module.
-- Everything is read/written with the user-scoped client: RLS decides visibility.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Permission matrix (mirrored by the app's BUILTIN_MATRIX). Same shape as the
-- core seed, with `industry_news` added for all four built-in roles.
-- ---------------------------------------------------------------------------
insert into public.crm_access_control (id, matrix)
values (true, $json$
{
  "super_admin": {
    "home": "full", "leads": "full", "accounts": "full", "contacts": "full",
    "opportunities": "full", "activities": "full", "industry_news": "full",
    "setup_users": "full", "setup_roles": "full", "setup_access": "full",
    "setup_companies": "full", "setup_pipeline": "full", "setup_picklists": "full",
    "setup_lead_assignment": "full", "audit_logs": "full"
  },
  "sales_manager": {
    "home": "full", "leads": "full", "accounts": "full", "contacts": "full",
    "opportunities": "full", "activities": "full", "audit_logs": ["view"],
    "industry_news": ["view", "create", "edit"],
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  },
  "sales_rep": {
    "home": ["view"],
    "leads": ["view", "create", "edit", "convert", "export"],
    "accounts": ["view", "create", "edit", "export"],
    "contacts": ["view", "create", "edit", "export"],
    "opportunities": ["view", "create", "edit", "export"],
    "activities": ["view", "create", "edit", "delete"],
    "industry_news": ["view"],
    "audit_logs": "none",
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  },
  "read_only": {
    "home": ["view"],
    "leads": ["view", "export"], "accounts": ["view", "export"],
    "contacts": ["view", "export"], "opportunities": ["view", "export"],
    "activities": ["view", "export"], "industry_news": ["view"],
    "audit_logs": "none",
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  }
}
$json$::jsonb)
on conflict (id) do update set matrix = excluded.matrix;

-- ---------------------------------------------------------------------------
-- Per-user monitoring configuration. The whole TrendRadar-style config
-- (keyword groups, industries, regions, sources, report settings) lives in
-- `config` as JSONB so the graphical editor can evolve without a schema change.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_industry_news_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.crm_users (id) on delete cascade,
  name text not null default 'Industry news',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);

create unique index if not exists crm_industry_news_configs_owner_uq
  on public.crm_industry_news_configs (owner_id) where deleted_at is null;

alter table public.crm_industry_news_configs enable row level security;

drop policy if exists crm_industry_news_configs_select on public.crm_industry_news_configs;
create policy crm_industry_news_configs_select on public.crm_industry_news_configs
  for select to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())));

drop policy if exists crm_industry_news_configs_insert on public.crm_industry_news_configs;
create policy crm_industry_news_configs_insert on public.crm_industry_news_configs
  for insert to authenticated
  with check ((select public.crm_can_write())
    and (select public.crm_has_permission('industry_news', 'create'))
    and owner_id = (select auth.uid()) and deleted_at is null);

drop policy if exists crm_industry_news_configs_update on public.crm_industry_news_configs;
create policy crm_industry_news_configs_update on public.crm_industry_news_configs
  for update to authenticated
  using (public.crm_can_see(owner_id) and deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('industry_news', 'edit')))
  with check (public.crm_can_see(owner_id) and deleted_at is null);

drop trigger if exists trg_crm_industry_news_configs_touch on public.crm_industry_news_configs;
create trigger trg_crm_industry_news_configs_touch
  before update on public.crm_industry_news_configs
  for each row execute function public.crm_touch_updated_at();

drop trigger if exists trg_crm_industry_news_configs_audit on public.crm_industry_news_configs;
create trigger trg_crm_industry_news_configs_audit
  after insert or update or delete on public.crm_industry_news_configs
  for each row execute function public.crm_audit_trigger('industry_news_config');

-- ---------------------------------------------------------------------------
-- Fetched articles. One row per (config, source, url); every ingest merges the
-- new rank into `ranks` / `rank_timeline` instead of creating a duplicate.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_industry_news_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.crm_users (id) on delete cascade,
  config_id uuid not null references public.crm_industry_news_configs (id) on delete cascade,
  news_date date not null default (now() at time zone 'UTC')::date,
  title text not null,
  url text not null,
  source_id text not null,
  source_name text not null,
  source_type text not null check (source_type in ('hotlist', 'rss')),
  rank integer not null default 0,
  ranks jsonb not null default '[]'::jsonb,
  rank_timeline jsonb not null default '[]'::jsonb,
  first_seen_at text,
  last_seen_at text,
  seen_count integer not null default 1,
  published_at timestamptz,
  summary text,
  author text,
  matched_keywords jsonb not null default '[]'::jsonb,
  industries text[] not null default '{}',
  regions text[] not null default '{}',
  is_new boolean not null default true,
  weight numeric(6, 2) not null default 0,
  fetched_at timestamptz not null default now(),
  created_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);

create unique index if not exists crm_industry_news_items_uq
  on public.crm_industry_news_items (config_id, source_id, url) where deleted_at is null;

create index if not exists crm_industry_news_items_industries_idx
  on public.crm_industry_news_items using gin (industries);
create index if not exists crm_industry_news_items_regions_idx
  on public.crm_industry_news_items using gin (regions);
create index if not exists crm_industry_news_items_date_idx
  on public.crm_industry_news_items (news_date desc);
create index if not exists crm_industry_news_items_weight_idx
  on public.crm_industry_news_items (weight desc);

alter table public.crm_industry_news_items enable row level security;

drop policy if exists crm_industry_news_items_select on public.crm_industry_news_items;
create policy crm_industry_news_items_select on public.crm_industry_news_items
  for select to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())));

drop policy if exists crm_industry_news_items_insert on public.crm_industry_news_items;
create policy crm_industry_news_items_insert on public.crm_industry_news_items
  for insert to authenticated
  with check ((select public.crm_can_write())
    and (select public.crm_has_permission('industry_news', 'edit'))
    and public.crm_can_see(owner_id) and deleted_at is null);

drop policy if exists crm_industry_news_items_update on public.crm_industry_news_items;
create policy crm_industry_news_items_update on public.crm_industry_news_items
  for update to authenticated
  using (public.crm_can_see(owner_id) and deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('industry_news', 'edit')))
  with check (public.crm_can_see(owner_id) and deleted_at is null);

drop trigger if exists trg_crm_industry_news_items_touch on public.crm_industry_news_items;
create trigger trg_crm_industry_news_items_touch
  before update on public.crm_industry_news_items
  for each row execute function public.crm_touch_updated_at();

grant select, insert, update on public.crm_industry_news_configs to authenticated;
grant select, insert, update on public.crm_industry_news_items to authenticated;

commit;
