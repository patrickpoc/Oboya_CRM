-- Schedule the automation runner every 15 minutes with pg_cron. pg_cron is
-- optional: without it the daily Vercel cron (/api/crm/automation/cron) is the
-- only trigger. Same job name = upsert, so re-running cannot duplicate it.
-- No begin/commit; idempotent.

do $cron$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron unavailable; automation runs only from the daily Vercel cron';
  end;
end
$cron$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'crm-automation-run',
      '*/15 * * * *',
      $cmd$select public.crm_run_automation(now(), 'pg_cron', null);$cmd$
    );
  else
    raise notice 'pg_cron not installed; crm-automation-run not scheduled';
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;
