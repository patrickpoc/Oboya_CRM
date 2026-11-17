-- Oboya CRM 10/8: Industry News global configuration + scheduled ingest.
-- One shared config/articles set for the whole CRM: authenticated users read,
-- only super admins write through the UI, and the service role writes from cron.

begin;
set local lock_timeout = '5s';
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Global marker. Existing per-user rows stay as legacy (is_global = false)
-- but the app no longer creates or reads them.
-- ---------------------------------------------------------------------------
alter table public.crm_industry_news_configs
  add column if not exists is_global boolean not null default false;
alter table public.crm_industry_news_items
  add column if not exists is_global boolean not null default false;

create unique index if not exists crm_industry_news_configs_global_uq
  on public.crm_industry_news_configs (is_global)
  where is_global and deleted_at is null;

update public.crm_industry_news_items i
set is_global = true
from public.crm_industry_news_configs c
where c.id = i.config_id and c.is_global and i.is_global = false;

-- ---------------------------------------------------------------------------
-- RLS: everyone with `industry_news:view` reads the global rows; writes to
-- global rows require an active super_admin. Legacy rows keep their old rules.
-- ---------------------------------------------------------------------------
drop policy if exists crm_industry_news_configs_select on public.crm_industry_news_configs;
create policy crm_industry_news_configs_select on public.crm_industry_news_configs
  for select to authenticated
  using (
    (select public.crm_has_permission('industry_news', 'view'))
    and (deleted_at is null or (select public.crm_is_admin()))
    and (is_global or public.crm_can_see(owner_id))
  );

drop policy if exists crm_industry_news_configs_insert on public.crm_industry_news_configs;
create policy crm_industry_news_configs_insert on public.crm_industry_news_configs
  for insert to authenticated
  with check ((select public.crm_is_admin()) and is_global and deleted_at is null);

drop policy if exists crm_industry_news_configs_update on public.crm_industry_news_configs;
create policy crm_industry_news_configs_update on public.crm_industry_news_configs
  for update to authenticated
  using ((select public.crm_is_admin()) and is_global and deleted_at is null)
  with check ((select public.crm_is_admin()) and is_global and deleted_at is null);

drop policy if exists crm_industry_news_items_select on public.crm_industry_news_items;
create policy crm_industry_news_items_select on public.crm_industry_news_items
  for select to authenticated
  using (
    (select public.crm_has_permission('industry_news', 'view'))
    and (deleted_at is null or (select public.crm_is_admin()))
    and (is_global or public.crm_can_see(owner_id))
  );

drop policy if exists crm_industry_news_items_insert on public.crm_industry_news_items;
create policy crm_industry_news_items_insert on public.crm_industry_news_items
  for insert to authenticated
  with check ((select public.crm_is_admin()) and is_global and deleted_at is null);

drop policy if exists crm_industry_news_items_update on public.crm_industry_news_items;
create policy crm_industry_news_items_update on public.crm_industry_news_items
  for update to authenticated
  using ((select public.crm_is_admin()) and is_global and deleted_at is null)
  with check ((select public.crm_is_admin()) and is_global and deleted_at is null);

-- ---------------------------------------------------------------------------
-- Global singleton helpers. The owner is an active super admin so the FK and
-- audit columns stay meaningful; visibility comes from `is_global`, not owner.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_global_owner()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from public.crm_users u
  where u.role = 'super_admin' and u.status = 'active'
  order by u.created_at, u.id
  limit 1;
$$;

create or replace function public.crm_industry_news_ensure_global_config(
  p_name text,
  p_config jsonb
)
returns public.crm_industry_news_configs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_row public.crm_industry_news_configs;
begin
  if p_name is null or length(trim(p_name)) = 0 or jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'Invalid config' using errcode = '22023';
  end if;

  v_owner := public.crm_industry_news_global_owner();
  if v_owner is null then
    raise exception 'No active super admin owns the global config' using errcode = '42501';
  end if;

  update public.crm_industry_news_configs
  set name = trim(p_name), config = p_config, is_global = true, updated_at = now()
  where is_global and deleted_at is null
  returning * into v_row;
  if found then
    return v_row;
  end if;

  -- An admin's legacy personal config can be promoted instead of conflicting
  -- with the old owner_id unique index.
  select * into v_row
  from public.crm_industry_news_configs
  where owner_id = v_owner and is_global = false and deleted_at is null;
  if found then
    update public.crm_industry_news_configs
    set name = trim(p_name), config = p_config, is_global = true, updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.crm_industry_news_configs (owner_id, is_global, name, config, created_by)
  values (v_owner, true, trim(p_name), p_config, v_owner)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writer check used by ingest + AI RPCs: an admin session or the service role
-- from cron, never an ordinary user. Returns the global config's owner id.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_ingest_actor(p_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select c.owner_id into v_owner
  from public.crm_industry_news_configs c
  where c.id = p_config_id and c.is_global and c.deleted_at is null;
  if not found then
    raise exception 'config_not_found' using errcode = 'P0002';
  end if;

  if auth.uid() is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
  elsif not public.crm_is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return v_owner;
end;
$$;

-- ---------------------------------------------------------------------------
-- Config save: super admins only, writes the global singleton.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_save_config(p_name text, p_config jsonb)
returns public.crm_industry_news_configs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.crm_is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return public.crm_industry_news_ensure_global_config(p_name, p_config);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap reads the shared config, not the caller's personal row.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_bootstrap(
  p_limit integer default 50,
  p_cursor_weight numeric default null,
  p_cursor_fetched_at timestamptz default null,
  p_cursor_id uuid default null,
  p_keyword text default null,
  p_source text default null,
  p_industry text default null,
  p_region text default null,
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_config public.crm_industry_news_configs;
  v_items jsonb;
begin
  if not public.crm_has_permission('industry_news', 'view') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select c.* into v_config
  from public.crm_industry_news_configs c
  where c.is_global and c.deleted_at is null;

  if not found then
    return jsonb_build_object(
      'configId', null, 'config', null, 'name', 'Industry news', 'saved', false,
      'updatedAt', null, 'items', '[]'::jsonb
    );
  end if;

  v_items := public.crm_industry_news_page(
    v_config.id, p_limit, p_cursor_weight, p_cursor_fetched_at, p_cursor_id,
    p_keyword, p_source, p_industry, p_region, p_search, p_from, p_to, p_today
  );

  return jsonb_build_object(
    'configId', v_config.id,
    'config', v_config.config,
    'name', v_config.name,
    'saved', true,
    'updatedAt', v_config.updated_at,
    'items', v_items
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Batched ingest: owner/created_by come from the global config row, so the
-- same data is written whether the caller is an admin UI session or cron.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_ingest(
  p_config_id uuid,
  p_inserts jsonb default '[]'::jsonb,
  p_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.crm_industry_news_ingest_actor(p_config_id);
  v_added integer := 0;
  v_updated integer := 0;
  v_purged integer := 0;
begin
  with incoming as (
    select x.*
    from jsonb_to_recordset(coalesce(p_inserts, '[]'::jsonb)) as x(
      title text, url text, source_id text, source_name text, source_type text,
      rank integer, ranks jsonb, rank_timeline jsonb, first_seen_at text,
      last_seen_at text, seen_count integer, published_at timestamptz,
      summary text, author text, matched_keywords jsonb, industries text[],
      regions text[], is_new boolean, weight numeric, fetched_at timestamptz,
      news_date date
    )
  )
  insert into public.crm_industry_news_items (
    owner_id, config_id, created_by, is_global, title, url, source_id, source_name,
    source_type, rank, ranks, rank_timeline, first_seen_at, last_seen_at, seen_count,
    published_at, summary, author, matched_keywords, industries, regions, is_new,
    weight, fetched_at, news_date
  )
  select v_owner, p_config_id, v_owner, true, x.title, x.url, x.source_id, x.source_name,
         x.source_type, x.rank, x.ranks, x.rank_timeline, x.first_seen_at, x.last_seen_at,
         x.seen_count, x.published_at, x.summary, x.author, x.matched_keywords, x.industries,
         x.regions, x.is_new, x.weight, x.fetched_at, x.news_date
  from incoming x
  on conflict (config_id, source_id, url) where deleted_at is null do nothing;
  get diagnostics v_added = row_count;

  with incoming as (
    select x.*
    from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as x(
      id uuid, rank integer, ranks jsonb, rank_timeline jsonb, last_seen_at text,
      seen_count integer, published_at timestamptz, summary text, matched_keywords jsonb,
      industries text[], regions text[], is_new boolean, weight numeric,
      fetched_at timestamptz, news_date date
    )
  )
  update public.crm_industry_news_items i
  set rank = x.rank, ranks = x.ranks, rank_timeline = x.rank_timeline,
      last_seen_at = x.last_seen_at, seen_count = x.seen_count,
      published_at = x.published_at, summary = x.summary,
      matched_keywords = x.matched_keywords, industries = x.industries,
      regions = x.regions, is_new = x.is_new, weight = x.weight,
      fetched_at = x.fetched_at, news_date = x.news_date
  from incoming x
  where i.id = x.id and i.config_id = p_config_id and i.deleted_at is null;
  get diagnostics v_updated = row_count;

  v_purged := public.crm_industry_news_retention(1000);
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'purged', v_purged);
end;
$$;

-- ---------------------------------------------------------------------------
-- AI cycle: same actor rule as ingest, so cron can enrich global articles.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_ai_claim(p_config_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.crm_industry_news_ingest_actor(p_config_id);
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 20);
  v_result jsonb;
begin
  with claimed as (
    select i.id
    from public.crm_industry_news_items i
    where i.config_id = p_config_id
      and i.deleted_at is null
      and i.ai_analyzed_at is null
      and (i.ai_claimed_at is null or i.ai_claimed_at < now() - interval '10 minutes')
    order by i.weight desc, i.fetched_at desc, i.id desc
    limit v_limit
    for update skip locked
  ), updated as (
    update public.crm_industry_news_items i
    set ai_claimed_at = now()
    from claimed c
    where i.id = c.id
    returning i.*
  )
  select coalesce(jsonb_agg(to_jsonb(u) order by u.weight desc, u.fetched_at desc, u.id desc), '[]'::jsonb)
  into v_result
  from updated u;

  return v_result;
end;
$$;

create or replace function public.crm_industry_news_ai_save(
  p_config_id uuid,
  p_results jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.crm_industry_news_ingest_actor(p_config_id);
  v_count integer := 0;
begin
  with incoming as (
    select x.*
    from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as x(
      id uuid, ai_title text, ai_summary text, ai_language text, ai_model text
    )
  )
  update public.crm_industry_news_items i
  set ai_title = x.ai_title, ai_summary = x.ai_summary, ai_language = x.ai_language,
      ai_model = x.ai_model, ai_analyzed_at = now(), ai_claimed_at = null
  from incoming x
  where i.id = x.id and i.config_id = p_config_id and i.deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.crm_industry_news_ai_release(p_config_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.crm_industry_news_ingest_actor(p_config_id);
begin
  update public.crm_industry_news_items
  set ai_claimed_at = null
  where config_id = p_config_id and is_global and ai_analyzed_at is null and ai_claimed_at is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges stay explicit; internal helpers are not callable by the
-- browser. Existing RPC signatures are unchanged, so prior grants still apply.
-- ---------------------------------------------------------------------------
revoke all on function public.crm_industry_news_global_owner() from public, anon, authenticated;
revoke all on function public.crm_industry_news_ensure_global_config(text, jsonb) from public, anon, authenticated;
revoke all on function public.crm_industry_news_ingest_actor(uuid) from public, anon, authenticated;

grant execute on function public.crm_industry_news_global_owner() to service_role;
grant execute on function public.crm_industry_news_ensure_global_config(text, jsonb) to service_role;
grant execute on function public.crm_industry_news_ingest_actor(uuid) to service_role;

commit;
