-- Oboya CRM 7: v1 fixes.
--   crm_change_opportunity_stage(id, stage, loss_reason?, loss_note?, probability?)
--                                          invoker; one update; returns the row
--   crm_set_account_entities(account, links)   invoker; atomic replace of links
--   crm_create_account(account, links)         invoker; whitelisted insert + links
--   crm_reorder_picklist(picklist, ids[])      admin
--   crm_set_role_permissions(role, perms) / crm_remove_role_permissions(role)
--                                          admin; single-statement matrix edits
--   crm_delete_role(role)                      admin; matrix row + role, atomically
--   crm_record_guard: converted leads are read-only (lead_converted)
--   crm_opportunity_stage_rules: honours crm.keep_probability = 'on'
--   crm_leads.external_ref unique among live (non-deleted) leads only
--   Audit: lead status change -> stage_change; record_key for non-uuid keys;
--          config tables audited; admin_only settings redacted; config audit
--          rows readable by admins or audit_logs.view + the setup_* view.
-- Depends on 000100..000600. Idempotent.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Opportunity stage rules: same as 000300, but the probability reset on a
-- stage change is skipped when crm.keep_probability = 'on' (set locally by
-- crm_change_opportunity_stage when the caller passes an explicit probability).
-- ---------------------------------------------------------------------------
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
  elsif v_stage_changed
        and NEW.probability is not distinct from OLD.probability
        and coalesce(current_setting('crm.keep_probability', true), '') <> 'on' then
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
-- Object row guard: 000300 behaviour, plus converted leads are read-only for
-- client sessions (current_user = 'authenticated'). Only a soft-delete /
-- restore toggle (deleted_at, deleted_by and the meta columns) still passes.
-- Must stay SECURITY INVOKER (see 000300).
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
  -- full_name is generated (null in NEW inside a BEFORE trigger).
  v_toggle constant text[] := array['deleted_at', 'deleted_by', 'updated_at', 'updated_by', 'full_name'];
begin
  if public.crm_is_privileged_session() then
    return NEW;
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

-- ---------------------------------------------------------------------------
-- Opportunity stage change (Kanban / path). Invoker: RLS and the row guard
-- apply. One update. A lost target needs a reason (the new one, or the
-- current one when the stage does not change); leaving lost clears the
-- reason and note. An explicit probability survives the stage change.
-- Errors (P0001): stage_unavailable, loss_reason_required.
-- ---------------------------------------------------------------------------
create or replace function public.crm_change_opportunity_stage(
  p_id uuid,
  p_stage_id uuid,
  p_loss_reason text default null,
  p_loss_note text default null,
  p_probability numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opp public.crm_opportunities%rowtype;
  v_stage public.crm_pipeline_stages%rowtype;
  v_reason text := nullif(trim(p_loss_reason), '');
  v_note text := nullif(trim(p_loss_note), '');
begin
  select * into v_opp
  from public.crm_opportunities
  where id = p_id and deleted_at is null;
  if not found then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;

  select * into v_stage from public.crm_pipeline_stages where id = p_stage_id;
  if not found or not v_stage.active or v_stage.pipeline_id <> v_opp.pipeline_id then
    raise exception 'stage_unavailable' using errcode = 'P0001';
  end if;

  if v_stage.kind = 'lost' then
    v_reason := coalesce(v_reason,
      case when v_opp.stage_id = p_stage_id then nullif(trim(v_opp.loss_reason), '') end);
    if v_reason is null then
      raise exception 'loss_reason_required' using errcode = 'P0001';
    end if;
    v_note := coalesce(v_note,
      case when v_opp.stage_id = p_stage_id then v_opp.loss_note end);
  else
    v_reason := null;
    v_note := null;
  end if;

  if p_probability is not null then
    if p_probability < 0 or p_probability > 100 then
      raise exception 'invalid_probability' using errcode = '22023';
    end if;
    perform set_config('crm.keep_probability', 'on', true);
  end if;

  update public.crm_opportunities
  set stage_id = p_stage_id,
      loss_reason = v_reason,
      loss_note = v_note,
      probability = coalesce(round(p_probability)::integer, probability)
  where id = p_id
  returning * into v_opp;

  perform set_config('crm.keep_probability', 'off', true);

  if not found then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return to_jsonb(v_opp);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may write account <-> company links: accounts.edit, or accounts.create
-- for an account inserted in the current transaction (crm_create_account;
-- PostgREST cannot insert an account and its links in one transaction any
-- other way). xmin is compared with the top-level xid, so a row written in a
-- subtransaction or an earlier transaction fails closed.
-- ---------------------------------------------------------------------------
create or replace function public.crm_account_created_in_tx(p_account_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.crm_accounts a
    where a.id = p_account_id
      and a.xmin::text = (txid_current() % 4294967296)::text
  );
$$;

create or replace function public.crm_can_edit_account_entities(p_account_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.crm_can_write()
    and public.crm_can_see_record('account', p_account_id)
    and (
      public.crm_has_permission('accounts', 'edit')
      or (public.crm_has_permission('accounts', 'create')
          and public.crm_account_created_in_tx(p_account_id))
    );
$$;

drop policy if exists crm_account_entities_insert on public.crm_account_entities;
create policy crm_account_entities_insert on public.crm_account_entities
  for insert to authenticated
  with check (public.crm_can_edit_account_entities(account_id));

drop policy if exists crm_account_entities_update on public.crm_account_entities;
create policy crm_account_entities_update on public.crm_account_entities
  for update to authenticated
  using (public.crm_can_edit_account_entities(account_id))
  with check (public.crm_can_edit_account_entities(account_id));

drop policy if exists crm_account_entities_delete on public.crm_account_entities;
create policy crm_account_entities_delete on public.crm_account_entities
  for delete to authenticated
  using (public.crm_can_edit_account_entities(account_id));

-- ---------------------------------------------------------------------------
-- Account <-> group company links: replace the whole set atomically.
-- p_links = [{"entity_id": uuid, "is_primary": bool}], exactly one primary
-- when non-empty (else P0001 one_primary_required). Invoker: needs
-- accounts.edit (42501 otherwise), or accounts.create on an account created in
-- this transaction (crm_create_account). The link policies apply the same rule.
-- ---------------------------------------------------------------------------
create or replace function public.crm_set_account_entities(p_account_id uuid, p_links jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_links jsonb := coalesce(p_links, '[]'::jsonb);
  v_count integer;
  v_distinct integer;
  v_primaries integer;
  v_primary uuid;
begin
  if jsonb_typeof(v_links) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(v_links) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(e ->> 'entity_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(jsonb_typeof(e -> 'is_primary'), 'boolean') not in ('boolean', 'null')
     ) then
    raise exception 'invalid_links' using errcode = '22023';
  end if;

  select count(*),
         count(distinct (e ->> 'entity_id')::uuid),
         count(*) filter (where coalesce((e ->> 'is_primary')::boolean, false))
  into v_count, v_distinct, v_primaries
  from jsonb_array_elements(v_links) e;

  if v_count <> v_distinct then
    raise exception 'duplicate_entity' using errcode = '22023';
  end if;
  if v_count > 0 and v_primaries <> 1 then
    raise exception 'one_primary_required' using errcode = 'P0001';
  end if;

  if not public.crm_can_see_record('account', p_account_id) then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
  if not public.crm_can_edit_account_entities(p_account_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select (e ->> 'entity_id')::uuid into v_primary
  from jsonb_array_elements(v_links) e
  where coalesce((e ->> 'is_primary')::boolean, false);

  delete from public.crm_account_entities
  where account_id = p_account_id
    and entity_id not in (
      select (e ->> 'entity_id')::uuid from jsonb_array_elements(v_links) e
    );

  -- Clear the old primary first (unique partial index on is_primary).
  update public.crm_account_entities
  set is_primary = false
  where account_id = p_account_id and is_primary and entity_id is distinct from v_primary;

  insert into public.crm_account_entities (account_id, entity_id, is_primary)
  select p_account_id, (e ->> 'entity_id')::uuid, coalesce((e ->> 'is_primary')::boolean, false)
  from jsonb_array_elements(v_links) e
  on conflict (account_id, entity_id) do update set is_primary = excluded.is_primary;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create an account and its company links in one transaction. Invoker: the
-- insert policy (accounts.create, visible owner) and the row guard apply.
-- Only whitelisted columns are read from p_account; owner defaults to the
-- caller.
-- ---------------------------------------------------------------------------
create or replace function public.crm_create_account(p_account jsonb, p_links jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_in public.crm_accounts;
  v_row public.crm_accounts%rowtype;
begin
  if p_account is null or jsonb_typeof(p_account) <> 'object' then
    raise exception 'invalid_account' using errcode = '22023';
  end if;

  v_in := jsonb_populate_record(null::public.crm_accounts, p_account);

  insert into public.crm_accounts (
    name, type, country_code, segment, industry, website, phone, email, tax_id,
    parent_account_id, billing_street, billing_city, billing_state,
    billing_postal_code, billing_country_code, description, owner_id
  ) values (
    v_in.name, coalesce(v_in.type, 'prospect'), v_in.country_code, v_in.segment,
    v_in.industry, v_in.website, v_in.phone, v_in.email, v_in.tax_id,
    v_in.parent_account_id, v_in.billing_street, v_in.billing_city, v_in.billing_state,
    v_in.billing_postal_code, v_in.billing_country_code, v_in.description,
    coalesce(v_in.owner_id, auth.uid())
  )
  returning * into v_row;

  perform public.crm_set_account_entities(v_row.id, coalesce(p_links, '[]'::jsonb));

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbound idempotency: a soft-deleted lead no longer holds its external_ref,
-- so a submission whose key only matches a deleted lead is processed as new.
-- ---------------------------------------------------------------------------
drop index if exists public.crm_leads_external_ref_uq;
create unique index crm_leads_external_ref_uq
  on public.crm_leads (external_ref) where external_ref is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Picklist reorder (mirrors crm_reorder_stages).
-- ---------------------------------------------------------------------------
create or replace function public.crm_reorder_picklist(p_picklist text, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can reorder picklists' using errcode = '42501';
  end if;

  if p_ids is null
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select coalesce(array_agg(id order by id), '{}') from public.crm_picklist_values
           where picklist = p_picklist)
        is distinct from
        (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'ids must list every value of the picklist exactly once'
      using errcode = '22023';
  end if;

  update public.crm_picklist_values v
  set sort_order = o.ord * 10
  from unnest(p_ids) with ordinality as o(id, ord)
  where v.id = o.id and v.picklist = p_picklist;
end;
$$;

-- ---------------------------------------------------------------------------
-- Role permissions in the access matrix: single-statement edits, so two
-- admins editing different roles never overwrite each other.
-- p_permissions = { "<module>": "full" | "none" | ["view", ...] }
-- ---------------------------------------------------------------------------
create or replace function public.crm_set_role_permissions(p_role text, p_permissions jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can edit permissions' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'super_admin' then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.crm_roles where id = p_role) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if p_permissions is null
     or jsonb_typeof(p_permissions) <> 'object'
     or exists (
       select 1 from jsonb_each(p_permissions) m
       where m.key !~ '^[a-z][a-z0-9_]{1,39}$'
          or not (
            (jsonb_typeof(m.value) = 'string' and m.value #>> '{}' in ('full', 'none'))
            or (jsonb_typeof(m.value) = 'array'
                and not exists (
                  select 1 from jsonb_array_elements(m.value) a
                  where jsonb_typeof(a) <> 'string'
                     or a #>> '{}' not in ('view', 'create', 'edit', 'delete', 'convert', 'export')))
          )
     ) then
    raise exception 'invalid_permissions' using errcode = '22023';
  end if;

  update public.crm_access_control
  set matrix = jsonb_set(matrix, array[p_role], p_permissions, true),
      updated_by = auth.uid()
  where id;
end;
$$;

create or replace function public.crm_remove_role_permissions(p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can edit permissions' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'super_admin' then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  update public.crm_access_control
  set matrix = matrix - p_role,
      updated_by = auth.uid()
  where id and matrix ? p_role;
end;
$$;

-- Delete a custom role and its matrix row in one transaction (no orphaned
-- permissions if either step fails). Admin only; system roles and roles still
-- assigned to users are refused.
create or replace function public.crm_delete_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_system boolean;
begin
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can delete roles' using errcode = '42501';
  end if;
  select system into v_system from public.crm_roles where id = p_role for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_system then
    raise exception 'system_role' using errcode = '42501';
  end if;
  if exists (select 1 from public.crm_users where role = p_role) then
    raise exception 'role_in_use' using errcode = '23503';
  end if;

  update public.crm_access_control
  set matrix = matrix - p_role,
      updated_by = auth.uid()
  where id and matrix ? p_role;

  delete from public.crm_roles where id = p_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log: record_key for rows whose key is not a uuid (roles, settings,
-- access matrix). Exactly one of record_id / record_key is set.
-- ---------------------------------------------------------------------------
alter table public.crm_audit_logs add column if not exists record_key text;
alter table public.crm_audit_logs alter column record_id drop not null;
alter table public.crm_audit_logs drop constraint if exists crm_audit_logs_record_ref;
alter table public.crm_audit_logs
  add constraint crm_audit_logs_record_ref check (record_id is not null or record_key is not null);

create index if not exists crm_audit_logs_record_key_idx
  on public.crm_audit_logs (object, record_key, created_at desc) where record_key is not null;

-- Same as 000500, plus:
--   * lead status change -> stage_change
--   * record_key for non-uuid keys ('matrix' for the access matrix)
--   * crm_settings: admin_only rows have their value redacted; the
--     round-robin cursor (internal, written on every inbound lead) is skipped.
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
  v_record_id uuid;
  v_record_key text;
  k text;
  v_skip constant text[] := array['updated_at', 'updated_by', 'raw_payload'];
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(OLD);
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(NEW);
  end if;
  v_row := coalesce(v_new, v_old);

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

  insert into public.crm_audit_logs (actor_id, actor_name, object, record_id, record_key, owner_id, action, diff)
  values (
    v_actor,
    coalesce(v_actor_name, 'system'),
    v_object,
    v_record_id,
    v_record_key,
    case when (v_row ->> 'owner_id') ~ v_uuid_re then (v_row ->> 'owner_id')::uuid end,
    v_action,
    v_diff
  );

  return null;
end;
$$;

revoke all on function public.crm_audit_trigger() from public, anon, authenticated;

drop trigger if exists trg_crm_pipeline_stages_audit on public.crm_pipeline_stages;
create trigger trg_crm_pipeline_stages_audit
after insert or update or delete on public.crm_pipeline_stages
for each row execute function public.crm_audit_trigger('setup_stage');

drop trigger if exists trg_crm_picklist_values_audit on public.crm_picklist_values;
create trigger trg_crm_picklist_values_audit
after insert or update or delete on public.crm_picklist_values
for each row execute function public.crm_audit_trigger('picklist');

drop trigger if exists trg_crm_entities_audit on public.crm_entities;
create trigger trg_crm_entities_audit
after insert or update or delete on public.crm_entities
for each row execute function public.crm_audit_trigger('entity');

drop trigger if exists trg_crm_roles_audit on public.crm_roles;
create trigger trg_crm_roles_audit
after insert or update or delete on public.crm_roles
for each row execute function public.crm_audit_trigger('role');

drop trigger if exists trg_crm_teams_audit on public.crm_teams;
create trigger trg_crm_teams_audit
after insert or update or delete on public.crm_teams
for each row execute function public.crm_audit_trigger('team');

drop trigger if exists trg_crm_users_audit on public.crm_users;
create trigger trg_crm_users_audit
after insert or update or delete on public.crm_users
for each row execute function public.crm_audit_trigger('user');

drop trigger if exists trg_crm_access_control_audit on public.crm_access_control;
create trigger trg_crm_access_control_audit
after insert or update or delete on public.crm_access_control
for each row execute function public.crm_audit_trigger('access_control');

drop trigger if exists trg_crm_settings_audit on public.crm_settings;
create trigger trg_crm_settings_audit
after insert or update or delete on public.crm_settings
for each row execute function public.crm_audit_trigger('settings');

-- Audit reads: admins see everything. With audit_logs.view, record objects
-- follow record visibility (unchanged) and config objects need the matching
-- setup_* view permission.
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
        else record_id is not null and public.crm_can_see_record(object, record_id)
      end
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (default privileges revoke EXECUTE on new functions).
-- ---------------------------------------------------------------------------
revoke all on function public.crm_change_opportunity_stage(uuid, uuid, text, text, numeric) from public, anon;
revoke all on function public.crm_set_account_entities(uuid, jsonb) from public, anon;
revoke all on function public.crm_create_account(jsonb, jsonb) from public, anon;
revoke all on function public.crm_reorder_picklist(text, uuid[]) from public, anon;
revoke all on function public.crm_set_role_permissions(text, jsonb) from public, anon;
revoke all on function public.crm_remove_role_permissions(text) from public, anon;
revoke all on function public.crm_delete_role(text) from public, anon;
revoke all on function public.crm_account_created_in_tx(uuid) from public, anon, authenticated;
revoke all on function public.crm_can_edit_account_entities(uuid) from public, anon;

grant execute on function public.crm_change_opportunity_stage(uuid, uuid, text, text, numeric) to authenticated, service_role;
grant execute on function public.crm_set_account_entities(uuid, jsonb) to authenticated, service_role;
grant execute on function public.crm_create_account(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.crm_reorder_picklist(text, uuid[]) to authenticated, service_role;
grant execute on function public.crm_set_role_permissions(text, jsonb) to authenticated, service_role;
grant execute on function public.crm_remove_role_permissions(text) to authenticated, service_role;
grant execute on function public.crm_delete_role(text) to authenticated, service_role;
-- Evaluated with the caller's privileges inside the link policies.
grant execute on function public.crm_can_edit_account_entities(uuid) to authenticated, service_role;
grant execute on function public.crm_account_created_in_tx(uuid) to service_role;

commit;
