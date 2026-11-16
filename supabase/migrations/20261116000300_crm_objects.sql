-- Oboya CRM 3/6: object tables (accounts, account entities, contacts, leads,
-- opportunities, activities), recent views, audit log table, search indexes.
-- Depends on 000100 and 000200. Idempotent.
--
-- Every object table carries the common columns:
--   id, owner_id, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by
-- maintained by crm_set_record_meta() (below). Soft delete only: there is no
-- DELETE policy for clients (see 000400).

begin;
set local lock_timeout = '5s';
-- pg_trgm lives in "extensions" on Supabase; this lets gin_trgm_ops resolve
-- wherever the extension is installed.
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Shared row trigger for object tables
--   INSERT: user sessions get created_at/updated_at = now() and cannot spoof
--           created_by/updated_by (forced to auth.uid()); service-role writes
--           keep the values they pass (inbound, seed, imports).
--   UPDATE: created_* frozen; updated_at = now(); updated_by = auth.uid() when
--           there is one; deleted_by follows deleted_at; only admins restore.
-- ---------------------------------------------------------------------------
create or replace function public.crm_set_record_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_privileged boolean := public.crm_is_privileged_session();
begin
  if TG_OP = 'INSERT' then
    if not v_privileged then
      NEW.created_at := now();
      NEW.updated_at := NEW.created_at;
      NEW.created_by := v_uid;
      NEW.updated_by := v_uid;
      NEW.deleted_at := null;
      NEW.deleted_by := null;
    else
      -- Service role (seed, inbound, imports) may backdate created_at.
      NEW.created_at := coalesce(NEW.created_at, now());
      NEW.updated_at := greatest(coalesce(NEW.updated_at, NEW.created_at), NEW.created_at);
      NEW.created_by := coalesce(NEW.created_by, v_uid, NEW.owner_id);
      NEW.updated_by := coalesce(NEW.updated_by, NEW.created_by);
    end if;
    return NEW;
  end if;

  -- UPDATE
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.updated_at := now();
  if v_uid is not null then
    NEW.updated_by := v_uid;
  end if;

  if OLD.deleted_at is null and NEW.deleted_at is not null then
    NEW.deleted_by := coalesce(v_uid, NEW.deleted_by);
  elsif OLD.deleted_at is not null and NEW.deleted_at is null then
    if not v_privileged and not public.crm_is_admin() then
      raise exception 'Only a super admin can restore records' using errcode = '42501';
    end if;
    NEW.deleted_by := null;
  elsif not v_privileged then
    NEW.deleted_by := OLD.deleted_by;
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Object row guard (user sessions only; service role / SQL editor bypass).
-- TG_ARGV[0] = object name.
--   * Owner change: the new owner must be visible to the caller (activities'
--     update policy also admits rows visible through their parent, so this is
--     what stops handing such a row to an invisible owner).
--   * FK visibility: a changed reference must point at a record the caller can
--     see (crm_can_see_record, defined in 000400):
--       account.parent_account_id, contact.account_id,
--       opportunity.account_id / primary_contact_id,
--       activity.who_contact_id / what_object+what_id
--   * Leads: converted_at / converted_* are rejected when current_user is
--     'authenticated' (a direct client write). crm_convert_lead is security
--     definer, so inside it current_user is the function owner and the write
--     passes. Hence this function must stay SECURITY INVOKER.
-- ---------------------------------------------------------------------------
create or replace function public.crm_record_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_object text := TG_ARGV[0];
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
  v_refs text[][];
  i integer;
  v_col text;
  v_target text;
begin
  if public.crm_is_privileged_session() then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and NEW.owner_id is distinct from OLD.owner_id
     and not public.crm_can_see(NEW.owner_id) then
    raise exception 'You cannot assign this record to that owner' using errcode = '42501';
  end if;

  v_refs := case v_object
    when 'account' then array[['parent_account_id', 'account']]
    when 'contact' then array[['account_id', 'account']]
    when 'opportunity' then array[['account_id', 'account'], ['primary_contact_id', 'contact']]
    when 'activity' then array[['who_contact_id', 'contact']]
    else array[]::text[][]
  end;

  if v_refs is not null and array_length(v_refs, 1) is not null then
    for i in 1 .. array_length(v_refs, 1) loop
      v_col := v_refs[i][1];
      v_target := v_refs[i][2];
      if (v_new ->> v_col) is not null
         and (v_new -> v_col) is distinct from (v_old -> v_col)
         and not public.crm_can_see_record(v_target, (v_new ->> v_col)::uuid) then
        raise exception 'Related % not found', v_target using errcode = '42501';
      end if;
    end loop;
  end if;

  if v_object = 'activity'
     and (v_new ->> 'what_id') is not null
     and ((v_new -> 'what_id') is distinct from (v_old -> 'what_id')
          or (v_new -> 'what_object') is distinct from (v_old -> 'what_object'))
     and not public.crm_can_see_record(v_new ->> 'what_object', (v_new ->> 'what_id')::uuid) then
    raise exception 'Related record not found' using errcode = '42501';
  end if;

  if v_object = 'lead' and current_user = 'authenticated' then
    foreach v_col in array array['converted_at', 'converted_account_id',
                                 'converted_contact_id', 'converted_opportunity_id'] loop
      if coalesce(v_new -> v_col, 'null'::jsonb) is distinct from coalesce(v_old -> v_col, 'null'::jsonb) then
        raise exception 'Use crm_convert_lead to convert a lead' using errcode = '42501';
      end if;
    end loop;
  end if;

  return NEW;
end;
$$;

revoke all on function public.crm_record_guard() from public, anon, authenticated;

-- Tag rules from the reference normalizeTags: lowercase, trimmed, 1..40 chars, <= 20 tags.
create or replace function public.crm_tags_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(p_tags), 0) <= 20
     and not exists (
       select 1 from unnest(coalesce(p_tags, '{}'::text[])) t
       where t is null or t <> lower(trim(t)) or length(t) not between 1 and 40
     );
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  type text not null default 'prospect'
    check (type in ('customer', 'prospect', 'distributor', 'partner', 'other')),
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  segment text,
  industry text,
  website text,
  phone text,
  email text,
  tax_id text,
  parent_account_id uuid references public.crm_accounts (id) on delete set null,
  billing_street text,
  billing_city text,
  billing_state text,
  billing_postal_code text,
  billing_country_code char(2)
    check (billing_country_code is null or billing_country_code ~ '^[A-Z]{2}$'),
  description text,
  external_ref text,
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null,
  check (parent_account_id is distinct from id)
);
alter table public.crm_accounts enable row level security;

-- Accounts <-> group companies (D5)
create table if not exists public.crm_account_entities (
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  entity_id uuid not null references public.crm_entities (id),
  is_primary boolean not null default false,
  since date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.crm_users (id) on delete set null,
  primary key (account_id, entity_id)
);
alter table public.crm_account_entities enable row level security;

create unique index if not exists crm_account_entities_one_primary
  on public.crm_account_entities (account_id) where is_primary;
create index if not exists crm_account_entities_entity_idx
  on public.crm_account_entities (entity_id);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.crm_accounts (id) on delete set null,
  first_name text,
  last_name text not null check (length(trim(last_name)) between 1 and 120),
  full_name text generated always as (
    trim(coalesce(first_name, '') || ' ' || last_name)
  ) stored,
  email text,
  phone text,
  mobile text,
  title text,
  department text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  locale text,
  lead_source text,
  description text,
  external_ref text,
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_contacts enable row level security;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text not null default '',
  full_name text generated always as (
    trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored,
  company text,
  title text,
  email text,
  phone text,
  website text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  locale text,
  status text not null default 'new'
    check (status in ('new', 'working', 'qualified', 'unqualified')),
  unqualified_reason text,
  source text,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  rating text check (rating is null or rating in ('hot', 'warm', 'cold')),
  tags text[] not null default '{}'::text[] check (public.crm_tags_valid(tags)),
  segment text,
  industry text,
  message text,
  entity_id uuid references public.crm_entities (id),
  first_responded_at timestamptz,
  last_activity_at timestamptz,
  converted_at timestamptz,
  converted_account_id uuid references public.crm_accounts (id) on delete set null,
  converted_contact_id uuid references public.crm_contacts (id) on delete set null,
  converted_opportunity_id uuid, -- FK added after crm_opportunities
  external_ref text,
  raw_payload jsonb,
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null,
  constraint crm_leads_converted_is_qualified
    check (converted_at is null or status = 'qualified'),
  constraint crm_leads_has_name
    check (length(trim(coalesce(first_name, '') || coalesce(last_name, '') || coalesce(company, '') || coalesce(email, ''))) > 0)
);
alter table public.crm_leads enable row level security;

create unique index if not exists crm_leads_email_live_uq
  on public.crm_leads (lower(email)) where deleted_at is null and email is not null;
create unique index if not exists crm_leads_external_ref_uq
  on public.crm_leads (external_ref) where external_ref is not null;

-- ---------------------------------------------------------------------------
-- Opportunities
-- ---------------------------------------------------------------------------
create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  account_id uuid not null references public.crm_accounts (id),
  primary_contact_id uuid references public.crm_contacts (id) on delete set null,
  pipeline_id uuid not null references public.crm_pipelines (id),
  stage_id uuid not null references public.crm_pipeline_stages (id) on delete restrict,
  probability integer check (probability is null or probability between 0 and 100),
  amount numeric(14, 2) check (amount is null or amount >= 0),
  currency char(3) not null default 'USD' check (currency in ('BRL', 'USD', 'EUR', 'CNY')),
  close_date date,
  loss_reason text,
  loss_note text,
  entity_id uuid references public.crm_entities (id),
  lead_source text,
  next_step text,
  description text,
  closed_at timestamptz,
  external_ref text,
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_opportunities enable row level security;

alter table public.crm_leads drop constraint if exists crm_leads_converted_opportunity_id_fkey;
alter table public.crm_leads
  add constraint crm_leads_converted_opportunity_id_fkey
  foreign key (converted_opportunity_id) references public.crm_opportunities (id) on delete set null;

-- Stage rules: pipeline must match the stage; probability follows the stage
-- unless set explicitly in the same write; lost requires loss_reason;
-- closed_at is stamped when entering won/lost and cleared when reopening.
create or replace function public.crm_opportunity_stage_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage record;
  v_stage_changed boolean;
begin
  select s.pipeline_id, s.kind, s.probability
  into v_stage
  from public.crm_pipeline_stages s
  where s.id = NEW.stage_id;

  if not found then
    raise exception 'Unknown stage' using errcode = '23503';
  end if;

  if NEW.pipeline_id is null then
    NEW.pipeline_id := v_stage.pipeline_id;
  elsif NEW.pipeline_id <> v_stage.pipeline_id then
    raise exception 'Stage does not belong to the opportunity pipeline' using errcode = '23514';
  end if;

  v_stage_changed := TG_OP = 'INSERT' or NEW.stage_id is distinct from OLD.stage_id;

  if TG_OP = 'INSERT' then
    NEW.probability := coalesce(NEW.probability, v_stage.probability);
  elsif v_stage_changed and NEW.probability is not distinct from OLD.probability then
    NEW.probability := v_stage.probability;
  end if;

  if v_stage.kind = 'lost' and coalesce(trim(NEW.loss_reason), '') = '' then
    raise exception 'loss_reason_required' using errcode = '23514',
      hint = 'Set loss_reason when moving an opportunity to a lost stage.';
  end if;

  if v_stage.kind in ('won', 'lost') then
    if v_stage_changed or NEW.closed_at is null then
      NEW.closed_at := coalesce(case when TG_OP = 'INSERT' then NEW.closed_at end, now());
    end if;
  else
    NEW.closed_at := null;
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activities (polymorphic parent: what_object + what_id; person: who_contact_id)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('task', 'call', 'meeting', 'note', 'email')),
  subject text not null check (length(trim(subject)) between 1 and 300),
  body text,
  status text not null default 'open' check (status in ('open', 'done')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 1440),
  completed_at timestamptz,
  what_object text check (what_object in ('lead', 'account', 'contact', 'opportunity')),
  what_id uuid,
  who_contact_id uuid references public.crm_contacts (id) on delete set null,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  external_ref text,
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null,
  constraint crm_activities_what_pair
    check ((what_object is null) = (what_id is null))
);
alter table public.crm_activities enable row level security;

create unique index if not exists crm_activities_external_ref_uq
  on public.crm_activities (external_ref) where external_ref is not null;

-- Polymorphic parent must exist; completed_at follows status.
create or replace function public.crm_activity_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
begin
  if NEW.what_id is not null
     and (TG_OP = 'INSERT'
          or NEW.what_id is distinct from OLD.what_id
          or NEW.what_object is distinct from OLD.what_object) then
    v_exists := case NEW.what_object
      when 'lead' then exists (select 1 from public.crm_leads where id = NEW.what_id)
      when 'account' then exists (select 1 from public.crm_accounts where id = NEW.what_id)
      when 'contact' then exists (select 1 from public.crm_contacts where id = NEW.what_id)
      when 'opportunity' then exists (select 1 from public.crm_opportunities where id = NEW.what_id)
      else false
    end;
    if not v_exists then
      raise exception 'Related record not found' using errcode = '23503';
    end if;
  end if;

  if NEW.status = 'done' then
    NEW.completed_at := coalesce(NEW.completed_at, now());
  else
    NEW.completed_at := null;
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recently viewed
-- ---------------------------------------------------------------------------
create table if not exists public.crm_recent_views (
  user_id uuid not null default auth.uid() references public.crm_users (id) on delete cascade,
  object text not null check (object in ('lead', 'account', 'contact', 'opportunity', 'activity')),
  record_id uuid not null,
  viewed_at timestamptz not null default now(),
  primary key (user_id, object, record_id)
);
alter table public.crm_recent_views enable row level security;

create index if not exists crm_recent_views_user_idx
  on public.crm_recent_views (user_id, viewed_at desc);

-- ---------------------------------------------------------------------------
-- Audit log (written only by the trigger in 000500)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_name text not null default 'system',
  object text not null,
  record_id uuid not null,
  -- owner of the record at write time; drives manager visibility in RLS
  owner_id uuid,
  action text not null
    check (action in ('create', 'update', 'delete', 'restore', 'stage_change', 'owner_change', 'convert')),
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.crm_audit_logs enable row level security;

create index if not exists crm_audit_logs_record_idx
  on public.crm_audit_logs (object, record_id, created_at desc);
create index if not exists crm_audit_logs_created_idx on public.crm_audit_logs (created_at desc);
create index if not exists crm_audit_logs_actor_idx on public.crm_audit_logs (actor_id);
create index if not exists crm_audit_logs_owner_idx on public.crm_audit_logs (owner_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crm_accounts_meta on public.crm_accounts;
create trigger trg_crm_accounts_meta
before insert or update on public.crm_accounts
for each row execute function public.crm_set_record_meta();

drop trigger if exists trg_crm_contacts_meta on public.crm_contacts;
create trigger trg_crm_contacts_meta
before insert or update on public.crm_contacts
for each row execute function public.crm_set_record_meta();

drop trigger if exists trg_crm_leads_meta on public.crm_leads;
create trigger trg_crm_leads_meta
before insert or update on public.crm_leads
for each row execute function public.crm_set_record_meta();

drop trigger if exists trg_crm_opportunities_meta on public.crm_opportunities;
create trigger trg_crm_opportunities_meta
before insert or update on public.crm_opportunities
for each row execute function public.crm_set_record_meta();

drop trigger if exists trg_crm_activities_meta on public.crm_activities;
create trigger trg_crm_activities_meta
before insert or update on public.crm_activities
for each row execute function public.crm_set_record_meta();

-- Guards fire before the meta trigger (BEFORE triggers fire in name order).
drop trigger if exists trg_crm_accounts_guard on public.crm_accounts;
create trigger trg_crm_accounts_guard
before insert or update on public.crm_accounts
for each row execute function public.crm_record_guard('account');

drop trigger if exists trg_crm_contacts_guard on public.crm_contacts;
create trigger trg_crm_contacts_guard
before insert or update on public.crm_contacts
for each row execute function public.crm_record_guard('contact');

drop trigger if exists trg_crm_leads_guard on public.crm_leads;
create trigger trg_crm_leads_guard
before insert or update on public.crm_leads
for each row execute function public.crm_record_guard('lead');

drop trigger if exists trg_crm_opportunities_guard on public.crm_opportunities;
create trigger trg_crm_opportunities_guard
before insert or update on public.crm_opportunities
for each row execute function public.crm_record_guard('opportunity');

drop trigger if exists trg_crm_activities_guard on public.crm_activities;
create trigger trg_crm_activities_guard
before insert or update on public.crm_activities
for each row execute function public.crm_record_guard('activity');

-- "z" prefix: runs after the meta trigger (triggers fire in name order).
drop trigger if exists trg_crm_opportunities_zstage on public.crm_opportunities;
create trigger trg_crm_opportunities_zstage
before insert or update on public.crm_opportunities
for each row execute function public.crm_opportunity_stage_rules();

drop trigger if exists trg_crm_activities_zrules on public.crm_activities;
create trigger trg_crm_activities_zrules
before insert or update on public.crm_activities
for each row execute function public.crm_activity_rules();

-- ---------------------------------------------------------------------------
-- Indexes (FKs, list views, search)
-- ---------------------------------------------------------------------------
create index if not exists crm_accounts_owner_idx on public.crm_accounts (owner_id) where deleted_at is null;
create index if not exists crm_accounts_parent_idx on public.crm_accounts (parent_account_id);
create index if not exists crm_accounts_country_idx on public.crm_accounts (country_code);
create index if not exists crm_accounts_name_trgm on public.crm_accounts using gin (name gin_trgm_ops);

create index if not exists crm_contacts_owner_idx on public.crm_contacts (owner_id) where deleted_at is null;
create index if not exists crm_contacts_account_idx on public.crm_contacts (account_id);
create index if not exists crm_contacts_email_idx on public.crm_contacts (lower(email));
create index if not exists crm_contacts_name_trgm on public.crm_contacts using gin (full_name gin_trgm_ops);
create index if not exists crm_contacts_email_trgm on public.crm_contacts using gin (email gin_trgm_ops);

create index if not exists crm_leads_owner_idx on public.crm_leads (owner_id) where deleted_at is null;
create index if not exists crm_leads_status_idx on public.crm_leads (status, created_at desc) where deleted_at is null;
create index if not exists crm_leads_entity_idx on public.crm_leads (entity_id);
create index if not exists crm_leads_name_trgm on public.crm_leads using gin (full_name gin_trgm_ops);
create index if not exists crm_leads_company_trgm on public.crm_leads using gin (company gin_trgm_ops);
create index if not exists crm_leads_email_trgm on public.crm_leads using gin (email gin_trgm_ops);

create index if not exists crm_opportunities_owner_idx on public.crm_opportunities (owner_id) where deleted_at is null;
create index if not exists crm_opportunities_account_idx on public.crm_opportunities (account_id);
create index if not exists crm_opportunities_contact_idx on public.crm_opportunities (primary_contact_id);
create index if not exists crm_opportunities_stage_idx on public.crm_opportunities (pipeline_id, stage_id) where deleted_at is null;
create index if not exists crm_opportunities_entity_idx on public.crm_opportunities (entity_id);
create index if not exists crm_opportunities_close_idx on public.crm_opportunities (close_date);
create index if not exists crm_opportunities_name_trgm on public.crm_opportunities using gin (name gin_trgm_ops);

create index if not exists crm_activities_owner_idx on public.crm_activities (owner_id, status, due_at) where deleted_at is null;
create index if not exists crm_activities_what_idx on public.crm_activities (what_object, what_id);
create index if not exists crm_activities_who_idx on public.crm_activities (who_contact_id);

commit;
