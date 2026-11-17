-- Oboya CRM 9/8: Industry News hardening.
-- AI columns, 30-day retention, cursor pagination, deferred joins and batched
-- RPC writes. Every RPC is scoped by RLS or explicit owner/permission checks.

begin;
set local lock_timeout = '5s';
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- AI enrichment lives on the article row, so it can never become an orphan.
-- Claims make a scan -> model -> save cycle safe when two ingests overlap.
-- ---------------------------------------------------------------------------
alter table public.crm_industry_news_items
  add column if not exists ai_title text,
  add column if not exists ai_summary text,
  add column if not exists ai_language text,
  add column if not exists ai_model text,
  add column if not exists ai_analyzed_at timestamptz,
  add column if not exists ai_claimed_at timestamptz;

alter table public.crm_industry_news_items
  drop constraint if exists crm_industry_news_items_ai_language_check;
alter table public.crm_industry_news_items
  add constraint crm_industry_news_items_ai_language_check
  check (ai_language is null or ai_language in ('en', 'zh-CN', 'es', 'pt-BR'));

-- ---------------------------------------------------------------------------
-- Indexes for the actual access paths:
--   page 1..N by (config, weight, fetched_at, id) with a keyset cursor
--   date-window scans and the array/jsonb/trigram filters
--   pending-AI claim scans
-- All are partial on live rows, so soft-deleted rows do not bloat them.
-- ---------------------------------------------------------------------------
create index if not exists crm_industry_news_items_cursor_idx
  on public.crm_industry_news_items (config_id, weight desc, fetched_at desc, id desc)
  where deleted_at is null;
create index if not exists crm_industry_news_items_date_cursor_idx
  on public.crm_industry_news_items (config_id, news_date desc, weight desc, id desc)
  where deleted_at is null;
create index if not exists crm_industry_news_items_keywords_idx
  on public.crm_industry_news_items using gin (matched_keywords)
  where deleted_at is null;
create index if not exists crm_industry_news_items_title_trgm_idx
  on public.crm_industry_news_items using gin (title gin_trgm_ops)
  where deleted_at is null;
create index if not exists crm_industry_news_items_ai_pending_idx
  on public.crm_industry_news_items (config_id, weight desc, fetched_at desc)
  where deleted_at is null and ai_analyzed_at is null;

-- ---------------------------------------------------------------------------
-- 30-day retention. Batches of 1000 keep each transaction short; the cron job
-- is a safety net and ingest also calls it with a smaller budget.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_retention(p_max_rows integer default 20000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_max_rows, 20000), 1), 50000);
  v_rows integer;
  v_total integer := 0;
begin
  if auth.uid() is not null and not public.crm_is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  loop
    with doomed as (
      select i.id
      from public.crm_industry_news_items i
      where i.news_date < (current_date - 30)
         or (i.deleted_at is not null and i.deleted_at < now() - interval '30 days')
      order by i.news_date
      limit 1000
    )
    delete from public.crm_industry_news_items i using doomed d where i.id = d.id;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    exit when v_rows = 0 or v_total >= v_limit;
  end loop;

  -- Soft-deleted configs older than 30 days cascade to their remaining items.
  with doomed_configs as (
    select c.id
    from public.crm_industry_news_configs c
    where c.deleted_at is not null and c.deleted_at < now() - interval '30 days'
    limit 200
  )
  delete from public.crm_industry_news_configs c using doomed_configs d where c.id = d.id;

  return v_total;
end;
$$;

-- pg_cron is optional; if the platform does not expose it, ingest still purges.
do $cron$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron unavailable; industry news retention runs on ingest only';
  end;
end
$cron$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Same job name is an upsert, so a repeated migration cannot duplicate it.
    perform cron.schedule(
      'crm-industry-news-retention',
      '17 3 * * *',
      'select public.crm_industry_news_retention();'
    );
    perform cron.schedule(
      'crm-industry-news-cron-history',
      '27 3 * * *',
      $cmd$delete from cron.job_run_details where end_time < now() - interval '7 days'$cmd$
    );
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- One call for config save (upsert) instead of read + insert/update.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_save_config(p_name text, p_config jsonb)
returns public.crm_industry_news_configs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.crm_industry_news_configs;
begin
  if auth.uid() is null or not public.crm_is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.crm_can_write()
     or not (public.crm_has_permission('industry_news', 'create')
             or public.crm_has_permission('industry_news', 'edit')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'Invalid config' using errcode = '22023';
  end if;

  insert into public.crm_industry_news_configs (owner_id, name, config, created_by)
  values (auth.uid(), trim(p_name), p_config, auth.uid())
  on conflict (owner_id) where deleted_at is null
  do update set name = excluded.name, config = excluded.config
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cursor page. A narrow CTE selects only ids (deferred join), then the wide
-- article rows are fetched in the same statement. No OFFSET, so deep pages
-- stay as fast as page 1. SECURITY INVOKER keeps RLS active.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_page(
  p_config_id uuid,
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
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_config jsonb;
  v_result jsonb;
begin
  if not public.crm_has_permission('industry_news', 'view') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select c.config into v_config
  from public.crm_industry_news_configs c
  where c.id = p_config_id and c.deleted_at is null;
  if not found then
    return '[]'::jsonb;
  end if;

  with page as (
    select i.id
    from public.crm_industry_news_items i
    where i.config_id = p_config_id
      and i.deleted_at is null
      and (p_cursor_weight is null
           or (i.weight, i.fetched_at, i.id) < (p_cursor_weight, p_cursor_fetched_at, p_cursor_id))
      and (p_keyword is null or i.matched_keywords ? p_keyword)
      and (p_source is null or i.source_id = p_source)
      and (p_industry is null or p_industry = any(i.industries))
      and (p_region is null or p_region = any(i.regions))
      and (p_search is null or i.title ilike '%' || p_search || '%')
      and (p_from is null or i.news_date >= p_from)
      and (p_to is null or i.news_date <= p_to)
      and (coalesce(v_config ->> 'reportMode', 'current') <> 'daily'
           or i.news_date = coalesce(p_today, current_date))
      and (coalesce(v_config ->> 'reportMode', 'current') <> 'incremental' or i.is_new)
      and (coalesce((v_config ->> 'freshnessDays')::int, 0) <= 0
           or coalesce(i.published_at, i.fetched_at)
              >= now() - make_interval(days => (v_config ->> 'freshnessDays')::int))
    order by i.weight desc, i.fetched_at desc, i.id desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(to_jsonb(i) order by i.weight desc, i.fetched_at desc, i.id desc),
    '[]'::jsonb
  )
  into v_result
  from public.crm_industry_news_items i
  join page p on p.id = i.id;

  return v_result;
end;
$$;

-- One initial request returns config + first page together.
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
  where c.owner_id = auth.uid() and c.deleted_at is null;

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
-- Batched ingest: inserts, updates and retention in one database round trip.
-- IDs/owners are always taken from the session, never from client JSON.
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
  v_added integer := 0;
  v_updated integer := 0;
  v_purged integer := 0;
begin
  if auth.uid() is null or not public.crm_is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.crm_can_write() or not public.crm_has_permission('industry_news', 'edit') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.crm_industry_news_configs c
    where c.id = p_config_id and c.owner_id = auth.uid() and c.deleted_at is null
  ) then
    raise exception 'config_not_found' using errcode = 'P0002';
  end if;

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
    owner_id, config_id, created_by, title, url, source_id, source_name, source_type,
    rank, ranks, rank_timeline, first_seen_at, last_seen_at, seen_count, published_at,
    summary, author, matched_keywords, industries, regions, is_new, weight, fetched_at, news_date
  )
  select auth.uid(), p_config_id, auth.uid(), x.title, x.url, x.source_id, x.source_name,
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
-- AI batch cycle: claim N unanalysed articles, call the model once per article
-- outside the DB, then save all results in one call. A stale claim expires in
-- 10 minutes; `release` clears claims after a failed model run.
-- ---------------------------------------------------------------------------
create or replace function public.crm_industry_news_ai_claim(p_config_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 20);
  v_result jsonb;
begin
  if auth.uid() is null or not public.crm_is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.crm_can_write() or not public.crm_has_permission('industry_news', 'edit') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.crm_industry_news_configs c
    where c.id = p_config_id and c.owner_id = auth.uid() and c.deleted_at is null
  ) then
    raise exception 'config_not_found' using errcode = 'P0002';
  end if;

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
  v_count integer := 0;
begin
  if auth.uid() is null or not public.crm_is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.crm_can_write() or not public.crm_has_permission('industry_news', 'edit') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

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
begin
  if auth.uid() is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.crm_industry_news_items
  set ai_claimed_at = null
  where config_id = p_config_id and ai_analyzed_at is null and ai_claimed_at is not null;
end;
$$;

revoke all on function public.crm_industry_news_retention(integer) from public, anon;
revoke all on function public.crm_industry_news_save_config(text, jsonb) from public, anon;
revoke all on function public.crm_industry_news_page(uuid, integer, numeric, timestamptz, uuid, text, text, text, text, text, date, date, date) from public, anon;
revoke all on function public.crm_industry_news_bootstrap(integer, numeric, timestamptz, uuid, text, text, text, text, text, date, date, date) from public, anon;
revoke all on function public.crm_industry_news_ingest(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.crm_industry_news_ai_claim(uuid, integer) from public, anon;
revoke all on function public.crm_industry_news_ai_save(uuid, jsonb) from public, anon;
revoke all on function public.crm_industry_news_ai_release(uuid) from public, anon;

grant execute on function public.crm_industry_news_retention(integer) to authenticated, service_role;
grant execute on function public.crm_industry_news_save_config(text, jsonb) to authenticated, service_role;
grant execute on function public.crm_industry_news_page(uuid, integer, numeric, timestamptz, uuid, text, text, text, text, text, date, date, date) to authenticated, service_role;
grant execute on function public.crm_industry_news_bootstrap(integer, numeric, timestamptz, uuid, text, text, text, text, text, date, date, date) to authenticated, service_role;
grant execute on function public.crm_industry_news_ingest(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.crm_industry_news_ai_claim(uuid, integer) to authenticated, service_role;
grant execute on function public.crm_industry_news_ai_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.crm_industry_news_ai_release(uuid) to authenticated, service_role;

commit;
