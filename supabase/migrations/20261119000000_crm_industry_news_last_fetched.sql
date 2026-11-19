-- Track the last successful industry-news ingest separately from config edits.
-- crm_industry_news_configs.updated_at only changes when an admin saves the
-- configuration, so the page header previously kept showing the config date
-- even after a manual or scheduled fetch. A small state table avoids writing
-- to the audited config row on every daily ingest.

create table if not exists public.crm_industry_news_fetch_state (
  config_id uuid primary key
    references public.crm_industry_news_configs (id) on delete cascade,
  last_fetched_at timestamptz not null default now()
);

alter table public.crm_industry_news_fetch_state enable row level security;

drop policy if exists "industry news fetch state read" on public.crm_industry_news_fetch_state;
create policy "industry news fetch state read"
on public.crm_industry_news_fetch_state as permissive
for select to authenticated
using (
  exists (
    select 1
    from public.crm_industry_news_configs c
    where c.id = public.crm_industry_news_fetch_state.config_id
      and c.is_global
      and c.deleted_at is null
      and public.crm_has_permission('industry_news', 'view')
  )
);

revoke all on public.crm_industry_news_fetch_state from public, anon, authenticated;
grant select on public.crm_industry_news_fetch_state to authenticated, service_role;

-- Existing installs inherit the newest article fetch as the initial value;
-- an install with no articles falls back to the config update time.
insert into public.crm_industry_news_fetch_state (config_id, last_fetched_at)
select c.id, coalesce(max(i.fetched_at), c.updated_at)
from public.crm_industry_news_configs c
left join public.crm_industry_news_items i
  on i.config_id = c.id
 and i.deleted_at is null
where c.deleted_at is null
group by c.id, c.updated_at
on conflict (config_id) do nothing;

-- Bootstrap returns both timestamps: updatedAt for config edits and
-- lastFetchedAt for the last successful ingest (manual or cron).
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
  v_last_fetched_at timestamptz;
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
      'updatedAt', null, 'lastFetchedAt', null, 'items', '[]'::jsonb
    );
  end if;

  select s.last_fetched_at into v_last_fetched_at
  from public.crm_industry_news_fetch_state s
  where s.config_id = v_config.id;

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
    'lastFetchedAt', v_last_fetched_at,
    'items', v_items
  );
end;
$$;

-- Every ingest (UI button or Vercel Cron) stamps the fetch state, even when
-- no article was added or updated. This is what the header should display.
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
  v_last_fetched_at timestamptz := now();
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

  insert into public.crm_industry_news_fetch_state (config_id, last_fetched_at)
  values (p_config_id, v_last_fetched_at)
  on conflict (config_id) do update set last_fetched_at = excluded.last_fetched_at;

  return jsonb_build_object(
    'added', v_added,
    'updated', v_updated,
    'purged', v_purged,
    'lastFetchedAt', v_last_fetched_at
  );
end;
$$;
