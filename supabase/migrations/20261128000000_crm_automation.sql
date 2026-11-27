-- Automation module: assignment rules, stage tasks, alerts and SLA escalation,
-- in-app notifications. The engine is Postgres (security-definer functions and
-- triggers) so every write path (stage RPC, kanban, convert, import, inbound)
-- is covered, transactional and audited in one place.
--
-- Attribution: automated writes run between crm_automation_begin(ctx) and
-- crm_automation_end(prev), which set/reset the transaction-local GUC
-- crm.actor = 'automation'. crm_set_record_meta, crm_audit_trigger and
-- crm_record_guard read it (created_by/updated_by null, audit actor
-- 'Automation' + context, owner-visibility check skipped).
--
-- Idempotent; no begin/commit (the runner applies the file as one implicit
-- transaction). Order: permissions, schema, shared trigger functions, engine.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Module permission. A silent no-op here would hide the module from admins,
-- so the assertion below raises if a system role lacks the cell.
-- ---------------------------------------------------------------------------
update public.crm_access_control
set matrix = public.crm_add_module_permissions(matrix, 'automation', $json$
{
  "super_admin": "full",
  "sales_manager": ["view"],
  "sales_rep": "none",
  "read_only": "none"
}
$json$::jsonb)
where id;

do $$
begin
  if not exists (select 1 from public.crm_access_control where id) then
    raise exception 'crm_access_control has no matrix row; automation permission not applied';
  end if;
  if exists (
    select 1
    from public.crm_roles r
    cross join public.crm_access_control ac
    where ac.id and r.system
      and r.id in ('super_admin', 'sales_manager', 'sales_rep', 'read_only')
      -- A system role an admin removed from the matrix on purpose stays removed
      -- (crm_add_module_permissions grants only roles that exist); super_admin
      -- must always be present.
      and (ac.matrix ? r.id or r.id = 'super_admin')
      and not coalesce((ac.matrix -> r.id) ? 'automation', false)
  ) then
    raise exception 'automation permission missing for a system role';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit context (kind, rule_id, template_id, triggered_by) for Automation rows
-- ---------------------------------------------------------------------------
alter table public.crm_audit_logs add column if not exists context jsonb;

-- Audit visibility for the new config objects follows automation.view.
-- Copy of 20261119030000 with three extra branches.
drop policy if exists crm_audit_logs_select on public.crm_audit_logs;
create policy crm_audit_logs_select on public.crm_audit_logs
  for select to authenticated
  using (
    (select public.crm_is_admin())
    or (
      (select public.crm_has_permission('audit_logs', 'view'))
      and case object
        when 'setup_stage' then (select public.crm_has_permission('setup_pipeline', 'view'))
        when 'picklist' then (select public.crm_has_permission('setup_picklists', 'view'))
        when 'entity' then (select public.crm_has_permission('setup_companies', 'view'))
        when 'role' then (select public.crm_has_permission('setup_roles', 'view'))
        when 'team' then (select public.crm_has_permission('setup_roles', 'view'))
        when 'user' then (select public.crm_has_permission('setup_users', 'view'))
        when 'access_control' then (select public.crm_has_permission('setup_access', 'view'))
        when 'settings' then (select public.crm_has_permission('setup_lead_assignment', 'view'))
        when 'assignment_rule' then (select public.crm_has_permission('automation', 'view'))
        when 'stage_task' then (select public.crm_has_permission('automation', 'view'))
        when 'alert_rule' then (select public.crm_has_permission('automation', 'view'))
        when 'activity' then record_id is not null and exists (
          select 1 from public.crm_activities a where a.id = crm_audit_logs.record_id
        )
        else record_id is not null and public.crm_can_see_record(object, record_id)
      end
    )
  );

-- ---------------------------------------------------------------------------
-- Schema changes on existing tables
-- ---------------------------------------------------------------------------
-- stage_entered_at: backfilled once from the last stage_change audit row,
-- falling back to created_at. User triggers are disabled for the backfill so
-- it neither bumps updated_at nor writes audit rows.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_opportunities' and column_name = 'stage_entered_at'
  ) then
    alter table public.crm_opportunities add column stage_entered_at timestamptz;
    alter table public.crm_opportunities disable trigger user;
    update public.crm_opportunities o
    set stage_entered_at = coalesce(
      (select max(l.created_at) from public.crm_audit_logs l
       where l.object = 'opportunity' and l.record_id = o.id and l.action = 'stage_change'),
      o.created_at
    );
    alter table public.crm_opportunities enable trigger user;
    alter table public.crm_opportunities alter column stage_entered_at set not null;
  end if;
end;
$$;

-- No default: the BEFORE trigger always fills it (privileged inserts keep created_at).
alter table public.crm_opportunities alter column stage_entered_at drop default;

create index if not exists crm_activities_what_created_idx
  on public.crm_activities (what_object, what_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Config tables. Standard columns so crm_set_record_meta / crm_audit_trigger
-- apply; rows are hard-deleted (audited as 'delete'). owner_id is nullable
-- because seeded and automated rows have no user.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  sort_order integer not null default 100,
  country_codes text[] not null default '{}'::text[] check (cardinality(country_codes) <= 300),
  entity_ids uuid[] not null default '{}'::uuid[] check (cardinality(entity_ids) <= 100),
  sources text[] not null default '{}'::text[] check (cardinality(sources) <= 50),
  target_type text not null check (target_type in ('user', 'round_robin')),
  target_user_id uuid references public.crm_users (id) on delete set null,
  pool_user_ids uuid[] not null default '{}'::uuid[] check (cardinality(pool_user_ids) <= 50),
  stop_processing boolean not null default false,
  notify_assignee boolean not null default true,
  owner_id uuid default auth.uid() references public.crm_users (id) on delete set null,
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_assignment_rules enable row level security;
create index if not exists crm_assignment_rules_order_idx
  on public.crm_assignment_rules (sort_order, id) where active;

-- Round-robin position per rule. No client access, no audit.
create table if not exists public.crm_assignment_cursors (
  rule_id uuid primary key references public.crm_assignment_rules (id) on delete cascade,
  last_user_id uuid references public.crm_users (id) on delete set null
);
alter table public.crm_assignment_cursors enable row level security;

create table if not exists public.crm_stage_task_templates (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.crm_pipeline_stages (id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines (id) on delete cascade,
  subject text not null check (length(trim(subject)) between 1 and 300),
  description text check (description is null or length(description) <= 5000),
  due_in_days integer not null default 0 check (due_in_days between 0 and 365),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_type text not null default 'owner' check (assignee_type in ('owner', 'owner_manager', 'user')),
  assignee_user_id uuid references public.crm_users (id) on delete set null,
  active boolean not null default true,
  sort_order integer not null default 100,
  owner_id uuid default auth.uid() references public.crm_users (id) on delete set null,
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_stage_task_templates enable row level security;
create index if not exists crm_stage_task_templates_stage_idx
  on public.crm_stage_task_templates (stage_id, sort_order, id) where active;

create table if not exists public.crm_alert_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('stalled_deal', 'overdue_task', 'sla_escalation')),
  pipeline_id uuid references public.crm_pipelines (id) on delete cascade,
  stage_id uuid references public.crm_pipeline_stages (id) on delete cascade,
  threshold integer not null default 0 check (threshold between 0 and 3650),
  notify_manager boolean not null default false,
  active boolean not null default true,
  owner_id uuid default auth.uid() references public.crm_users (id) on delete set null,
  created_by uuid references public.crm_users (id) on delete set null,
  updated_by uuid references public.crm_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_alert_rules enable row level security;
-- One rule per (kind, pipeline, stage) scope; the all-null scope is the global default.
create unique index if not exists crm_alert_rules_scope_uq
  on public.crm_alert_rules (
    kind,
    coalesce(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(stage_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Defaults: stalled after 14 days, overdue with no grace, SLA escalation on.
insert into public.crm_alert_rules (kind, threshold, notify_manager, active)
values ('stalled_deal', 14, false, true),
       ('overdue_task', 0, false, true),
       ('sla_escalation', 0, true, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Private and log tables
-- ---------------------------------------------------------------------------
create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_users (id) on delete cascade,
  kind text not null check (kind in ('sla_escalation', 'stalled_deal', 'overdue_task', 'task_assigned', 'lead_assigned')),
  params jsonb not null default '{}'::jsonb check (
    jsonb_typeof(params) = 'object' and octet_length(params::text) <= 4096
  ),
  object text check (object is null or object in ('lead', 'account', 'contact', 'opportunity', 'activity', 'case')),
  record_id uuid,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.crm_notifications enable row level security;
create index if not exists crm_notifications_user_idx
  on public.crm_notifications (user_id, created_at desc, id desc);
create index if not exists crm_notifications_unread_idx
  on public.crm_notifications (user_id) where read_at is null;
create index if not exists crm_notifications_read_retention_idx
  on public.crm_notifications (read_at) where read_at is not null;

create table if not exists public.crm_automation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('pg_cron', 'vercel_cron', 'manual')),
  status text not null check (status in ('ok', 'partial', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  errors jsonb not null default '[]'::jsonb check (
    jsonb_typeof(errors) = 'array' and jsonb_array_length(errors) <= 20
  ),
  triggered_by uuid references public.crm_users (id) on delete set null
);
alter table public.crm_automation_runs enable row level security;
create index if not exists crm_automation_runs_started_idx
  on public.crm_automation_runs (started_at desc);

-- Clients may only mark read: read_at is forced to now() (or kept / null).
create or replace function public.crm_notifications_read_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.crm_is_privileged_session() then
    NEW.read_at := case
      when NEW.read_at is null then null
      when OLD.read_at is not null then OLD.read_at
      else now() end;
  end if;
  return NEW;
end;
$$;
revoke all on function public.crm_notifications_read_at() from public, anon, authenticated;
drop trigger if exists trg_crm_notifications_read_at on public.crm_notifications;
create trigger trg_crm_notifications_read_at
before update on public.crm_notifications
for each row execute function public.crm_notifications_read_at();

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.crm_assignment_rules, public.crm_assignment_cursors,
  public.crm_stage_task_templates, public.crm_alert_rules,
  public.crm_notifications, public.crm_automation_runs from anon, authenticated;
grant select, insert, update, delete on public.crm_assignment_rules,
  public.crm_stage_task_templates, public.crm_alert_rules to authenticated;
grant select on public.crm_automation_runs to authenticated;
-- Notifications: read own rows and mark them read; inserts only via definer functions.
grant select on public.crm_notifications to authenticated;
grant update (read_at) on public.crm_notifications to authenticated;
grant all on public.crm_assignment_rules, public.crm_assignment_cursors,
  public.crm_stage_task_templates, public.crm_alert_rules,
  public.crm_notifications, public.crm_automation_runs to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['crm_assignment_rules', 'crm_stage_task_templates', 'crm_alert_rules'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.crm_has_permission('automation', 'view')))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check ((select public.crm_has_permission('automation', 'create')) and (select public.crm_can_write()))$p$,
      t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using ((select public.crm_has_permission('automation', 'edit')) and (select public.crm_can_write()))
      with check ((select public.crm_has_permission('automation', 'edit')) and (select public.crm_can_write()))$p$,
      t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using ((select public.crm_has_permission('automation', 'delete')) and (select public.crm_can_write()))$p$,
      t || '_delete', t);
  end loop;
end;
$$;

drop policy if exists crm_automation_runs_select on public.crm_automation_runs;
create policy crm_automation_runs_select on public.crm_automation_runs
  for select to authenticated
  using ((select public.crm_has_permission('automation', 'view')));

drop policy if exists crm_notifications_select on public.crm_notifications;
create policy crm_notifications_select on public.crm_notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.crm_is_active_user()));
drop policy if exists crm_notifications_update on public.crm_notifications;
create policy crm_notifications_update on public.crm_notifications
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.crm_is_active_user()))
  with check (user_id = (select auth.uid()));
-- crm_assignment_cursors: RLS on, no policy, no grants: definer functions only.

-- ---------------------------------------------------------------------------
-- Shared trigger functions (copies with the automation branch)
-- ---------------------------------------------------------------------------

-- Copied verbatim from 20261116000300 (crm_set_record_meta); added: v_auto branches.
create or replace function public.crm_set_record_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_privileged boolean := public.crm_is_privileged_session();
  v_auto boolean := coalesce(current_setting('crm.actor', true), '') = 'automation';
begin
  if TG_OP = 'INSERT' then
    if not v_privileged then
      NEW.created_at := now();
      NEW.updated_at := NEW.created_at;
      NEW.created_by := case when v_auto then null else v_uid end;
      NEW.updated_by := case when v_auto then null else v_uid end;
      NEW.deleted_at := null;
      NEW.deleted_by := null;
    else
      -- Service role (seed, inbound, imports) may backdate created_at.
      NEW.created_at := coalesce(NEW.created_at, now());
      NEW.updated_at := greatest(coalesce(NEW.updated_at, NEW.created_at), NEW.created_at);
      NEW.created_by := case when v_auto then null else coalesce(NEW.created_by, v_uid, NEW.owner_id) end;
      NEW.updated_by := case when v_auto then null else coalesce(NEW.updated_by, NEW.created_by) end;
    end if;
    return NEW;
  end if;

  -- UPDATE
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.updated_at := now();
  if v_auto then
    NEW.updated_by := null;
  elsif v_uid is not null then
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

-- Copied verbatim from 20261119010000 (crm_record_guard); added: v_auto skips the owner-visibility check.
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
  -- full_name is generated (null in NEW inside a BEFORE trigger).
  v_toggle constant text[] := array['deleted_at', 'deleted_by', 'updated_at', 'updated_by', 'full_name'];
  v_auto boolean := coalesce(current_setting('crm.actor', true), '') = 'automation';
begin
  if public.crm_is_privileged_session() then
    return NEW;
  end if;

  -- Automated activities are written only by the definer engine: a direct
  -- client write cannot claim an automation key or edit meta.automation.
  if v_object = 'activity' and current_user = 'authenticated' then
    if (v_new ->> 'external_ref') like 'automation:%'
       and (v_new -> 'external_ref') is distinct from (v_old -> 'external_ref') then
      raise exception 'Reserved external_ref' using errcode = '42501';
    end if;
    if (v_new -> 'meta' -> 'automation') is distinct from (v_old -> 'meta' -> 'automation') then
      raise exception 'meta.automation is reserved' using errcode = '42501';
    end if;
  end if;

  if v_object = 'lead'
     and TG_OP = 'UPDATE'
     and current_user = 'authenticated'
     and (v_old ->> 'converted_at') is not null
     and not ((v_new -> 'deleted_at') is distinct from (v_old -> 'deleted_at')
              and (v_new - v_toggle) = (v_old - v_toggle)) then
    raise exception 'lead_converted' using errcode = 'P0001';
  end if;

  if TG_OP = 'UPDATE'
     and NEW.owner_id is distinct from OLD.owner_id
     and not v_auto
     and not public.crm_can_see(NEW.owner_id) then
    raise exception 'You cannot assign this record to that owner' using errcode = '42501';
  end if;

  v_refs := case v_object
    when 'account' then array[['parent_account_id', 'account']]
    when 'contact' then array[['account_id', 'account']]
    when 'opportunity' then array[['account_id', 'account'], ['primary_contact_id', 'contact']]
    when 'activity' then array[['who_contact_id', 'contact']]
    when 'case' then array[['account_id', 'account'], ['contact_id', 'contact']]
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

-- Copied verbatim from 20261119010000 (crm_audit_trigger); added: v_auto/v_ctx attribution, context column,
-- 'stage_entered_at' in v_skip.
create or replace function public.crm_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_object text := TG_ARGV[0];
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_action text;
  v_actor uuid;
  v_actor_name text;
  v_key text;
  v_auto boolean := coalesce(current_setting('crm.actor', true), '') = 'automation';
  v_ctx jsonb;
  v_record_id uuid;
  v_record_key text;
  k text;
  v_skip constant text[] := array['updated_at', 'updated_by', 'raw_payload', 'stage_entered_at'];
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(OLD);
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(NEW);
  end if;
  v_row := coalesce(v_new, v_old);

  if v_object = 'email_account' then
    -- Preserve credential-rotation events without retaining either ciphertext.
    if v_old is not null and v_new is not null
       and (v_old -> 'password_encrypted') is distinct from (v_new -> 'password_encrypted') then
      v_old := jsonb_set(v_old, '{password_encrypted}', '"[redacted]"'::jsonb);
      v_new := jsonb_set(v_new, '{password_encrypted}', '"[redacted, changed]"'::jsonb);
    else
      if v_old is not null then v_old := jsonb_set(v_old, '{password_encrypted}', '"[redacted]"'::jsonb); end if;
      if v_new is not null then v_new := jsonb_set(v_new, '{password_encrypted}', '"[redacted]"'::jsonb); end if;
    end if;
    v_row := coalesce(v_new, v_old);
  end if;

  if v_object = 'settings' then
    if (v_row ->> 'key') = 'inbound_rr_cursor' then
      return null;
    end if;
    if coalesce((v_old ->> 'admin_only')::boolean, false)
       or coalesce((v_new ->> 'admin_only')::boolean, false) then
      -- Keep "changed" detectable without storing the value.
      if v_old is not null and v_new is not null
         and (v_old -> 'value') is distinct from (v_new -> 'value') then
        v_old := jsonb_set(v_old, '{value}', '"[redacted]"'::jsonb);
        v_new := jsonb_set(v_new, '{value}', '"[redacted, changed]"'::jsonb);
      else
        if v_old is not null then
          v_old := jsonb_set(v_old, '{value}', '"[redacted]"'::jsonb);
        end if;
        if v_new is not null then
          v_new := jsonb_set(v_new, '{value}', '"[redacted]"'::jsonb);
        end if;
      end if;
      v_row := coalesce(v_new, v_old);
    end if;
  end if;

  if TG_OP = 'INSERT' then
    v_action := 'create';
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any (v_skip)) and jsonb_typeof(v_new -> k) <> 'null' then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array('null'::jsonb, v_new -> k));
      end if;
    end loop;

  elsif TG_OP = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any (v_skip)) and (v_new -> k) is distinct from (v_old -> k) then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;

    if v_diff = '{}'::jsonb then
      return null;
    end if;

    if v_diff ? 'deleted_at' and (v_old ->> 'deleted_at') is null then
      v_action := 'delete';
    elsif v_diff ? 'deleted_at' and (v_new ->> 'deleted_at') is null then
      v_action := 'restore';
    elsif v_diff ? 'converted_at' and (v_old ->> 'converted_at') is null then
      v_action := 'convert';
    elsif v_diff ? 'stage_id' then
      v_action := 'stage_change';
    elsif v_object = 'lead' and v_diff ? 'status' then
      v_action := 'stage_change';
    elsif v_diff ? 'owner_id' then
      v_action := 'owner_change';
    else
      v_action := 'update';
    end if;

  else -- DELETE (hard delete: service role, or config rows deleted by an admin)
    v_action := 'delete';
    for k in select jsonb_object_keys(v_old) loop
      if not (k = any (v_skip)) and jsonb_typeof(v_old -> k) <> 'null' then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(v_old -> k, 'null'::jsonb));
      end if;
    end loop;
  end if;

  v_key := case
    when v_object = 'access_control' then 'matrix'
    when v_object = 'settings' then v_row ->> 'key'
    else v_row ->> 'id'
  end;
  if v_key ~ v_uuid_re then
    v_record_id := v_key::uuid;
  else
    v_record_key := v_key;
  end if;

  -- Automated writes (see crm_automation_begin) and inbound lead inserts
  -- (entry in crm.inbound_ctx set by crm_lead_assign_owner) are attributed to Automation.
  if not v_auto and v_object = 'lead' and TG_OP = 'INSERT' then
    begin
      select e - 'id' into v_ctx
      from jsonb_array_elements(coalesce(nullif(current_setting('crm.inbound_ctx', true), '')::jsonb, '[]'::jsonb)) e
      where e ->> 'id' = v_row ->> 'id'
      limit 1;
    exception when others then
      v_ctx := null;
    end;
    if v_ctx is not null then
      v_auto := true;
    end if;
  elsif v_auto then
    begin
      v_ctx := nullif(current_setting('crm.automation_ctx', true), '')::jsonb;
    exception when others then
      v_ctx := null;
    end;
  end if;

  if not v_auto then
    v_actor := coalesce(
      auth.uid(),
      case when (v_row ->> 'updated_by') ~ v_uuid_re then (v_row ->> 'updated_by')::uuid end,
      case when (v_row ->> 'created_by') ~ v_uuid_re then (v_row ->> 'created_by')::uuid end
    );

    if v_actor is not null then
      select coalesce(nullif(trim(u.full_name), ''), u.email)
      into v_actor_name
      from public.crm_users u
      where u.id = v_actor;
    end if;
  end if;

  insert into public.crm_audit_logs (actor_id, actor_name, object, record_id, record_key, owner_id, action, diff, context)
  values (
    v_actor,
    case when v_auto then 'Automation' else coalesce(v_actor_name, 'system') end,
    v_object,
    v_record_id,
    v_record_key,
    case when (v_row ->> 'owner_id') ~ v_uuid_re then (v_row ->> 'owner_id')::uuid end,
    v_action,
    v_diff,
    case when v_auto then v_ctx end
  );

  return null;
end;
$$;

revoke all on function public.crm_audit_trigger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Meta + audit triggers on the config tables
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crm_assignment_rules_meta on public.crm_assignment_rules;
create trigger trg_crm_assignment_rules_meta
before insert or update on public.crm_assignment_rules
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_assignment_rules_audit on public.crm_assignment_rules;
create trigger trg_crm_assignment_rules_audit
after insert or update or delete on public.crm_assignment_rules
for each row execute function public.crm_audit_trigger('assignment_rule');

drop trigger if exists trg_crm_stage_task_templates_meta on public.crm_stage_task_templates;
create trigger trg_crm_stage_task_templates_meta
before insert or update on public.crm_stage_task_templates
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_stage_task_templates_audit on public.crm_stage_task_templates;
create trigger trg_crm_stage_task_templates_audit
after insert or update or delete on public.crm_stage_task_templates
for each row execute function public.crm_audit_trigger('stage_task');

drop trigger if exists trg_crm_alert_rules_meta on public.crm_alert_rules;
create trigger trg_crm_alert_rules_meta
before insert or update on public.crm_alert_rules
for each row execute function public.crm_set_record_meta();
drop trigger if exists trg_crm_alert_rules_audit on public.crm_alert_rules;
create trigger trg_crm_alert_rules_audit
after insert or update or delete on public.crm_alert_rules
for each row execute function public.crm_audit_trigger('alert_rule');

-- A template's stage must belong to its pipeline.
create or replace function public.crm_stage_task_template_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.crm_pipeline_stages s
    where s.id = NEW.stage_id and s.pipeline_id = NEW.pipeline_id
  ) then
    raise exception 'Stage does not belong to the pipeline' using errcode = '23514';
  end if;
  return NEW;
end;
$$;
revoke all on function public.crm_stage_task_template_check() from public, anon, authenticated;
drop trigger if exists trg_crm_stage_task_templates_check on public.crm_stage_task_templates;
create trigger trg_crm_stage_task_templates_check
before insert or update on public.crm_stage_task_templates
for each row execute function public.crm_stage_task_template_check();

-- ---------------------------------------------------------------------------
-- Attribution: begin/end set and restore the transaction-local GUC. Only these
-- two functions set crm.actor; both are revoked from clients.
-- ---------------------------------------------------------------------------
create or replace function public.crm_automation_begin(p_ctx jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb := jsonb_build_object(
    'actor', coalesce(current_setting('crm.actor', true), ''),
    'ctx', coalesce(current_setting('crm.automation_ctx', true), '')
  );
begin
  perform set_config('crm.actor', 'automation', true);
  perform set_config('crm.automation_ctx', coalesce(p_ctx, '{}'::jsonb)::text, true);
  return v_prev;
end;
$$;

create or replace function public.crm_automation_end(p_prev jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('crm.actor', coalesce(p_prev ->> 'actor', ''), true);
  perform set_config('crm.automation_ctx', coalesce(p_prev ->> 'ctx', ''), true);
end;
$$;
revoke all on function public.crm_automation_begin(jsonb) from public, anon, authenticated;
revoke all on function public.crm_automation_end(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_label(p_first text, p_last text, p_company text, p_email text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(trim(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), ''),
    nullif(trim(p_company), ''), p_email, 'Lead');
$$;

-- Active manager of the user's team (null when none or the user manages it).
create or replace function public.crm_user_manager(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.manager_id
  from public.crm_users u
  join public.crm_teams t on t.id = u.team_id
  join public.crm_users m on m.id = t.manager_id and m.status = 'active'
  where u.id = p_user and t.manager_id <> p_user;
$$;

-- Active user that can write (eligible to own records).
create or replace function public.crm_user_can_own(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.crm_users u
    join public.crm_roles r on r.id = u.role
    where u.id = p_user and u.status = 'active' and r.can_write
  );
$$;

-- Manager, else the active default owner, else the oldest active super_admin.
create or replace function public.crm_escalation_target(p_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid := public.crm_user_manager(p_user);
  v_raw text;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_target is not null then
    return v_target;
  end if;
  select value #>> '{}' into v_raw from public.crm_settings where key = 'inbound_default_owner';
  if v_raw ~ v_uuid_re then
    select u.id into v_target from public.crm_users u where u.id = v_raw::uuid and u.status = 'active';
    if v_target is not null then
      return v_target;
    end if;
  end if;
  select u.id into v_target
  from public.crm_users u
  where u.role = 'super_admin' and u.status = 'active'
  order by u.created_at, u.id
  limit 1;
  return v_target;
end;
$$;

-- Insert a notification for an active user. Returns false when the dedupe key
-- already exists or the user is inactive. Definer-only: clients cannot insert.
create or replace function public.crm_notify(
  p_user uuid, p_kind text, p_params jsonb, p_object text, p_record uuid, p_dedupe text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_user is null or not exists (
    select 1 from public.crm_users u where u.id = p_user and u.status = 'active'
  ) then
    return false;
  end if;
  insert into public.crm_notifications (user_id, kind, params, object, record_id, dedupe_key)
  values (p_user, p_kind, coalesce(p_params, '{}'::jsonb), p_object, p_record, p_dedupe)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.crm_lead_label(text, text, text, text) from public, anon, authenticated;
revoke all on function public.crm_user_manager(uuid) from public, anon, authenticated;
revoke all on function public.crm_user_can_own(uuid) from public, anon, authenticated;
revoke all on function public.crm_escalation_target(uuid) from public, anon, authenticated;
revoke all on function public.crm_notify(uuid, text, jsonb, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fallback owner: the body of crm_assign_inbound_owner (000600), with p_advance
-- = false for previews (no cursor write, no row lock). via: 'default' for
-- round-robin / configured default owner, 'super_admin' for the last resort.
-- ---------------------------------------------------------------------------
create or replace function public.crm_assign_fallback_owner(p_advance boolean default true)
returns table (owner_id uuid, via text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_mode text;
  v_cursor_raw text;
  v_cursor uuid;
  v_next uuid;
  v_default_raw text;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_advance then
    insert into public.crm_settings (key, value, admin_only)
    values ('inbound_rr_cursor', 'null'::jsonb, true)
    on conflict (key) do nothing;

    select value #>> '{}' into v_cursor_raw
    from public.crm_settings
    where key = 'inbound_rr_cursor'
    for update;
  else
    select value #>> '{}' into v_cursor_raw
    from public.crm_settings
    where key = 'inbound_rr_cursor';
  end if;

  select coalesce(value ->> 'mode', 'round_robin') into v_mode
  from public.crm_settings
  where key = 'inbound_assignment';
  v_mode := coalesce(v_mode, 'round_robin');

  if v_mode = 'round_robin' then
    if v_cursor_raw ~ v_uuid_re then
      v_cursor := v_cursor_raw::uuid;
    end if;

    select u.id into v_next
    from public.crm_users u
    join public.crm_roles r on r.id = u.role
    where u.status = 'active' and u.receives_inbound and r.can_write
      and (v_cursor is null or u.id > v_cursor)
    order by u.id
    limit 1;

    if v_next is null then
      select u.id into v_next
      from public.crm_users u
      join public.crm_roles r on r.id = u.role
      where u.status = 'active' and u.receives_inbound and r.can_write
      order by u.id
      limit 1;
    end if;

    if v_next is not null then
      if p_advance then
        update public.crm_settings
        set value = to_jsonb(v_next::text)
        where key = 'inbound_rr_cursor';
      end if;
      owner_id := v_next; via := 'default';
      return next;
      return;
    end if;
  end if;

  select value #>> '{}' into v_default_raw
  from public.crm_settings
  where key = 'inbound_default_owner';

  if v_default_raw ~ v_uuid_re then
    select u.id into v_next
    from public.crm_users u
    where u.id = v_default_raw::uuid and u.status = 'active';
    if v_next is not null then
      owner_id := v_next; via := 'default';
      return next;
      return;
    end if;
  end if;

  select u.id into v_next
  from public.crm_users u
  where u.role = 'super_admin' and u.status = 'active'
  order by u.created_at, u.id
  limit 1;

  owner_id := v_next; via := 'super_admin';
  return next;
end;
$$;

-- Compatibility wrapper (service role only, as before).
create or replace function public.crm_assign_inbound_owner()
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select f.owner_id from public.crm_assign_fallback_owner(true) f;
$$;
revoke all on function public.crm_assign_fallback_owner(boolean) from public, anon, authenticated;
revoke all on function public.crm_assign_inbound_owner() from public, anon, authenticated;
grant execute on function public.crm_assign_inbound_owner() to service_role;

-- ---------------------------------------------------------------------------
-- Rule matching (mirrored by src/lib/crm/automation/matching.ts). Internal only.
-- Rules in sort_order, id order; empty criterion = any; null never matches a
-- non-empty one; countries compare case-insensitively. A matching rule without
-- an eligible assignee: stop_processing falls back, otherwise the next rule.
-- p_advance = false (preview) neither locks nor moves the cursor.
-- ---------------------------------------------------------------------------
create or replace function public.crm_assign_lead_owner(
  p_country text, p_entity uuid, p_source text, p_advance boolean default true
)
returns table (owner_id uuid, rule_id uuid, via text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_rule public.crm_assignment_rules%rowtype;
  v_assignee uuid;
  v_via text;
  v_last uuid;
  v_pool uuid[];
  v_len integer;
  v_start integer;
  i integer;
  v_cand uuid;
begin
  for v_rule in
    select r.* from public.crm_assignment_rules r where r.active order by r.sort_order, r.id
  loop
    if cardinality(v_rule.country_codes) > 0 and (
         p_country is null
         or not exists (select 1 from unnest(v_rule.country_codes) c where upper(c) = upper(p_country))
       ) then
      continue;
    end if;
    if cardinality(v_rule.entity_ids) > 0 and (p_entity is null or not (p_entity = any (v_rule.entity_ids))) then
      continue;
    end if;
    if cardinality(v_rule.sources) > 0 and (
         p_source is null or p_source = '' or not (p_source = any (v_rule.sources))
       ) then
      continue;
    end if;

    v_assignee := null;
    if v_rule.target_type = 'user' then
      v_via := 'rule';
      if v_rule.target_user_id is not null and public.crm_user_can_own(v_rule.target_user_id) then
        v_assignee := v_rule.target_user_id;
      end if;
    else
      v_via := 'round_robin';
      if p_advance then
        insert into public.crm_assignment_cursors (rule_id) values (v_rule.id) on conflict do nothing;
        select c.last_user_id into v_last
        from public.crm_assignment_cursors c where c.rule_id = v_rule.id for update;
      else
        select c.last_user_id into v_last
        from public.crm_assignment_cursors c where c.rule_id = v_rule.id;
      end if;
      v_pool := v_rule.pool_user_ids;
      v_len := cardinality(v_pool);
      v_start := coalesce(array_position(v_pool, v_last), 0);
      for i in 0 .. coalesce(v_len, 0) - 1 loop
        v_cand := v_pool[((v_start + i) % v_len) + 1];
        if public.crm_user_can_own(v_cand) then
          v_assignee := v_cand;
          exit;
        end if;
      end loop;
      if v_assignee is not null and p_advance then
        update public.crm_assignment_cursors c set last_user_id = v_assignee where c.rule_id = v_rule.id;
      end if;
    end if;

    if v_assignee is not null then
      owner_id := v_assignee; rule_id := v_rule.id; via := v_via;
      return next;
      return;
    end if;
    if v_rule.stop_processing then
      exit;
    end if;
  end loop;

  select f.owner_id, f.via into owner_id, via from public.crm_assign_fallback_owner(p_advance) f;
  rule_id := null;
  return next;
end;
$$;
revoke all on function public.crm_assign_lead_owner(text, uuid, text, boolean) from public, anon, authenticated;

-- Free-form preview for the rule editor: automation.view only, rate limited,
-- cursor untouched. (A rollback after a failed check also rolls the hit back;
-- these failures happen before any data is read, so nothing is leaked.)
create or replace function public.crm_assignment_preview(p_country text, p_entity uuid, p_source text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_res record;
begin
  if auth.uid() is null or not public.crm_is_active_user()
     or not public.crm_has_permission('automation', 'view') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.crm_rate_limit_hit('automation.preview', 60, 60) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  select * into v_res from public.crm_assign_lead_owner(p_country, p_entity, p_source, false);
  return jsonb_build_object('owner_id', v_res.owner_id, 'rule_id', v_res.rule_id, 'via', v_res.via);
end;
$$;
revoke all on function public.crm_assignment_preview(text, uuid, text) from public, anon;
grant execute on function public.crm_assignment_preview(text, uuid, text) to authenticated, service_role;

-- "Reassign" confirmation: leads.edit on a lead the caller can see; returns
-- only {owner_id, via}. Invisible and missing leads are indistinguishable.
create or replace function public.crm_assignment_preview_for_lead(p_lead_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.crm_leads%rowtype;
  v_res record;
begin
  if auth.uid() is null or not public.crm_is_active_user()
     or not public.crm_has_permission('leads', 'edit') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.crm_rate_limit_hit('automation.preview', 60, 60) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  select * into v_lead from public.crm_leads where id = p_lead_id and deleted_at is null;
  if not found or not public.crm_can_see_record('lead', p_lead_id) then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
  select * into v_res
  from public.crm_assign_lead_owner(v_lead.country_code::text, v_lead.entity_id, v_lead.source, false);
  return jsonb_build_object('owner_id', v_res.owner_id, 'via', v_res.via);
end;
$$;
revoke all on function public.crm_assignment_preview_for_lead(uuid) from public, anon;
grant execute on function public.crm_assignment_preview_for_lead(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Inbound (and any privileged insert) without owner: assign by rules.
-- Fires before the meta trigger (name order) so created_by follows the owner.
-- crm.inbound_ctx lets the audit trigger attribute the INSERT to Automation;
-- crm_lead_assign_owner_end removes the row's entry right after the audit row.
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_assign_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res record;
  v_rule record;
begin
  if NEW.owner_id is not null or not public.crm_is_privileged_session() then
    return NEW;
  end if;
  select * into v_res from public.crm_assign_lead_owner(NEW.country_code::text, NEW.entity_id, NEW.source, true);
  if v_res.owner_id is null then
    return NEW;
  end if;
  NEW.owner_id := v_res.owner_id;
  select r.name, r.notify_assignee into v_rule from public.crm_assignment_rules r where r.id = v_res.rule_id;
  -- One fixed key holding every pending entry of the statement (multi-row inserts).
  perform set_config('crm.inbound_ctx', (
    coalesce(nullif(current_setting('crm.inbound_ctx', true), '')::jsonb, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'id', NEW.id, 'kind', 'assignment', 'rule_id', v_res.rule_id, 'rule_name', v_rule.name,
      'via', v_res.via, 'triggered_by', 'inbound'))
  )::text, true);
  if coalesce(v_rule.notify_assignee, true) then
    perform public.crm_notify(
      v_res.owner_id, 'lead_assigned',
      jsonb_build_object('name', public.crm_lead_label(NEW.first_name, NEW.last_name, NEW.company, NEW.email)),
      'lead', NEW.id, null);
  end if;
  return NEW;
end;
$$;

create or replace function public.crm_lead_assign_owner_end()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rest jsonb;
begin
  if coalesce(current_setting('crm.inbound_ctx', true), '') <> '' then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rest
    from jsonb_array_elements(current_setting('crm.inbound_ctx', true)::jsonb) e
    where e ->> 'id' <> NEW.id::text;
    perform set_config('crm.inbound_ctx', case when v_rest = '[]'::jsonb then '' else v_rest::text end, true);
  end if;
  return null;
end;
$$;
revoke all on function public.crm_lead_assign_owner() from public, anon, authenticated;
revoke all on function public.crm_lead_assign_owner_end() from public, anon, authenticated;

drop trigger if exists trg_crm_leads_assign_owner on public.crm_leads;
create trigger trg_crm_leads_assign_owner
before insert on public.crm_leads
for each row when (NEW.owner_id is null)
execute function public.crm_lead_assign_owner();
-- Sorts after trg_crm_leads_audit, so the audit row still sees the key.
drop trigger if exists trg_crm_leads_automation_end on public.crm_leads;
create trigger trg_crm_leads_automation_end
after insert on public.crm_leads
for each row execute function public.crm_lead_assign_owner_end();

-- ---------------------------------------------------------------------------
-- Manual opt-in / "Reassign using rules". Re-checks everything: the definer
-- body bypasses RLS.
-- ---------------------------------------------------------------------------
create or replace function public.crm_apply_assignment_rules(p_lead_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.crm_leads%rowtype;
  v_res record;
  v_rule record;
  v_prev jsonb;
begin
  if v_uid is null or not public.crm_is_active_user() or not public.crm_can_write()
     or not public.crm_has_permission('leads', 'edit') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- The hit is taken first, but a later raise rolls it back with the rest of
  -- the call (no autonomous transaction). Accepted: missing and invisible leads
  -- both give P0002, so repeated failing calls reveal nothing.
  if not public.crm_rate_limit_hit('automation.assign', 30, 60) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select * into v_lead from public.crm_leads where id = p_lead_id and deleted_at is null for update;
  if not found or not public.crm_can_see(v_lead.owner_id) then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
  if v_lead.converted_at is not null then
    raise exception 'lead_converted' using errcode = 'P0001';
  end if;

  -- Compute without moving the cursor; advance only when the owner changes.
  select * into v_res
  from public.crm_assign_lead_owner(v_lead.country_code::text, v_lead.entity_id, v_lead.source, false);
  if v_res.owner_id is distinct from v_lead.owner_id then
    select * into v_res
    from public.crm_assign_lead_owner(v_lead.country_code::text, v_lead.entity_id, v_lead.source, true);
  end if;
  if v_res.owner_id is null then
    raise exception 'no_assignee' using errcode = 'P0001';
  end if;
  select r.name, r.notify_assignee into v_rule from public.crm_assignment_rules r where r.id = v_res.rule_id;

  if v_res.owner_id is distinct from v_lead.owner_id then
    v_prev := public.crm_automation_begin(jsonb_build_object(
      'kind', 'assignment', 'rule_id', v_res.rule_id, 'rule_name', v_rule.name,
      'via', v_res.via, 'triggered_by', v_uid));
    update public.crm_leads set owner_id = v_res.owner_id where id = v_lead.id;
    perform public.crm_automation_end(v_prev);
    if v_res.owner_id <> v_uid and coalesce(v_rule.notify_assignee, true) then
      perform public.crm_notify(
        v_res.owner_id, 'lead_assigned',
        jsonb_build_object('name', public.crm_lead_label(v_lead.first_name, v_lead.last_name, v_lead.company, v_lead.email)),
        'lead', v_lead.id, null);
    end if;
  end if;
  return jsonb_build_object('owner_id', v_res.owner_id, 'rule_id', v_res.rule_id, 'via', v_res.via);
end;
$$;
revoke all on function public.crm_apply_assignment_rules(uuid) from public, anon;
grant execute on function public.crm_apply_assignment_rules(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- stage_entered_at (BEFORE) and stage tasks (AFTER)
-- ---------------------------------------------------------------------------
create or replace function public.crm_opportunity_stage_entered()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    NEW.stage_entered_at := case
      when public.crm_is_privileged_session() then coalesce(NEW.stage_entered_at, NEW.created_at)
      else NEW.created_at end;
  elsif NEW.stage_id is distinct from OLD.stage_id then
    NEW.stage_entered_at := clock_timestamp();
  elsif public.crm_is_privileged_session() then
    NEW.stage_entered_at := coalesce(NEW.stage_entered_at, OLD.stage_entered_at);
  else
    NEW.stage_entered_at := OLD.stage_entered_at;
  end if;
  return NEW;
end;
$$;
revoke all on function public.crm_opportunity_stage_entered() from public, anon, authenticated;
drop trigger if exists trg_crm_opportunities_stage_entered on public.crm_opportunities;
create trigger trg_crm_opportunities_stage_entered
before insert or update on public.crm_opportunities
for each row execute function public.crm_opportunity_stage_entered();

create or replace function public.crm_opportunity_stage_tasks()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t public.crm_stage_task_templates%rowtype;
  v_assignee uuid;
  v_id uuid;
  v_prev jsonb;
  v_epoch text;
begin
  if NEW.deleted_at is not null then
    return null;
  end if;
  if TG_OP = 'UPDATE' and NEW.stage_id is not distinct from OLD.stage_id then
    return null;
  end if;
  v_epoch := (extract(epoch from NEW.stage_entered_at) * 1000000)::bigint::text;

  for t in
    select * from public.crm_stage_task_templates x
    where x.stage_id = NEW.stage_id and x.active
    order by x.sort_order, x.id
  loop
    v_assignee := case t.assignee_type
      when 'owner_manager' then coalesce(public.crm_user_manager(NEW.owner_id), NEW.owner_id)
      when 'user' then case when t.assignee_user_id is not null and public.crm_user_can_own(t.assignee_user_id)
                            then t.assignee_user_id else NEW.owner_id end
      else NEW.owner_id end;

    v_id := null;
    v_prev := public.crm_automation_begin(jsonb_build_object(
      'kind', 'stage_task', 'template_id', t.id, 'template_name', t.subject, 'triggered_by', auth.uid()));
    insert into public.crm_activities (
      type, subject, body, status, priority, due_at, what_object, what_id, owner_id, meta, external_ref
    ) values (
      'task', t.subject, t.description, 'open', t.priority,
      now() + make_interval(days => t.due_in_days), 'opportunity', NEW.id, v_assignee,
      jsonb_build_object('automation', jsonb_build_object('kind', 'stage_task', 'template_id', t.id)),
      'automation:stage:' || t.id::text || ':' || NEW.id::text || ':' || v_epoch
    )
    on conflict (external_ref) where external_ref is not null do nothing
    returning id into v_id;
    perform public.crm_automation_end(v_prev);

    if v_id is not null and v_assignee is distinct from auth.uid() then
      perform public.crm_notify(v_assignee, 'task_assigned', jsonb_build_object('subject', t.subject),
        'opportunity', NEW.id, 'task_assigned:' || v_id::text);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.crm_opportunity_stage_tasks() from public, anon, authenticated;
drop trigger if exists trg_crm_opportunities_stage_tasks on public.crm_opportunities;
create trigger trg_crm_opportunities_stage_tasks
after insert or update of stage_id on public.crm_opportunities
for each row execute function public.crm_opportunity_stage_tasks();

-- ---------------------------------------------------------------------------
-- First response: a done call or meeting, or an outbound email (no
-- meta.direction = 'inbound'), stamps first_responded_at on a new lead.
-- ---------------------------------------------------------------------------
create or replace function public.crm_activity_first_response()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  if NEW.what_object is distinct from 'lead' or NEW.deleted_at is not null or NEW.status <> 'done'
     or not (NEW.type in ('call', 'meeting')
             or (NEW.type = 'email' and coalesce(NEW.meta ->> 'direction', 'outbound') <> 'inbound')) then
    return null;
  end if;
  if not exists (
    select 1 from public.crm_leads l
    where l.id = NEW.what_id and l.status = 'new' and l.first_responded_at is null and l.deleted_at is null
  ) then
    return null;
  end if;
  v_prev := public.crm_automation_begin(jsonb_build_object(
    'kind', 'first_response', 'triggered_by', auth.uid()));
  update public.crm_leads
  set first_responded_at = least(greatest(coalesce(NEW.completed_at, now()), created_at), now())
  where id = NEW.what_id and status = 'new' and first_responded_at is null and deleted_at is null;
  perform public.crm_automation_end(v_prev);
  return null;
end;
$$;
revoke all on function public.crm_activity_first_response() from public, anon, authenticated;
drop trigger if exists trg_crm_activities_first_response on public.crm_activities;
create trigger trg_crm_activities_first_response
after insert or update of status on public.crm_activities
for each row execute function public.crm_activity_first_response();

-- ---------------------------------------------------------------------------
-- Reordering (pattern of crm_reorder_picklist; invoker, so RLS applies too)
-- ---------------------------------------------------------------------------
create or replace function public.crm_reorder_assignment_rules(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not (public.crm_has_permission('automation', 'edit') and public.crm_can_write()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_ids is null
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select coalesce(array_agg(id order by id), '{}') from public.crm_assignment_rules)
        is distinct from
        (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'ids must list every rule exactly once' using errcode = '22023';
  end if;
  update public.crm_assignment_rules r
  set sort_order = o.ord * 10
  from unnest(p_ids) with ordinality as o(id, ord)
  where r.id = o.id;
end;
$$;

-- ids must be every template of one stage.
create or replace function public.crm_reorder_stage_task_templates(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stage uuid;
begin
  if not (public.crm_has_permission('automation', 'edit') and public.crm_can_write()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'ids must list every template of the stage exactly once' using errcode = '22023';
  end if;
  select stage_id into v_stage from public.crm_stage_task_templates where id = p_ids[1];
  if v_stage is null
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select coalesce(array_agg(id order by id), '{}') from public.crm_stage_task_templates
           where stage_id = v_stage)
        is distinct from
        (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'ids must list every template of the stage exactly once' using errcode = '22023';
  end if;
  update public.crm_stage_task_templates t
  set sort_order = o.ord * 10
  from unnest(p_ids) with ordinality as o(id, ord)
  where t.id = o.id;
end;
$$;
revoke all on function public.crm_reorder_assignment_rules(uuid[]) from public, anon;
revoke all on function public.crm_reorder_stage_task_templates(uuid[]) from public, anon;
grant execute on function public.crm_reorder_assignment_rules(uuid[]) to authenticated, service_role;
grant execute on function public.crm_reorder_stage_task_templates(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Runner (service role / pg_cron only). One advisory lock; each section in its
-- own exception block; <= 500 items per kind. Counts = items detected in the
-- run (already-alerted ones are deduped, so a second run creates nothing).
-- ---------------------------------------------------------------------------
create or replace function public.crm_run_automation(
  p_now timestamptz default now(),
  p_trigger text default 'manual',
  p_actor uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_errors jsonb := '[]'::jsonb;
  v_failed integer := 0;
  v_stalled integer := 0;
  v_overdue integer := 0;
  v_sla integer := 0;
  v_status text;
  v_run public.crm_automation_runs%rowtype;
  r record;
  v_rule record;
  v_mgr uuid;
  v_prev jsonb;
  v_id uuid;
  v_target uuid;
  v_epoch text;
  v_sla_hours numeric;
  v_raw jsonb;
  v_by text := coalesce(p_actor::text, p_trigger);
begin
  if p_trigger not in ('pg_cron', 'vercel_cron', 'manual') then
    raise exception 'invalid trigger' using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('crm_run_automation', 0)) then
    insert into public.crm_automation_runs (trigger, status, started_at, finished_at, triggered_by)
    values (p_trigger, 'skipped', v_started, clock_timestamp(), p_actor)
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  -- Stalled deals
  begin
    for r in
      with open_opps as (
        select o.id, o.name, o.owner_id, o.stage_id, o.pipeline_id,
          greatest(o.stage_entered_at, coalesce((
            select max(a.created_at) from public.crm_activities a
            where a.what_object = 'opportunity' and a.what_id = o.id and a.deleted_at is null
              and not (a.meta ? 'automation')
          ), o.stage_entered_at)) as last_touch
        from public.crm_opportunities o
        join public.crm_pipeline_stages s on s.id = o.stage_id
        where o.deleted_at is null and o.closed_at is null and s.kind = 'open'
      ), cand as (
        select oo.*, ar.threshold, ar.notify_manager
        from open_opps oo
        cross join lateral (
          select x.threshold, x.notify_manager, x.active
          from public.crm_alert_rules x
          where x.kind = 'stalled_deal'
            and (x.stage_id = oo.stage_id
                 or (x.stage_id is null and x.pipeline_id = oo.pipeline_id)
                 or (x.stage_id is null and x.pipeline_id is null))
          order by (x.stage_id is not null) desc, (x.pipeline_id is not null) desc
          limit 1
        ) ar
        where ar.active and oo.last_touch <= p_now - make_interval(days => ar.threshold)
      )
      select c.*,
        exists (select 1 from public.crm_notifications n
                where n.dedupe_key = 'stalled:' || c.id::text || ':' || c.owner_id::text || ':'
                      || floor(extract(epoch from c.last_touch))::bigint::text) as already
      from cand c
      order by already, c.last_touch
      limit 500
    loop
      v_stalled := v_stalled + 1;
      v_epoch := floor(extract(epoch from r.last_touch))::bigint::text;
      perform public.crm_notify(r.owner_id, 'stalled_deal',
        jsonb_build_object('name', r.name, 'days', floor(extract(epoch from p_now - r.last_touch) / 86400)::int),
        'opportunity', r.id, 'stalled:' || r.id::text || ':' || r.owner_id::text || ':' || v_epoch);
      if r.notify_manager then
        v_mgr := public.crm_user_manager(r.owner_id);
        if v_mgr is not null and v_mgr <> r.owner_id then
          perform public.crm_notify(v_mgr, 'stalled_deal',
            jsonb_build_object('name', r.name, 'days', floor(extract(epoch from p_now - r.last_touch) / 86400)::int),
            'opportunity', r.id, 'stalled:' || r.id::text || ':' || v_mgr::text || ':' || v_epoch);
        end if;
      end if;
    end loop;
  exception when others then
    v_failed := v_failed + 1;
    raise warning 'crm_run_automation section stalled failed (%): %', sqlstate, sqlerrm;
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('section', 'stalled', 'message', 'SQLSTATE ' || sqlstate));
  end;

  -- Overdue tasks: most specific rule (the task's opportunity stage, then its
  -- pipeline, then global); threshold = grace hours. An inactive most-specific
  -- rule switches the alert off for that scope.
  begin
    for r in
      select a.id, a.subject, a.owner_id, a.due_at,
        coalesce(a.what_object, 'activity') as obj, coalesce(a.what_id, a.id) as rec,
        exists (select 1 from public.crm_notifications n
                where n.dedupe_key = 'overdue:' || a.id::text || ':' || floor(extract(epoch from a.due_at))::bigint::text) as already
      from public.crm_activities a
      left join public.crm_opportunities o on a.what_object = 'opportunity' and o.id = a.what_id
      cross join lateral (
        select x.threshold, x.active
        from public.crm_alert_rules x
        where x.kind = 'overdue_task'
          and ((o.id is not null and x.stage_id = o.stage_id)
               or (x.stage_id is null and o.id is not null and x.pipeline_id = o.pipeline_id)
               or (x.stage_id is null and x.pipeline_id is null))
        order by (x.stage_id is not null) desc, (x.pipeline_id is not null) desc
        limit 1
      ) ar
      where a.type = 'task' and a.status = 'open' and a.deleted_at is null and a.due_at is not null
        and ar.active
        and a.due_at < p_now - make_interval(hours => ar.threshold)
      order by already, a.due_at
      limit 500
    loop
      v_overdue := v_overdue + 1;
      perform public.crm_notify(r.owner_id, 'overdue_task', jsonb_build_object('subject', r.subject),
        r.obj, r.rec, 'overdue:' || r.id::text || ':' || floor(extract(epoch from r.due_at))::bigint::text);
    end loop;
  exception when others then
    v_failed := v_failed + 1;
    raise warning 'crm_run_automation section overdue failed (%): %', sqlstate, sqlerrm;
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('section', 'overdue', 'message', 'SQLSTATE ' || sqlstate));
  end;

  -- SLA escalation: urgent task + notification for the escalation target.
  begin
    select * into v_rule from public.crm_alert_rules
    where kind = 'sla_escalation' and pipeline_id is null and stage_id is null and active;
    if found then
      select value into v_raw from public.crm_settings where key = 'lead_sla_hours';
      begin
        v_sla_hours := (v_raw ->> 'overdue')::numeric;
        if (v_raw ->> 'warning')::numeric <= 0 or v_sla_hours < (v_raw ->> 'warning')::numeric then
          v_sla_hours := 48;
        end if;
      exception when others then
        v_sla_hours := 48;
      end;
      v_sla_hours := coalesce(v_sla_hours, 48);

      for r in
        select l.id, l.owner_id, l.created_at,
          public.crm_lead_label(l.first_name, l.last_name, l.company, l.email) as label,
          exists (select 1 from public.crm_activities a where a.external_ref = 'automation:sla:' || l.id::text) as already
        from public.crm_leads l
        where l.status = 'new' and l.first_responded_at is null and l.deleted_at is null
          and l.converted_at is null
          and l.created_at < p_now - make_interval(secs => v_sla_hours * 3600)
        order by already, l.created_at
        limit 500
      loop
        v_sla := v_sla + 1;
        v_target := public.crm_escalation_target(r.owner_id);
        continue when v_target is null;
        v_id := null;
        v_prev := public.crm_automation_begin(jsonb_build_object(
          'kind', 'sla_escalation', 'rule_id', v_rule.id, 'triggered_by', v_by));
        insert into public.crm_activities (
          type, subject, body, status, priority, due_at, what_object, what_id, owner_id, meta, external_ref
        ) values (
          'task', left('Lead missed first-response SLA: ' || r.label, 300),
          'The lead has had no first response within the SLA.', 'open', 'urgent',
          p_now + interval '1 day', 'lead', r.id, v_target,
          jsonb_build_object('automation', jsonb_build_object(
            'kind', 'sla_escalation', 'rule_id', v_rule.id,
            'subjectKey', 'automation.sla.taskSubject', 'bodyKey', 'automation.sla.taskBody',
            'params', jsonb_build_object('name', r.label))),
          'automation:sla:' || r.id::text
        )
        on conflict (external_ref) where external_ref is not null do nothing
        returning id into v_id;
        perform public.crm_automation_end(v_prev);
        if v_id is not null then
          perform public.crm_notify(v_target, 'sla_escalation',
            jsonb_build_object('name', r.label, 'hours', floor(extract(epoch from p_now - r.created_at) / 3600)::int),
            'lead', r.id, 'sla:' || r.id::text);
        end if;
      end loop;
    end if;
  exception when others then
    v_failed := v_failed + 1;
    raise warning 'crm_run_automation section sla failed (%): %', sqlstate, sqlerrm;
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('section', 'sla', 'message', 'SQLSTATE ' || sqlstate));
  end;

  -- Retention
  begin
    delete from public.crm_notifications where read_at is not null and read_at < p_now - interval '90 days';
    delete from public.crm_automation_runs where started_at < p_now - interval '90 days';
  exception when others then
    v_failed := v_failed + 1;
    raise warning 'crm_run_automation section retention failed (%): %', sqlstate, sqlerrm;
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('section', 'retention', 'message', 'SQLSTATE ' || sqlstate));
  end;

  v_status := case when v_failed = 0 then 'ok' when v_failed >= 4 then 'failed' else 'partial' end;
  insert into public.crm_automation_runs (trigger, status, started_at, finished_at, counts, errors, triggered_by)
  values (p_trigger, v_status, v_started, clock_timestamp(),
    jsonb_build_object('stalled', v_stalled, 'overdue', v_overdue, 'sla', v_sla), v_errors, p_actor)
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;
revoke all on function public.crm_run_automation(timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_run_automation(timestamptz, text, uuid) to service_role;
