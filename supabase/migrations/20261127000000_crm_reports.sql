-- Reports & Dashboards + editable Home layouts.
-- Idempotent. Depends on 000100-000750 and the audit trigger. No begin/commit:
-- the file runs as one implicit transaction. 14-digit version so db push keeps order.

-- ---------------------------------------------------------------------------
-- Permission module `reports` (mirrored by BUILTIN_MATRIX). Incremental: only
-- roles that exist and have no `reports` cell yet receive the default; custom
-- roles and explicit none/[] cells survive.
-- ---------------------------------------------------------------------------
update public.crm_access_control
set matrix = public.crm_add_module_permissions(matrix, 'reports', $json$
{
  "super_admin": "full",
  "sales_manager": "full",
  "sales_rep": ["view", "create", "edit", "delete", "export"],
  "read_only": ["view", "export"]
}
$json$::jsonb)
where id;

-- ---------------------------------------------------------------------------
-- Helpers (security definer, stable, pinned search_path)
-- ---------------------------------------------------------------------------
-- Member or manager of the team.
create or replace function public.crm_in_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_team is not null and exists (
    select 1 from public.crm_users u
    where u.id = auth.uid() and u.status = 'active'
      and (
        u.team_id = p_team
        or exists (
          select 1 from public.crm_teams t where t.id = p_team and t.manager_id = u.id
        )
      )
  );
$$;

-- Does the current user manage this specific team? False for null.
create or replace function public.crm_manages_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_team is not null and exists (
    select 1
    from public.crm_users u
    join public.crm_teams t on t.manager_id = u.id
    where u.id = auth.uid() and u.status = 'active' and t.id = p_team
  );
$$;

-- Does the current user manage at least one team?
create or replace function public.crm_manages_any_team()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.crm_users u
    join public.crm_teams t on t.manager_id = u.id
    where u.id = auth.uid() and u.status = 'active'
  );
$$;

-- Read rule of a shared item (folder, dashboard): owner, admin, public, team.
create or replace function public.crm_can_read_shared(p_owner uuid, p_vis text, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.crm_is_active_user() and (
    p_owner = auth.uid()
    or public.crm_is_admin()
    or p_vis = 'public'
    or (p_vis = 'team' and public.crm_in_team(p_team))
  );
$$;

-- Publish rule (mirrored by canPublish in src/lib/crm/reports/sharing.ts):
-- private = anyone; team = admin or that team's manager; public = admin or any
-- team manager.
create or replace function public.crm_can_publish(p_vis text, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.crm_is_active_user() and case p_vis
    when 'private' then true
    when 'team' then p_team is not null
      and (public.crm_is_admin() or public.crm_manages_team(p_team))
    when 'public' then public.crm_is_admin() or public.crm_manages_any_team()
    else false
  end;
$$;

revoke all on function public.crm_in_team(uuid) from public, anon;
revoke all on function public.crm_manages_team(uuid) from public, anon;
revoke all on function public.crm_manages_any_team() from public, anon;
revoke all on function public.crm_can_read_shared(uuid, text, uuid) from public, anon;
revoke all on function public.crm_can_publish(text, uuid) from public, anon;
grant execute on function public.crm_in_team(uuid) to authenticated, service_role;
grant execute on function public.crm_manages_team(uuid) to authenticated, service_role;
grant execute on function public.crm_manages_any_team() to authenticated, service_role;
grant execute on function public.crm_can_read_shared(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.crm_can_publish(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- crm_report_folders
-- ---------------------------------------------------------------------------
create table if not exists public.crm_report_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  visibility text not null default 'private' check (visibility in ('private', 'team', 'public')),
  team_id uuid references public.crm_teams (id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null,
  constraint crm_report_folders_team_chk check ((visibility = 'team') = (team_id is not null))
);
alter table public.crm_report_folders enable row level security;
create index if not exists crm_report_folders_owner_idx
  on public.crm_report_folders (owner_id) where deleted_at is null;
create index if not exists crm_report_folders_team_idx
  on public.crm_report_folders (team_id) where deleted_at is null and team_id is not null;

-- ---------------------------------------------------------------------------
-- crm_reports (visibility is inherited from the folder; no folder = private)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_reports (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.crm_report_folders (id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  object text not null check (object in ('lead', 'account', 'contact', 'opportunity', 'activity')),
  definition jsonb not null check (
    jsonb_typeof(definition) = 'object' and octet_length(definition::text) <= 32768
  ),
  schema_version integer not null default 1 check (schema_version >= 1),
  constraint crm_reports_object_chk check (coalesce(definition ->> 'object', '') = object),
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_reports enable row level security;
create index if not exists crm_reports_owner_idx
  on public.crm_reports (owner_id) where deleted_at is null;
create index if not exists crm_reports_folder_idx
  on public.crm_reports (folder_id) where deleted_at is null and folder_id is not null;

-- ---------------------------------------------------------------------------
-- crm_dashboards
-- ---------------------------------------------------------------------------
create table if not exists public.crm_dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  visibility text not null default 'private' check (visibility in ('private', 'team', 'public')),
  team_id uuid references public.crm_teams (id) on delete cascade,
  widgets jsonb not null default '[]'::jsonb check (
    jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 20
    and octet_length(widgets::text) <= 16384
  ),
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null,
  constraint crm_dashboards_team_chk check ((visibility = 'team') = (team_id is not null))
);
alter table public.crm_dashboards enable row level security;
create index if not exists crm_dashboards_owner_idx
  on public.crm_dashboards (owner_id) where deleted_at is null;
create index if not exists crm_dashboards_team_idx
  on public.crm_dashboards (team_id) where deleted_at is null and team_id is not null;

-- ---------------------------------------------------------------------------
-- crm_home_layouts (one live row per scope target)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_home_layouts (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('default', 'team', 'user')),
  team_id uuid references public.crm_teams (id) on delete cascade,
  user_id uuid references public.crm_users (id) on delete cascade,
  widgets jsonb not null default '[]'::jsonb check (
    jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 24
    and octet_length(widgets::text) <= 16384
  ),
  owner_id uuid not null default auth.uid() references public.crm_users (id),
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null,
  constraint crm_home_layouts_target_chk check (
    (scope = 'default' and team_id is null and user_id is null)
    or (scope = 'team' and team_id is not null and user_id is null)
    or (scope = 'user' and user_id is not null and team_id is null)
  )
);
alter table public.crm_home_layouts enable row level security;
create unique index if not exists crm_home_layouts_default_uq
  on public.crm_home_layouts (scope) where scope = 'default' and deleted_at is null;
create unique index if not exists crm_home_layouts_team_uq
  on public.crm_home_layouts (team_id) where scope = 'team' and deleted_at is null;
create unique index if not exists crm_home_layouts_user_uq
  on public.crm_home_layouts (user_id) where scope = 'user' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Meta + audit triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crm_report_folders_meta on public.crm_report_folders;
create trigger trg_crm_report_folders_meta
before insert or update on public.crm_report_folders
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_report_folders_audit on public.crm_report_folders;
create trigger trg_crm_report_folders_audit
after insert or update or delete on public.crm_report_folders
for each row execute function public.crm_audit_trigger('report_folder');

drop trigger if exists trg_crm_reports_meta on public.crm_reports;
create trigger trg_crm_reports_meta
before insert or update on public.crm_reports
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_reports_audit on public.crm_reports;
create trigger trg_crm_reports_audit
after insert or update or delete on public.crm_reports
for each row execute function public.crm_audit_trigger('report');

drop trigger if exists trg_crm_dashboards_meta on public.crm_dashboards;
create trigger trg_crm_dashboards_meta
before insert or update on public.crm_dashboards
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_dashboards_audit on public.crm_dashboards;
create trigger trg_crm_dashboards_audit
after insert or update or delete on public.crm_dashboards
for each row execute function public.crm_audit_trigger('dashboard');

drop trigger if exists trg_crm_home_layouts_meta on public.crm_home_layouts;
create trigger trg_crm_home_layouts_meta
before insert or update on public.crm_home_layouts
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_home_layouts_audit on public.crm_home_layouts;
create trigger trg_crm_home_layouts_audit
after insert or update or delete on public.crm_home_layouts
for each row execute function public.crm_audit_trigger('home_layout');

-- ---------------------------------------------------------------------------
-- Grants: no anon; soft delete means no DELETE for clients.
-- ---------------------------------------------------------------------------
revoke all on table public.crm_report_folders, public.crm_reports,
  public.crm_dashboards, public.crm_home_layouts from public, anon, authenticated;
grant select, insert, update on table public.crm_report_folders, public.crm_reports,
  public.crm_dashboards, public.crm_home_layouts to authenticated;
-- A layout reset ("back to team default") is a hard delete, audited by trigger.
grant delete on table public.crm_home_layouts to authenticated;
grant all on table public.crm_report_folders, public.crm_reports,
  public.crm_dashboards, public.crm_home_layouts to service_role;

-- ---------------------------------------------------------------------------
-- RLS: folders. Owners keep read access to their own soft-deleted rows: a
-- soft delete is an UPDATE and PostgreSQL checks the new row against SELECT.
-- Lists filter deleted_at is null.
-- ---------------------------------------------------------------------------
drop policy if exists crm_report_folders_select on public.crm_report_folders;
create policy crm_report_folders_select on public.crm_report_folders
  for select to authenticated
  using (
    (deleted_at is null or owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and (select public.crm_has_permission('reports', 'view'))
    and public.crm_can_read_shared(owner_id, visibility, team_id)
  );

drop policy if exists crm_report_folders_insert on public.crm_report_folders;
create policy crm_report_folders_insert on public.crm_report_folders
  for insert to authenticated
  with check (
    deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('reports', 'create'))
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and public.crm_can_publish(visibility, team_id)
  );

drop policy if exists crm_report_folders_update on public.crm_report_folders;
create policy crm_report_folders_update on public.crm_report_folders
  for update to authenticated
  using (
    deleted_at is null
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
  )
  with check (
    (select public.crm_can_write())
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and case when deleted_at is null
      then (select public.crm_has_permission('reports', 'edit'))
      else (select public.crm_has_permission('reports', 'delete'))
    end
    and public.crm_can_publish(visibility, team_id)
  );

-- ---------------------------------------------------------------------------
-- RLS: reports (readable by owner, admin, or anyone who can read the folder;
-- only the folder owner or an admin can file a report into a folder)
-- ---------------------------------------------------------------------------
drop policy if exists crm_reports_select on public.crm_reports;
create policy crm_reports_select on public.crm_reports
  for select to authenticated
  using (
    (deleted_at is null or owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and (select public.crm_has_permission('reports', 'view'))
    and (
      owner_id = (select auth.uid())
      or (select public.crm_is_admin())
      or (
        folder_id is not null and exists (
          select 1 from public.crm_report_folders f
          where f.id = crm_reports.folder_id and f.deleted_at is null
            and public.crm_can_read_shared(f.owner_id, f.visibility, f.team_id)
        )
      )
    )
  );

drop policy if exists crm_reports_insert on public.crm_reports;
create policy crm_reports_insert on public.crm_reports
  for insert to authenticated
  with check (
    deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('reports', 'create'))
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and (
      folder_id is null or exists (
        select 1 from public.crm_report_folders f
        where f.id = crm_reports.folder_id and f.deleted_at is null
          and (f.owner_id = (select auth.uid()) or (select public.crm_is_admin()))
      )
    )
  );

drop policy if exists crm_reports_update on public.crm_reports;
create policy crm_reports_update on public.crm_reports
  for update to authenticated
  using (
    deleted_at is null
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
  )
  with check (
    (select public.crm_can_write())
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and case when deleted_at is null
      then (select public.crm_has_permission('reports', 'edit'))
      else (select public.crm_has_permission('reports', 'delete'))
    end
    and (
      folder_id is null or exists (
        select 1 from public.crm_report_folders f
        where f.id = crm_reports.folder_id and f.deleted_at is null
          and (f.owner_id = (select auth.uid()) or (select public.crm_is_admin()))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: dashboards
-- ---------------------------------------------------------------------------
drop policy if exists crm_dashboards_select on public.crm_dashboards;
create policy crm_dashboards_select on public.crm_dashboards
  for select to authenticated
  using (
    (deleted_at is null or owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and (select public.crm_has_permission('reports', 'view'))
    and public.crm_can_read_shared(owner_id, visibility, team_id)
  );

drop policy if exists crm_dashboards_insert on public.crm_dashboards;
create policy crm_dashboards_insert on public.crm_dashboards
  for insert to authenticated
  with check (
    deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('reports', 'create'))
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and public.crm_can_publish(visibility, team_id)
  );

drop policy if exists crm_dashboards_update on public.crm_dashboards;
create policy crm_dashboards_update on public.crm_dashboards
  for update to authenticated
  using (
    deleted_at is null
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
  )
  with check (
    (select public.crm_can_write())
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and case when deleted_at is null
      then (select public.crm_has_permission('reports', 'edit'))
      else (select public.crm_has_permission('reports', 'delete'))
    end
    and public.crm_can_publish(visibility, team_id)
  );

-- ---------------------------------------------------------------------------
-- RLS: home layouts. Everyone reads the default, their own team's layout and
-- their own. Admins write the default; admins or the team's manager write a
-- team layout; a user writes their own (a personal UI preference, so it needs
-- home.view but not crm_can_write).
-- ---------------------------------------------------------------------------
drop policy if exists crm_home_layouts_select on public.crm_home_layouts;
create policy crm_home_layouts_select on public.crm_home_layouts
  for select to authenticated
  using (
    deleted_at is null
    and (select public.crm_is_active_user())
    and (
      (select public.crm_is_admin())
      or ((select public.crm_has_permission('home', 'view')) and (
        scope = 'default'
        or (scope = 'team' and public.crm_in_team(team_id))
        or (scope = 'user' and user_id = (select auth.uid()))
      ))
    )
  );

drop policy if exists crm_home_layouts_insert on public.crm_home_layouts;
create policy crm_home_layouts_insert on public.crm_home_layouts
  for insert to authenticated
  with check (
    deleted_at is null
    and (select public.crm_is_active_user())
    and (select public.crm_has_permission('home', 'view'))
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and case scope
      when 'default' then (select public.crm_is_admin())
      when 'team' then (select public.crm_is_admin()) or public.crm_manages_team(team_id)
      else user_id = (select auth.uid())
    end
  );

drop policy if exists crm_home_layouts_update on public.crm_home_layouts;
create policy crm_home_layouts_update on public.crm_home_layouts
  for update to authenticated
  using (
    deleted_at is null
    and case scope
      when 'default' then (select public.crm_is_admin())
      when 'team' then (select public.crm_is_admin()) or public.crm_manages_team(team_id)
      else user_id = (select auth.uid())
    end
  )
  with check (
    (select public.crm_is_active_user())
    and (select public.crm_has_permission('home', 'view'))
    and (owner_id = (select auth.uid()) or (select public.crm_is_admin()))
    and case scope
      when 'default' then (select public.crm_is_admin())
      when 'team' then (select public.crm_is_admin()) or public.crm_manages_team(team_id)
      else user_id = (select auth.uid())
    end
  );

drop policy if exists crm_home_layouts_delete on public.crm_home_layouts;
create policy crm_home_layouts_delete on public.crm_home_layouts
  for delete to authenticated
  using (
    (select public.crm_is_active_user()) and
    case scope
      when 'default' then (select public.crm_is_admin())
      when 'team' then (select public.crm_is_admin()) or public.crm_manages_team(team_id)
      else user_id = (select auth.uid())
    end
  );
