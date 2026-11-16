-- Oboya CRM 5/6: audit trigger (D4) on every object table.
-- Depends on 000300 (crm_audit_logs + object tables). Idempotent.
--
-- One row per insert/update/delete in crm_audit_logs:
--   action  create | update | delete | restore | stage_change | owner_change | convert
--           (deleted_at toggled -> delete/restore; converted_at set -> convert;
--            stage_id changed -> stage_change; owner_id changed -> owner_change)
--   diff    only changed keys as {field: [old, new]}; updated_at / updated_by
--           excluded; raw_payload excluded (large inbound payload).
--           create diffs list the non-null fields as [null, value].
--   actor   auth.uid(), else the row's updated_by, else created_by;
--           actor_name 'system' when there is no actor.
-- A no-op update (nothing but updated_at/updated_by changed) writes nothing.

begin;
set local lock_timeout = '5s';

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
  k text;
  v_skip constant text[] := array['updated_at', 'updated_by', 'raw_payload'];
begin
  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    v_row := v_new;
    v_action := 'create';
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any (v_skip)) and jsonb_typeof(v_new -> k) <> 'null' then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array('null'::jsonb, v_new -> k));
      end if;
    end loop;

  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row := v_new;
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
    elsif v_diff ? 'owner_id' then
      v_action := 'owner_change';
    else
      v_action := 'update';
    end if;

  else -- DELETE (hard delete, service role only)
    v_old := to_jsonb(OLD);
    v_row := v_old;
    v_action := 'delete';
    for k in select jsonb_object_keys(v_old) loop
      if not (k = any (v_skip)) and jsonb_typeof(v_old -> k) <> 'null' then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(v_old -> k, 'null'::jsonb));
      end if;
    end loop;
  end if;

  v_actor := coalesce(
    auth.uid(),
    nullif(v_row ->> 'updated_by', '')::uuid,
    nullif(v_row ->> 'created_by', '')::uuid
  );

  if v_actor is not null then
    select coalesce(nullif(trim(u.full_name), ''), u.email)
    into v_actor_name
    from public.crm_users u
    where u.id = v_actor;
  end if;

  insert into public.crm_audit_logs (actor_id, actor_name, object, record_id, owner_id, action, diff)
  values (
    v_actor,
    coalesce(v_actor_name, 'system'),
    v_object,
    (v_row ->> 'id')::uuid,
    nullif(v_row ->> 'owner_id', '')::uuid,
    v_action,
    v_diff
  );

  return null;
end;
$$;

revoke all on function public.crm_audit_trigger() from public, anon, authenticated;

drop trigger if exists trg_crm_accounts_audit on public.crm_accounts;
create trigger trg_crm_accounts_audit
after insert or update or delete on public.crm_accounts
for each row execute function public.crm_audit_trigger('account');

drop trigger if exists trg_crm_contacts_audit on public.crm_contacts;
create trigger trg_crm_contacts_audit
after insert or update or delete on public.crm_contacts
for each row execute function public.crm_audit_trigger('contact');

drop trigger if exists trg_crm_leads_audit on public.crm_leads;
create trigger trg_crm_leads_audit
after insert or update or delete on public.crm_leads
for each row execute function public.crm_audit_trigger('lead');

drop trigger if exists trg_crm_opportunities_audit on public.crm_opportunities;
create trigger trg_crm_opportunities_audit
after insert or update or delete on public.crm_opportunities
for each row execute function public.crm_audit_trigger('opportunity');

drop trigger if exists trg_crm_activities_audit on public.crm_activities;
create trigger trg_crm_activities_audit
after insert or update or delete on public.crm_activities
for each row execute function public.crm_audit_trigger('activity');

commit;
