-- Run before the original module seeds, including when upgrading a customised
-- core installation. Existing installations must include this backfilled version
-- with `supabase db push --include-all`; never replay already applied seeds.
begin;
set local lock_timeout = '5s';

-- Add only the new module to roles that already exist. Missing roles and custom
-- roles receive no grant; explicit none/[]/null and all existing cells survive.
create or replace function public.crm_add_module_permissions(
  p_matrix jsonb, p_module text, p_defaults jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_matrix jsonb := p_matrix;
  v_role record;
begin
  if jsonb_typeof(p_matrix) is distinct from 'object'
     or jsonb_typeof(p_defaults) is distinct from 'object'
     or coalesce(p_module, '') = '' then
    raise exception 'Invalid permission defaults' using errcode = '22023';
  end if;
  for v_role in select key, value from jsonb_each(p_matrix) loop
    if jsonb_typeof(v_role.value) = 'object'
       and not (v_role.value ? p_module)
       and p_defaults ? v_role.key then
      v_matrix := jsonb_set(v_matrix, array[v_role.key, p_module], p_defaults -> v_role.key, true);
    end if;
  end loop;
  return v_matrix;
end;
$$;
revoke all on function public.crm_add_module_permissions(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.crm_add_module_permissions(jsonb, text, jsonb) to service_role;

-- Adapt the three immutable historical full-matrix seeds during this upgrade.
-- Each seed can introduce only its own module, before its table is created.
create or replace function public.crm_preserve_module_seed()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_module text;
  v_table text;
  v_defaults jsonb;
begin
  if auth.uid() is not null or not public.crm_is_privileged_session() then
    return NEW;
  end if;
  if (NEW.matrix -> 'super_admin') ? 'cases' then
    v_module := 'cases'; v_table := 'public.crm_cases';
  elsif (NEW.matrix -> 'super_admin') ? 'email' then
    v_module := 'email'; v_table := 'public.crm_email_accounts';
  elsif (NEW.matrix -> 'super_admin') ? 'industry_news' then
    v_module := 'industry_news'; v_table := 'public.crm_industry_news_configs';
  else
    raise exception 'Use incremental module permission defaults' using errcode = '22023';
  end if;
  if to_regclass(v_table) is null then
    select jsonb_object_agg(key, value -> v_module) into v_defaults
    from jsonb_each(NEW.matrix)
    where key in ('super_admin', 'sales_manager', 'sales_rep', 'read_only')
      and value ? v_module;
    NEW.matrix := public.crm_add_module_permissions(OLD.matrix, v_module, coalesce(v_defaults, '{}'::jsonb));
  else
    NEW.matrix := OLD.matrix;
  end if;
  return NEW;
end;
$$;
revoke all on function public.crm_preserve_module_seed() from public, anon, authenticated;
drop trigger if exists trg_crm_preserve_module_seed on public.crm_access_control;
create trigger trg_crm_preserve_module_seed
before update of matrix on public.crm_access_control
for each row execute function public.crm_preserve_module_seed();
commit;
