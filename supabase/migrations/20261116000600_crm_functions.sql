-- Oboya CRM 6/6: RPCs.
--   crm_delete_stage(stage, target)      admin; moves opportunities then deletes (D6)
--   crm_reorder_stages(pipeline, ids[])  admin; sort_order = position * 10
--   crm_soft_delete(object, id)          writer with <module>.delete who can see the record
--   crm_restore(object, id)              admin
--   crm_convert_lead(...)                security definer with explicit checks, one transaction
--   crm_assign_inbound_owner()           service role only; round-robin (D3)
-- Depends on 000100..000500. Idempotent.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------
create or replace function public.crm_delete_stage(p_stage_id uuid, p_target_stage_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stage public.crm_pipeline_stages%rowtype;
  v_target public.crm_pipeline_stages%rowtype;
  v_moved integer := 0;
begin
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can delete stages' using errcode = '42501';
  end if;

  select * into v_stage from public.crm_pipeline_stages where id = p_stage_id for update;
  if not found then
    raise exception 'stage_not_found' using errcode = 'P0002';
  end if;
  if v_stage.kind <> 'open' then
    raise exception 'Won and lost stages cannot be removed' using errcode = '23514';
  end if;

  if exists (select 1 from public.crm_opportunities where stage_id = p_stage_id) then
    if p_target_stage_id is null then
      raise exception 'target_stage_required' using errcode = '23514';
    end if;
    select * into v_target from public.crm_pipeline_stages where id = p_target_stage_id;
    if not found
       or v_target.id = v_stage.id
       or v_target.pipeline_id <> v_stage.pipeline_id
       or v_target.kind <> 'open'
       or not v_target.active then
      raise exception 'Target must be another active open stage of the same pipeline'
        using errcode = '23514';
    end if;

    -- Audited as stage_change by the opportunity trigger.
    update public.crm_opportunities
    set stage_id = p_target_stage_id
    where stage_id = p_stage_id;
    get diagnostics v_moved = row_count;

    if exists (select 1 from public.crm_opportunities where stage_id = p_stage_id) then
      raise exception 'Some opportunities could not be moved' using errcode = '42501';
    end if;
  end if;

  delete from public.crm_pipeline_stages where id = p_stage_id;
  return v_moved;
end;
$$;

create or replace function public.crm_reorder_stages(p_pipeline_id uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can reorder stages' using errcode = '42501';
  end if;

  if p_ids is null
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select coalesce(array_agg(id order by id), '{}') from public.crm_pipeline_stages
           where pipeline_id = p_pipeline_id)
        is distinct from
        (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'ids must list every stage of the pipeline exactly once'
      using errcode = '22023';
  end if;

  update public.crm_pipeline_stages s
  set sort_order = o.ord * 10
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.pipeline_id = p_pipeline_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Soft delete / restore. Non-admins cannot write deleted_at through RLS
-- (the new row would fail the select policy), so they go through this RPC.
-- ---------------------------------------------------------------------------
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
  end;
$$;

create or replace function public.crm_soft_delete(p_object text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text := public.crm_object_table(p_object);
  v_rows integer;
begin
  if v_table is null then
    raise exception 'Unknown object' using errcode = '22023';
  end if;
  if not public.crm_can_write()
     or not public.crm_has_permission(
       case p_object when 'opportunity' then 'opportunities'
                     when 'activity' then 'activities'
                     else p_object || 's' end,
       'delete') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- crm_can_see_record returns false for already deleted rows (non-admins).
  if not public.crm_can_see_record(p_object, p_id) then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;

  execute format(
    'update public.%I set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null',
    v_table)
  using p_id, auth.uid();
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.crm_restore(p_object text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text := public.crm_object_table(p_object);
  v_rows integer;
begin
  if v_table is null then
    raise exception 'Unknown object' using errcode = '22023';
  end if;
  if not public.crm_is_admin() then
    raise exception 'Only a super admin can restore records' using errcode = '42501';
  end if;

  execute format(
    'update public.%I set deleted_at = null where id = $1 and deleted_at is not null',
    v_table)
  using p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lead conversion. Security definer (RLS is bypassed), so every check is
-- explicit: active writer with leads.convert, lead visible to the caller, given
-- account visible. Row triggers still run as the caller's session, so
-- crm_record_guard checks every new reference and the audit actor is the caller.
-- New records are owned by the lead owner. One transaction: any failure rolls
-- everything back.
-- ---------------------------------------------------------------------------
create or replace function public.crm_convert_lead(
  p_lead_id uuid,
  p_account_id uuid default null,
  p_create_opportunity boolean default true,
  p_opportunity_name text default null,
  p_amount numeric default null,
  p_currency text default null,
  p_close_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.crm_leads%rowtype;
  v_account_id uuid;
  v_account_name text;
  v_account_created boolean := false;
  v_contact_id uuid;
  v_contact_created boolean := false;
  v_opp_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_currency text;
  v_first text;
  v_last text;
begin
  if auth.uid() is null
     or not public.crm_can_write()
     or not public.crm_has_permission('leads', 'convert') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_lead
  from public.crm_leads
  where id = p_lead_id and deleted_at is null
  for update;
  if not found or not public.crm_can_see(v_lead.owner_id) then
    raise exception 'lead_not_found' using errcode = 'P0002';
  end if;
  if v_lead.converted_at is not null then
    raise exception 'lead_already_converted' using errcode = '23505';
  end if;

  -- Account: link an existing one, or create from the lead.
  if p_account_id is not null then
    select id, name into v_account_id, v_account_name
    from public.crm_accounts
    where id = p_account_id and deleted_at is null and public.crm_can_see(owner_id);
    if not found then
      raise exception 'account_not_found' using errcode = 'P0002';
    end if;
  else
    if not public.crm_has_permission('accounts', 'create') then
      raise exception 'Not allowed to create accounts' using errcode = '42501';
    end if;
    v_account_name := coalesce(
      nullif(trim(v_lead.company), ''),
      nullif(v_lead.full_name, ''),
      v_lead.email
    );
    insert into public.crm_accounts (
      name, type, country_code, billing_country_code, segment, industry,
      website, phone, owner_id
    ) values (
      v_account_name, 'prospect', v_lead.country_code, v_lead.country_code,
      v_lead.segment, v_lead.industry, v_lead.website, v_lead.phone, v_lead.owner_id
    )
    returning id into v_account_id;
    v_account_created := true;
  end if;

  if v_lead.entity_id is not null then
    insert into public.crm_account_entities (account_id, entity_id, is_primary)
    values (
      v_account_id,
      v_lead.entity_id,
      not exists (
        select 1 from public.crm_account_entities
        where account_id = v_account_id and is_primary
      )
    )
    on conflict (account_id, entity_id) do nothing;
  end if;

  -- Contact: reuse a live contact with the same email on that account.
  if v_lead.email is not null and not v_account_created then
    select id into v_contact_id
    from public.crm_contacts
    where account_id = v_account_id
      and deleted_at is null
      and public.crm_can_see(owner_id)
      and lower(email) = lower(v_lead.email)
    order by created_at
    limit 1;
  end if;

  if v_contact_id is null then
    if not public.crm_has_permission('contacts', 'create') then
      raise exception 'Not allowed to create contacts' using errcode = '42501';
    end if;
    v_last := nullif(trim(v_lead.last_name), '');
    v_first := nullif(trim(v_lead.first_name), '');
    if v_last is null then
      v_last := coalesce(v_first, nullif(trim(v_lead.company), ''), v_lead.email, 'Unknown');
      v_first := null;
    end if;
    insert into public.crm_contacts (
      account_id, first_name, last_name, email, phone, title, country_code,
      locale, lead_source, owner_id
    ) values (
      v_account_id, v_first, v_last, v_lead.email, v_lead.phone, v_lead.title,
      v_lead.country_code, v_lead.locale, v_lead.source, v_lead.owner_id
    )
    returning id into v_contact_id;
    v_contact_created := true;
  end if;

  -- Optional opportunity at the first active open stage of the default pipeline.
  if coalesce(p_create_opportunity, false) then
    if not public.crm_has_permission('opportunities', 'create') then
      raise exception 'Not allowed to create opportunities' using errcode = '42501';
    end if;
    select id into v_pipeline_id
    from public.crm_pipelines
    where is_default and active
    limit 1;

    select id into v_stage_id
    from public.crm_pipeline_stages
    where pipeline_id = v_pipeline_id and kind = 'open' and active
    order by sort_order, created_at
    limit 1;

    if v_stage_id is null then
      raise exception 'no_open_stage' using errcode = 'P0002';
    end if;

    v_currency := upper(nullif(trim(p_currency), ''));
    if v_currency is null and v_lead.entity_id is not null then
      select default_currency into v_currency from public.crm_entities where id = v_lead.entity_id;
    end if;

    insert into public.crm_opportunities (
      name, account_id, primary_contact_id, pipeline_id, stage_id, amount,
      currency, close_date, entity_id, lead_source, owner_id
    ) values (
      coalesce(nullif(trim(p_opportunity_name), ''), v_account_name || ' - ' || to_char(now(), 'YYYY-MM')),
      v_account_id, v_contact_id, v_pipeline_id, v_stage_id, p_amount,
      coalesce(v_currency, 'USD'), coalesce(p_close_date, current_date + 90),
      v_lead.entity_id, v_lead.source, v_lead.owner_id
    )
    returning id into v_opp_id;
  end if;

  -- converted_* writes pass crm_record_guard because current_user is the owner here.
  update public.crm_leads
  set status = 'qualified',
      converted_at = now(),
      converted_account_id = v_account_id,
      converted_contact_id = v_contact_id,
      converted_opportunity_id = v_opp_id
  where id = v_lead.id;

  -- Repoint the lead's activities: what -> opportunity (or account), who -> contact.
  update public.crm_activities
  set what_object = case when v_opp_id is not null then 'opportunity' else 'account' end,
      what_id = coalesce(v_opp_id, v_account_id),
      who_contact_id = coalesce(who_contact_id, v_contact_id)
  where what_object = 'lead' and what_id = v_lead.id;

  return jsonb_build_object(
    'lead_id', v_lead.id,
    'account_id', v_account_id,
    'account_created', v_account_created,
    'contact_id', v_contact_id,
    'contact_created', v_contact_created,
    'opportunity_id', v_opp_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbound owner (D3). Row lock on the cursor serialises concurrent calls.
--   mode round_robin: next active, writable user with receives_inbound after the
--                     cursor (ordered by id, wraps around)
--   fallback:         settings.inbound_default_owner if active
--   last resort:      oldest active super_admin
-- Returns null only when no active super_admin exists.
-- ---------------------------------------------------------------------------
create or replace function public.crm_assign_inbound_owner()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_cursor_raw text;
  v_cursor uuid;
  v_next uuid;
  v_default_raw text;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  insert into public.crm_settings (key, value, admin_only)
  values ('inbound_rr_cursor', 'null'::jsonb, true)
  on conflict (key) do nothing;

  select value #>> '{}' into v_cursor_raw
  from public.crm_settings
  where key = 'inbound_rr_cursor'
  for update;

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
      update public.crm_settings
      set value = to_jsonb(v_next::text)
      where key = 'inbound_rr_cursor';
      return v_next;
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
      return v_next;
    end if;
  end if;

  select u.id into v_next
  from public.crm_users u
  where u.role = 'super_admin' and u.status = 'active'
  order by u.created_at, u.id
  limit 1;

  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.crm_delete_stage(uuid, uuid) from public, anon;
revoke all on function public.crm_reorder_stages(uuid, uuid[]) from public, anon;
revoke all on function public.crm_object_table(text) from public, anon;
revoke all on function public.crm_soft_delete(text, uuid) from public, anon;
revoke all on function public.crm_restore(text, uuid) from public, anon;
revoke all on function public.crm_convert_lead(uuid, uuid, boolean, text, numeric, text, date) from public, anon;
revoke all on function public.crm_assign_inbound_owner() from public, anon, authenticated;

grant execute on function public.crm_delete_stage(uuid, uuid) to authenticated;
grant execute on function public.crm_reorder_stages(uuid, uuid[]) to authenticated;
grant execute on function public.crm_object_table(text) to authenticated, service_role;
grant execute on function public.crm_soft_delete(text, uuid) to authenticated;
grant execute on function public.crm_restore(text, uuid) to authenticated;
grant execute on function public.crm_convert_lead(uuid, uuid, boolean, text, numeric, text, date) to authenticated;
grant execute on function public.crm_assign_inbound_owner() to service_role;

-- ---------------------------------------------------------------------------
-- Per-user rate limiting (fixed window). No client policies: only the
-- security definer function below touches the table.
-- App usage: crm_rate_limit_hit('change_password', 5, 900).
-- ---------------------------------------------------------------------------
create table if not exists public.crm_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z][a-z0-9_.]{1,63}$'),
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (user_id, bucket)
);
alter table public.crm_rate_limits enable row level security;
revoke all on public.crm_rate_limits from anon, authenticated;

-- Returns true when this call is allowed (hits in the current window <= p_max).
-- Atomic: the upsert takes the row lock, so concurrent calls serialise.
create or replace function public.crm_rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hits integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_bucket is null or p_max is null or p_max < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments' using errcode = '22023';
  end if;

  insert into public.crm_rate_limits as r (user_id, bucket, window_start, hits)
  values (v_uid, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
  set window_start = case
        when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
        else r.window_start
      end,
      hits = case
        when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
        else r.hits + 1
      end
  returning hits into v_hits;

  return v_hits <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function EXECUTE grants (source of truth; overrides per-file grants above).
-- authenticated gets only:
--   * RPCs the app calls: crm_soft_delete, crm_restore, crm_convert_lead,
--     crm_delete_stage, crm_reorder_stages, crm_rate_limit_hit
--   * helpers evaluated with the caller's privileges inside RLS policies,
--     CHECK constraints or invoker triggers: crm_is_active_user, crm_is_admin,
--     crm_can_write, crm_can_see, crm_can_see_record, crm_has_permission,
--     crm_tags_valid, crm_is_privileged_session
-- Trigger functions need no EXECUTE grant. service_role keeps everything.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.crm_soft_delete(text, uuid) to authenticated;
grant execute on function public.crm_restore(text, uuid) to authenticated;
grant execute on function public.crm_convert_lead(uuid, uuid, boolean, text, numeric, text, date) to authenticated;
grant execute on function public.crm_delete_stage(uuid, uuid) to authenticated;
grant execute on function public.crm_reorder_stages(uuid, uuid[]) to authenticated;
grant execute on function public.crm_rate_limit_hit(text, integer, integer) to authenticated;

grant execute on function public.crm_is_active_user() to authenticated;
grant execute on function public.crm_is_admin() to authenticated;
grant execute on function public.crm_can_write() to authenticated;
grant execute on function public.crm_can_see(uuid) to authenticated;
grant execute on function public.crm_can_see_record(text, uuid) to authenticated;
grant execute on function public.crm_has_permission(text, text) to authenticated;
grant execute on function public.crm_tags_valid(text[]) to authenticated;
grant execute on function public.crm_is_privileged_session() to authenticated;

-- Table grants again, now that every table exists (see 000100).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

commit;
