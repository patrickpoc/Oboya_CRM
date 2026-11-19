-- Forward repairs for the audited module regressions. No permission reseed.
begin;
set local lock_timeout = '5s';

-- The adapter must precede old unapplied seeds; it is unnecessary afterwards.
drop trigger if exists trg_crm_preserve_module_seed on public.crm_access_control;
drop function if exists public.crm_preserve_module_seed();

-- Preserve converted-lead protection from v1_fixes while checking case links.

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

-- Same parent visibility as the case SELECT policy.

create or replace function public.crm_can_see_record(p_object text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_deleted timestamptz;
  v_account uuid;
  v_contact uuid;
begin
  if p_object is null or p_id is null then
    return false;
  end if;

  case p_object
    when 'lead' then
      select owner_id, deleted_at into v_owner, v_deleted from public.crm_leads where id = p_id;
    when 'account' then
      select owner_id, deleted_at into v_owner, v_deleted from public.crm_accounts where id = p_id;
    when 'contact' then
      select owner_id, deleted_at into v_owner, v_deleted from public.crm_contacts where id = p_id;
    when 'opportunity' then
      select owner_id, deleted_at into v_owner, v_deleted from public.crm_opportunities where id = p_id;
    when 'activity' then
      select owner_id, deleted_at into v_owner, v_deleted from public.crm_activities where id = p_id;
    when 'case' then
      select owner_id, deleted_at, account_id, contact_id
      into v_owner, v_deleted, v_account, v_contact from public.crm_cases where id = p_id;
    else
      return false;
  end case;

  if v_owner is null then
    return false;
  end if;
  if v_deleted is not null and not public.crm_is_admin() then
    return false;
  end if;
  return public.crm_can_see(v_owner)
    or (p_object = 'case' and (
      (v_account is not null and public.crm_can_see_record('account', v_account))
      or (v_contact is not null and public.crm_can_see_record('contact', v_contact))
    ));
end;
$$;

-- Shared deletion/restoration RPCs resolve cases through this whitelist.

create or replace function public.crm_object_table(p_object text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_object
    when 'lead' then 'crm_leads'
    when 'account' then 'crm_accounts'
    when 'contact' then 'crm_contacts'
    when 'opportunity' then 'crm_opportunities'
    when 'activity' then 'crm_activities'
    when 'case' then 'crm_cases'
  end;
$$;

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
      when 'case' then exists (select 1 from public.crm_cases where id = NEW.what_id)
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

revoke all on function public.crm_activity_rules() from public, anon, authenticated;

alter table public.crm_recent_views drop constraint if exists crm_recent_views_object_check;
alter table public.crm_recent_views add constraint crm_recent_views_object_check
  check (object in ('lead', 'account', 'contact', 'opportunity', 'activity', 'case'));

-- Credentials are unnecessary in immutable history, even when encrypted.

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

-- UPDATE RLS intentionally rejects deleted rows. Keep it that way and expose
-- one narrow, owner-scoped operation with an explicit delete permission check.
create or replace function public.crm_delete_email_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if auth.uid() is null or not public.crm_can_write()
     or not public.crm_has_permission('email', 'delete') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.crm_email_accounts
  set deleted_at = now(), deleted_by = auth.uid(), enabled = false
  where id = p_id and owner_id = auth.uid() and deleted_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.crm_delete_email_account(uuid) from public, anon;
grant execute on function public.crm_delete_email_account(uuid) to authenticated, service_role;
revoke delete on public.crm_email_accounts from authenticated;

alter table public.crm_email_accounts alter column color set default '#004F7C';
update public.crm_email_accounts set color = case upper(color)
  when '#16A34A' then '#4DAF4E' when '#D97706' then '#909B03'
  when '#DC2626' then '#EA5744' when '#7C3AED' then '#01203F'
  when '#0891B2' then '#009CD4' else '#004F7C' end
where upper(color) not in ('#004F7C', '#4DAF4E', '#909B03', '#EA5744', '#01203F', '#009CD4', '#75C566', '#DBE64C', '#F1F5F1');
alter table public.crm_email_accounts add constraint crm_email_accounts_brand_color
  check (upper(color) in ('#004F7C', '#4DAF4E', '#909B03', '#EA5744', '#01203F', '#009CD4', '#75C566', '#DBE64C', '#F1F5F1'));
commit;
