-- Oboya CRM 2/6: picklists, pipelines + stages (D6 guard), group companies (D5).
-- Depends on 20261116000100_crm_core.sql. Idempotent.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Picklist values
-- ---------------------------------------------------------------------------
create table if not exists public.crm_picklist_values (
  id uuid primary key default gen_random_uuid(),
  picklist text not null check (picklist ~ '^[a-z][a-z0-9_]{1,39}$'),
  value text not null check (value ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  label text not null check (length(trim(label)) between 1 and 120),
  sort_order integer not null default 100,
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (picklist, value)
);
alter table public.crm_picklist_values enable row level security;

drop trigger if exists trg_crm_picklist_values_touch on public.crm_picklist_values;
create trigger trg_crm_picklist_values_touch
before update on public.crm_picklist_values
for each row execute function public.crm_touch_updated_at();

insert into public.crm_picklist_values (picklist, value, label, sort_order)
values
  -- lead_source
  ('lead_source', 'website_contact', 'Website contact form', 10),
  ('lead_source', 'website_rfq',     'Website RFQ',          20),
  ('lead_source', 'trade_show',      'Trade show',           30),
  ('lead_source', 'referral',        'Referral',             40),
  ('lead_source', 'cold_outreach',   'Cold outreach',        50),
  ('lead_source', 'partner',         'Partner',              60),
  ('lead_source', 'other',           'Other',                90),
  -- segment
  ('segment', 'greenhouse_grower', 'Greenhouse grower',    10),
  ('segment', 'open_field_grower', 'Open-field grower',    20),
  ('segment', 'nursery',           'Nursery / propagator', 30),
  ('segment', 'floriculture',      'Floriculture',         40),
  ('segment', 'distributor',       'Distributor',          50),
  ('segment', 'retail',            'Retail / garden centre', 60),
  ('segment', 'recycling',         'Recycling',            70),
  ('segment', 'other',             'Other',                90),
  -- industry
  ('industry', 'horticulture',     'Horticulture',          10),
  ('industry', 'fruit_vegetables', 'Fruit and vegetables',  20),
  ('industry', 'flowers_plants',   'Flowers and plants',    30),
  ('industry', 'agriculture',      'Agriculture',           40),
  ('industry', 'agri_inputs',      'Agricultural inputs',   50),
  ('industry', 'packaging',        'Packaging',             60),
  ('industry', 'recycling',        'Recycling',             70),
  ('industry', 'other',            'Other',                 90),
  -- loss_reason
  ('loss_reason', 'price',       'Price',               10),
  ('loss_reason', 'competitor',  'Lost to competitor',  20),
  ('loss_reason', 'no_budget',   'No budget',           30),
  ('loss_reason', 'timing',      'Timing',              40),
  ('loss_reason', 'no_response', 'No response',         50),
  ('loss_reason', 'product_fit', 'Product fit',         60),
  ('loss_reason', 'other',       'Other',               90),
  -- tag (lowercase, <= 40 chars, same rules as the reference normalizeTags)
  ('tag', 'vip',         'VIP',         10),
  ('tag', 'key-account', 'Key account', 20),
  ('tag', 'export',      'Export',      30),
  ('tag', 'follow-up',   'Follow-up',   40),
  ('tag', 'sample',      'Sample requested', 50)
on conflict (picklist, value) do nothing;

-- ---------------------------------------------------------------------------
-- Pipelines and stages
-- ---------------------------------------------------------------------------
create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  is_default boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_pipelines enable row level security;

create unique index if not exists crm_pipelines_one_default
  on public.crm_pipelines (is_default) where is_default;

drop trigger if exists trg_crm_pipelines_touch on public.crm_pipelines;
create trigger trg_crm_pipelines_touch
before update on public.crm_pipelines
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 80),
  probability integer not null default 0 check (probability between 0 and 100),
  sort_order integer not null default 100,
  color_token text check (
    color_token is null or color_token in (
      'oboya-orange', 'oboya-blue', 'oboya-blue-light', 'oboya-green',
      'oboya-green-light', 'oboya-blue-dark', 'oboya-yellow-light',
      'oboya-yellow-dark', 'oboya-soft-white'
    )
  ),
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_pipeline_stages enable row level security;

create index if not exists crm_pipeline_stages_pipeline_idx
  on public.crm_pipeline_stages (pipeline_id, sort_order);

-- Row guard: won/lost stages cannot be deleted, deactivated or change kind
-- (they can be renamed / recoloured). A stage cannot move to another pipeline.
create or replace function public.crm_pipeline_stages_row_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    -- Allowed only as part of deleting the whole pipeline (cascade).
    if OLD.kind in ('won', 'lost')
       and exists (select 1 from public.crm_pipelines p where p.id = OLD.pipeline_id) then
      raise exception 'Won and lost stages cannot be removed' using errcode = '23514';
    end if;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.pipeline_id is distinct from OLD.pipeline_id then
      raise exception 'A stage cannot move to another pipeline' using errcode = '23514';
    end if;
    if OLD.kind in ('won', 'lost') and (NEW.kind <> OLD.kind or not NEW.active) then
      raise exception 'Won and lost stages cannot change kind or be deactivated'
        using errcode = '23514';
    end if;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  end if;

  if NEW.kind in ('won', 'lost') and not NEW.active then
    raise exception 'Won and lost stages must stay active' using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_crm_pipeline_stages_row_guard on public.crm_pipeline_stages;
create trigger trg_crm_pipeline_stages_row_guard
before insert or update or delete on public.crm_pipeline_stages
for each row execute function public.crm_pipeline_stages_row_guard();

-- Pipeline invariants (D6), checked at commit so multi-row edits can pass
-- through intermediate states: >= 1 active open stage, exactly 1 won stage,
-- >= 1 lost stage.
-- Trigger functions need no EXECUTE grant, so the check lives inside it.
-- Security definer: counts every stage of the pipeline regardless of RLS.
create or replace function public.crm_pipeline_stages_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pipeline uuid;
  v_open integer;
  v_won integer;
  v_lost integer;
begin
  foreach v_pipeline in array array[
    case when TG_OP in ('UPDATE', 'DELETE') then OLD.pipeline_id end,
    case when TG_OP in ('INSERT', 'UPDATE') then NEW.pipeline_id end
  ] loop
    continue when v_pipeline is null
      or not exists (select 1 from public.crm_pipelines where id = v_pipeline);

    select
      count(*) filter (where kind = 'open' and active),
      count(*) filter (where kind = 'won'),
      count(*) filter (where kind = 'lost')
    into v_open, v_won, v_lost
    from public.crm_pipeline_stages
    where pipeline_id = v_pipeline;

    if v_open < 1 then
      raise exception 'Pipeline needs at least one active open stage' using errcode = '23514';
    end if;
    if v_won <> 1 then
      raise exception 'Pipeline needs exactly one won stage' using errcode = '23514';
    end if;
    if v_lost < 1 then
      raise exception 'Pipeline needs at least one lost stage' using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_crm_pipeline_stages_invariants on public.crm_pipeline_stages;
create constraint trigger trg_crm_pipeline_stages_invariants
after insert or update or delete on public.crm_pipeline_stages
deferrable initially deferred
for each row execute function public.crm_pipeline_stages_invariants();

-- Default pipeline + stages (deterministic ids so re-runs and the seed match).
insert into public.crm_pipelines (id, name, is_default, sort_order)
values ('00000000-0000-4000-8000-000000000001', 'Default', true, 10)
on conflict (id) do nothing;

insert into public.crm_pipeline_stages (id, pipeline_id, label, probability, sort_order, color_token, kind)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Prospecting',     10, 10, 'oboya-blue-light',   'open'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Qualification',   20, 20, 'oboya-blue',         'open'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Needs Analysis',  40, 30, 'oboya-yellow-dark',  'open'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'Proposal/RFQ',    60, 40, 'oboya-yellow-light', 'open'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', 'Negotiation',     80, 50, 'oboya-green-light',  'open'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001', 'Closed Won',     100, 60, 'oboya-green',        'won'),
  ('00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000001', 'Closed Lost',      0, 70, 'oboya-orange',       'lost')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Group companies (D5). Not part of RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 120),
  legal_name text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  tax_id text,
  default_currency char(3) not null default 'USD'
    check (default_currency in ('BRL', 'USD', 'EUR', 'CNY')),
  logo_url text,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_entities enable row level security;

drop trigger if exists trg_crm_entities_touch on public.crm_entities;
create trigger trg_crm_entities_touch
before update on public.crm_entities
for each row execute function public.crm_touch_updated_at();

-- Legal names, countries and tax ids are left for Setup -> Companies.
insert into public.crm_entities (id, name, country_code, default_currency, sort_order)
values
  ('00000000-0000-4000-8000-000000000201', 'Oboya Horticulture', null, 'USD', 10),
  ('00000000-0000-4000-8000-000000000202', 'Oboya Horticultura', 'BR', 'BRL', 20),
  ('00000000-0000-4000-8000-000000000203', 'Oboya Reciclagem',   'BR', 'BRL', 30)
on conflict (id) do nothing;

commit;
