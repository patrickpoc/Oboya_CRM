-- Oboya CRM 1/6: core (extensions, roles, teams, users, access matrix, settings,
-- visibility helpers, privilege guard, auth bootstrap).
--
-- File names use a 14-digit version (20261116 + sequence) so `supabase db push`
-- sees six distinct versions and applies them in order. Run them in filename order
-- when pasting into the SQL editor.
--
-- Visibility (D2): crm_roles.visibility_scope drives crm_can_see():
--   own  -> only rows the user owns
--   team -> own rows + rows owned by members of any team the user MANAGES
--           (crm_teams.manager_id = me). Plain team membership grants nothing;
--           a manager who manages no team sees only own rows.
--   all  -> every row
-- Disabled users (status = 'disabled') see nothing and cannot write.
--
-- Idempotent: safe to run more than once.

begin;
set local lock_timeout = '5s';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Grants: anon gets nothing on CRM tables; authenticated never gets
-- truncate/references/trigger. Default privileges cover tables created later
-- by the role running the migrations (postgres). 000600 repeats the revokes.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Functions: nobody gets EXECUTE by default (Supabase grants it to anon and
-- authenticated); 000600 grants authenticated exactly what the app and RLS need.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared helpers that do not touch tables
-- ---------------------------------------------------------------------------

-- True for migrations / SQL editor / GoTrue (no JWT) and the service role.
-- False for any PostgREST session running as anon or authenticated.
create or replace function public.crm_is_privileged_session()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'role', '') in ('', 'service_role')
     and coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated');
$$;

-- Plain updated_at toggle for configuration tables.
create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles (D2: scope and can_write are editable in Setup -> Roles)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_roles (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(trim(label)) between 1 and 80),
  description text,
  system boolean not null default false,
  visibility_scope text not null default 'own'
    check (visibility_scope in ('own', 'team', 'all')),
  can_write boolean not null default true,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_roles enable row level security;

insert into public.crm_roles (id, label, description, system, visibility_scope, can_write, sort_order)
values
  ('super_admin',   'Super Admin',   'Full access, setup and restore.',          true, 'all',  true,  10),
  ('sales_manager', 'Sales Manager', 'Own records plus the teams they manage.',  true, 'team', true,  20),
  ('sales_rep',     'Sales Rep',     'Own records only.',                        true, 'own',  true,  30),
  ('read_only',     'Read Only',     'Reads every record, cannot write.',        true, 'all',  false, 40)
on conflict (id) do nothing;

-- System roles cannot be deleted or renamed (id); super_admin always keeps
-- scope all + write + active, so an admin cannot lock everyone out.
create or replace function public.crm_roles_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.system then
      raise exception 'System roles cannot be deleted' using errcode = '42501';
    end if;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.id is distinct from OLD.id then
      raise exception 'Role id cannot be changed' using errcode = '42501';
    end if;
    NEW.system := OLD.system;
    NEW.created_at := OLD.created_at;
  elsif not public.crm_is_privileged_session() then
    NEW.system := false; -- custom roles created from the app are never system roles
  end if;

  if NEW.id = 'super_admin'
     and (NEW.visibility_scope <> 'all' or not NEW.can_write or not NEW.active) then
    raise exception 'super_admin must keep scope all, write access and stay active'
      using errcode = '42501';
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_crm_roles_guard on public.crm_roles;
create trigger trg_crm_roles_guard
before insert or update or delete on public.crm_roles
for each row execute function public.crm_roles_guard();

-- ---------------------------------------------------------------------------
-- Teams and users
-- ---------------------------------------------------------------------------
create table if not exists public.crm_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 120),
  description text,
  manager_id uuid, -- FK to crm_users added below (circular reference)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_teams enable row level security;

create table if not exists public.crm_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  title text,
  phone text,
  role text not null default 'sales_rep' references public.crm_roles (id),
  team_id uuid references public.crm_teams (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  permission_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(permission_overrides) = 'object'),
  locale text not null default 'en' check (locale in ('en', 'pt-BR', 'es', 'zh-CN')),
  receives_inbound boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_users enable row level security;

alter table public.crm_teams drop constraint if exists crm_teams_manager_id_fkey;
alter table public.crm_teams
  add constraint crm_teams_manager_id_fkey
  foreign key (manager_id) references public.crm_users (id) on delete set null;

create unique index if not exists crm_users_email_uq on public.crm_users (lower(email));
create index if not exists crm_users_team_idx on public.crm_users (team_id);
create index if not exists crm_users_role_idx on public.crm_users (role);
create index if not exists crm_teams_manager_idx on public.crm_teams (manager_id);

drop trigger if exists trg_crm_teams_touch on public.crm_teams;
create trigger trg_crm_teams_touch
before update on public.crm_teams
for each row execute function public.crm_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Access matrix (singleton) and settings
-- ---------------------------------------------------------------------------
create table if not exists public.crm_access_control (
  id boolean primary key default true check (id),
  matrix jsonb not null default '{}'::jsonb check (jsonb_typeof(matrix) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_access_control enable row level security;

-- Permission matrix (mirrored by the app's BUILTIN_MATRIX). Shape:
--   crm_access_control.matrix = { "<role_id>": { "<module>": <level> } }
--   <level> = "full" | "none" | ["view", "create", ...]   (missing module = none)
--   modules: home, leads, accounts, contacts, opportunities, activities,
--            setup_users, setup_roles, setup_access, setup_companies,
--            setup_pipeline, setup_picklists, setup_lead_assignment, audit_logs
--   actions: view, create, edit, delete, convert, export
--   crm_users.permission_overrides = { "grants": { "<module>": <level> },
--                                      "denies": { "<module>": <level> } }
--   Effective = (role level ∪ grants) − denies; super_admin is always allowed
--   and ignores overrides; a role missing from the matrix has no permissions.
insert into public.crm_access_control (id, matrix)
values (true, $json$
{
  "super_admin": {
    "home": "full", "leads": "full", "accounts": "full", "contacts": "full",
    "opportunities": "full", "activities": "full", "setup_users": "full",
    "setup_roles": "full", "setup_access": "full", "setup_companies": "full",
    "setup_pipeline": "full", "setup_picklists": "full",
    "setup_lead_assignment": "full", "audit_logs": "full"
  },
  "sales_manager": {
    "home": "full", "leads": "full", "accounts": "full", "contacts": "full",
    "opportunities": "full", "activities": "full", "audit_logs": ["view"],
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
    "audit_logs": "none",
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  },
  "read_only": {
    "home": ["view"],
    "leads": ["view", "export"], "accounts": ["view", "export"],
    "contacts": ["view", "export"], "opportunities": ["view", "export"],
    "activities": ["view", "export"],
    "audit_logs": "none",
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  }
}
$json$::jsonb)
on conflict (id) do nothing;

drop trigger if exists trg_crm_access_control_touch on public.crm_access_control;
create trigger trg_crm_access_control_touch
before update on public.crm_access_control
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,79}$'),
  value jsonb not null default 'null'::jsonb,
  description text,
  -- admin_only rows are hidden from non-admins by RLS.
  admin_only boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.crm_users (id) on delete set null,
  constraint crm_settings_bootstrap_admin_only
    check (key not in ('bootstrap_admin_email', 'inbound_rr_cursor') or admin_only)
);
alter table public.crm_settings enable row level security;

drop trigger if exists trg_crm_settings_touch on public.crm_settings;
create trigger trg_crm_settings_touch
before update on public.crm_settings
for each row execute function public.crm_touch_updated_at();

insert into public.crm_settings (key, value, description, admin_only)
values
  ('inbound_assignment', '{"mode": "round_robin"}'::jsonb,
   'Inbound lead owner: round_robin over users with receives_inbound, or default_owner.', false),
  ('inbound_default_owner', 'null'::jsonb,
   'crm_users.id (string) used when round-robin has nobody, or when mode = default_owner.', false),
  ('inbound_rr_cursor', 'null'::jsonb,
   'Last user picked by round-robin. Written by crm_assign_inbound_owner().', true),
  ('lead_sla_hours', '{"warning": 24, "overdue": 48}'::jsonb,
   'First-response SLA thresholds in hours.', false),
  ('fx_rates', '{"base": "USD", "rates": {"USD": 1, "BRL": 0.18, "EUR": 1.08, "CNY": 0.14}}'::jsonb,
   'Static rates used to roll amounts up to USD. 1 unit of currency = rate USD.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Visibility helpers (security definer, pinned search_path)
-- ---------------------------------------------------------------------------
create or replace function public.crm_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.crm_users u
    where u.id = auth.uid() and u.status = 'active'
  );
$$;

create or replace function public.crm_current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role from public.crm_users u
  where u.id = auth.uid() and u.status = 'active';
$$;

create or replace function public.crm_current_scope()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.visibility_scope
  from public.crm_users u
  join public.crm_roles r on r.id = u.role
  where u.id = auth.uid() and u.status = 'active';
$$;

create or replace function public.crm_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.crm_users u
    where u.id = auth.uid() and u.status = 'active' and u.role = 'super_admin'
  );
$$;

create or replace function public.crm_can_write()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.crm_users u
    join public.crm_roles r on r.id = u.role
    where u.id = auth.uid() and u.status = 'active' and r.can_write
  );
$$;

-- Can the current user see a row owned by p_owner? See header for semantics.
create or replace function public.crm_can_see(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when p_owner is null then false
      when me.id = p_owner then true
      when me.scope = 'all' then true
      when me.scope = 'team' then exists (
        select 1
        from public.crm_users o
        join public.crm_teams t on t.id = o.team_id
        where o.id = p_owner and t.manager_id = me.id
      )
      else false
    end
    from (
      select u.id, r.visibility_scope as scope
      from public.crm_users u
      join public.crm_roles r on r.id = u.role
      where u.id = auth.uid() and u.status = 'active'
    ) me
  ), false);
$$;

-- Does a permission level ("full" | "none" | [actions]) include p_action?
create or replace function public.crm_level_allows(p_level jsonb, p_action text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case jsonb_typeof(p_level)
    when 'string' then (p_level #>> '{}') = 'full'
    when 'array' then p_level ? p_action
    else false
  end;
$$;

-- DB-enforced permission matrix (shape documented above the matrix seed).
create or replace function public.crm_has_permission(p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when u.role = 'super_admin' then true
      when public.crm_level_allows(u.permission_overrides -> 'denies' -> p_module, p_action) then false
      when public.crm_level_allows(u.permission_overrides -> 'grants' -> p_module, p_action) then true
      else public.crm_level_allows(
        (select ac.matrix -> u.role -> p_module from public.crm_access_control ac where ac.id),
        p_action)
    end
    from public.crm_users u
    where u.id = auth.uid() and u.status = 'active'
  ), false);
$$;

revoke all on function public.crm_level_allows(jsonb, text) from public, anon;
revoke all on function public.crm_has_permission(text, text) from public, anon;
grant execute on function public.crm_level_allows(jsonb, text) to authenticated, service_role;
grant execute on function public.crm_has_permission(text, text) to authenticated, service_role;

revoke all on function public.crm_is_privileged_session() from public, anon;
revoke all on function public.crm_is_active_user() from public, anon;
revoke all on function public.crm_current_user_role() from public, anon;
revoke all on function public.crm_current_scope() from public, anon;
revoke all on function public.crm_is_admin() from public, anon;
revoke all on function public.crm_can_write() from public, anon;
revoke all on function public.crm_can_see(uuid) from public, anon;
grant execute on function public.crm_is_privileged_session() to authenticated, service_role;
grant execute on function public.crm_is_active_user() to authenticated, service_role;
grant execute on function public.crm_current_user_role() to authenticated, service_role;
grant execute on function public.crm_current_scope() to authenticated, service_role;
grant execute on function public.crm_is_admin() to authenticated, service_role;
grant execute on function public.crm_can_write() to authenticated, service_role;
grant execute on function public.crm_can_see(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilege guard on crm_users (ported from reference 20261105)
--   * Privileged sessions (service role, SQL editor, GoTrue) bypass.
--   * id, email, created_at are never client-editable.
--   * Non-admins may only change their own full_name / locale (and title/phone).
--   * Nobody changes their own role or status from a user session (admins too):
--     that keeps the last admin from locking themselves out.
--   * Non-admins never change role / status / team / overrides / receives_inbound.
--   * The last active super_admin cannot be demoted or disabled.
-- ---------------------------------------------------------------------------
create or replace function public.crm_users_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_admin boolean;
  self_editable constant text[] := array['full_name', 'locale', 'title', 'phone', 'updated_at'];
begin
  if TG_OP = 'UPDATE' then
    NEW.updated_at := now();
  end if;

  if public.crm_is_privileged_session() then
    if TG_OP = 'DELETE' then return OLD; end if;
    if TG_OP = 'INSERT' then NEW.email := lower(NEW.email); end if;
    return NEW;
  end if;

  caller_admin := public.crm_is_admin();

  if TG_OP = 'DELETE' then
    if not caller_admin then
      raise exception 'Only a super admin can delete users' using errcode = '42501';
    end if;
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    if not caller_admin then
      raise exception 'Only a super admin can create users' using errcode = '42501';
    end if;
    NEW.email := lower(NEW.email);
    return NEW;
  end if;

  -- UPDATE: identity columns first, later checks rely on OLD.id.
  NEW.id := OLD.id;
  NEW.email := OLD.email;
  NEW.created_at := OLD.created_at;

  if not caller_admin then
    if OLD.id is distinct from auth.uid() then
      raise exception 'You can only update your own profile' using errcode = '42501';
    end if;
    if (to_jsonb(NEW) - self_editable) is distinct from (to_jsonb(OLD) - self_editable) then
      raise exception 'You can only change your name, title, phone and language'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  if OLD.id = auth.uid()
     and (NEW.role is distinct from OLD.role or NEW.status is distinct from OLD.status) then
    raise exception 'You cannot change your own role or status' using errcode = '42501';
  end if;

  if OLD.role = 'super_admin' and OLD.status = 'active'
     and (NEW.role <> 'super_admin' or NEW.status <> 'active')
     and not exists (
       select 1 from public.crm_users u
       where u.id <> OLD.id and u.role = 'super_admin' and u.status = 'active'
     ) then
    raise exception 'At least one active super admin is required' using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_crm_users_guard on public.crm_users;
create trigger trg_crm_users_guard
before insert or update or delete on public.crm_users
for each row execute function public.crm_users_guard();

-- ---------------------------------------------------------------------------
-- Auth bootstrap
--   * Every new auth user gets a crm_users row as sales_rep with
--     status 'disabled': an admin (Setup -> Users, service role) or
--     scripts/create-admin-user.mjs activates it explicitly.
--   * Bootstrap: when an auth user with a CONFIRMED email matching
--     crm_settings.bootstrap_admin_email (JSON string or array of strings)
--     exists and no active super_admin exists yet, that user becomes an active
--     super_admin and the setting is deleted (one-shot). Checked on insert and
--     again when email_confirmed_at is set later.
--   Disable public sign-ups in Supabase Auth anyway.
-- ---------------------------------------------------------------------------
create or replace function public.crm_try_bootstrap_admin(p_user_id uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(p_email, ''));
begin
  if v_email = ''
     or exists (select 1 from public.crm_users where role = 'super_admin' and status = 'active')
     or not exists (
       select 1 from public.crm_settings s
       where s.key = 'bootstrap_admin_email'
         and case jsonb_typeof(s.value)
               when 'string' then lower(s.value #>> '{}') = v_email
               when 'array' then exists (
                 select 1 from jsonb_array_elements_text(s.value) e where lower(e) = v_email
               )
               else false
             end
     ) then
    return false;
  end if;

  update public.crm_users
  set role = 'super_admin', status = 'active'
  where id = p_user_id;
  delete from public.crm_settings where key = 'bootstrap_admin_email';
  return true;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(NEW.email, ''));
begin
  insert into public.crm_users (id, email, full_name, role, status)
  values (
    NEW.id,
    v_email,
    coalesce(
      nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
      split_part(v_email, '@', 1)
    ),
    'sales_rep',
    'disabled'
  )
  on conflict (id) do nothing;

  if NEW.email_confirmed_at is not null then
    perform public.crm_try_bootstrap_admin(NEW.id, v_email);
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.email_confirmed_at is null and NEW.email_confirmed_at is not null then
    perform public.crm_try_bootstrap_admin(NEW.id, NEW.email);
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
after update of email_confirmed_at on auth.users
for each row execute function public.handle_user_email_confirmed();

-- Keep crm_users.email in sync when the auth email changes.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.email is distinct from OLD.email and NEW.email is not null then
    update public.crm_users set email = lower(NEW.email) where id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function public.handle_user_email_change();

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;
revoke all on function public.handle_user_email_confirmed() from public, anon, authenticated;
revoke all on function public.crm_try_bootstrap_admin(uuid, text) from public, anon, authenticated;

commit;
