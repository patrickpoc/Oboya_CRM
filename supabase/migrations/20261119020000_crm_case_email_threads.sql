-- Thread-aware, idempotent email-to-case conversion through the user client.
begin;
set local lock_timeout = '5s';

alter table public.crm_cases add column source_message_ids text[] not null default '{}';
create index crm_cases_source_message_ids_idx on public.crm_cases using gin (source_message_ids);
-- A hidden case owned by another user must not prevent creating one's own.
drop index public.crm_cases_source_message_uq;
create unique index crm_cases_source_message_uq on public.crm_cases (owner_id, source_message_id)
  where source_message_id is not null and deleted_at is null;

create or replace function public.crm_case_from_email(
  p_message_id text, p_subject text, p_from text, p_body text default '',
  p_in_reply_to text default null, p_references text[] default '{}',
  p_account_id uuid default null, p_contact_id uuid default null,
  p_priority text default 'normal', p_queue text default 'support'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id text := btrim(p_message_id, E' <>\r\n\t');
  v_keys text[];
  v_key text;
  v_case public.crm_cases%rowtype;
  v_processed jsonb;
  v_description text;
  v_updated boolean := false;
begin
  if auth.uid() is null or not public.crm_can_write()
     or not public.crm_has_permission('cases', 'create') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(length(v_id), 0) not between 1 and 320
     or coalesce(length(trim(p_subject)), 0) not between 1 and 300
     or coalesce(length(p_from), 0) not between 3 and 320
     or p_from !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or length(coalesce(p_body, '')) > 100000
     or coalesce(cardinality(p_references), 0) > 50
     or length(coalesce(p_in_reply_to, '')) > 320 then
    raise exception 'Invalid email metadata' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_references, '{}')) r where length(r) > 320) then
    raise exception 'Invalid message reference' using errcode = '22023';
  end if;

  select array_agg(distinct btrim(id, E' <>\r\n\t') order by btrim(id, E' <>\r\n\t')) into v_keys
  from unnest(array[v_id, p_in_reply_to] || coalesce(p_references, '{}')) id
  where coalesce(btrim(id, E' <>\r\n\t'), '') <> '';
  -- All overlapping reference chains lock in the same order. The lock protects
  -- read-then-create and append operations without bypassing any RLS policy.
  foreach v_key in array v_keys loop
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  end loop;

  select * into v_case from public.crm_cases c
  where c.deleted_at is null and (
    btrim(c.source_message_id, E' <>\r\n\t') = any(v_keys) or c.source_message_ids && v_keys
  ) order by c.created_at, c.id limit 1 for update;

  if found then
    if not public.crm_has_permission('cases', 'edit') then
      raise exception 'Not allowed to update cases' using errcode = '42501';
    end if;
    v_updated := true;
    v_processed := case when jsonb_typeof(v_case.meta -> 'email_message_ids') = 'array'
      then v_case.meta -> 'email_message_ids' else '[]'::jsonb end;
    -- Repeating the same request must neither append history nor reopen a case.
    if btrim(v_case.source_message_id, E' <>\r\n\t') = v_id or v_processed ? v_id then
      return jsonb_build_object('record', jsonb_build_object('id', v_case.id), 'updated', true);
    end if;
    v_description := concat_ws(E'\n\n', nullif(v_case.description, ''),
      p_subject || E'\n' || p_from || E'\n' || left(coalesce(nullif(p_body, ''), p_subject), 10000));
    if length(v_description) > 1000000 then
      raise exception 'Case email history is full' using errcode = '54000';
    end if;
    update public.crm_cases set description = v_description, status = 'working',
      source_message_ids = array(select distinct unnest(v_case.source_message_ids || v_keys)),
      meta = jsonb_set(v_case.meta, '{email_message_ids}', v_processed || to_jsonb(v_id), true)
    where id = v_case.id returning * into v_case;
    if not found then raise exception 'record_not_found' using errcode = 'P0002'; end if;
  else
    insert into public.crm_cases (
      subject, description, type, priority, queue, status, account_id, contact_id,
      source_email, source_message_id, source_message_ids, meta
    ) values (
      trim(p_subject), left(coalesce(nullif(p_body, ''), p_subject), 10000), 'question',
      p_priority, p_queue, 'new', p_account_id, p_contact_id, p_from, v_id, v_keys,
      jsonb_build_object('email_message_ids', jsonb_build_array(v_id))
    ) returning * into v_case;
  end if;
  return jsonb_build_object('record', jsonb_build_object('id', v_case.id), 'updated', v_updated);
end;
$$;
revoke all on function public.crm_case_from_email(text, text, text, text, text, text[], uuid, uuid, text, text) from public, anon;
grant execute on function public.crm_case_from_email(text, text, text, text, text, text[], uuid, uuid, text, text) to authenticated, service_role;
commit;
