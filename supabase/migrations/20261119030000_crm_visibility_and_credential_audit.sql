-- Complete parent-visible activity audits and remove historical credential
-- copies without changing event identity, actor, time or unrelated differences.
begin;
set local lock_timeout = '5s';

-- Activity SELECT already inherits parent visibility. Use that same RLS read
-- here; broadening the generic activity helper would also broaden deletion.
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
        when 'activity' then record_id is not null and exists (
          select 1 from public.crm_activities a where a.id = crm_audit_logs.record_id
        )
        else record_id is not null and public.crm_can_see_record(object, record_id)
      end
    )
  );

-- The current trigger masks future writes. This narrowly repairs prior events
-- in the live audit table; backups and exported copies are outside this table.
with candidates as materialized (
  select id, diff -> 'password_encrypted' as pair
  from public.crm_audit_logs
  where object = 'email_account' and diff ? 'password_encrypted'
), redacted as (
  select id, case
    when jsonb_typeof(pair) is distinct from 'array' then '"[redacted]"'::jsonb
    when jsonb_array_length(pair) <> 2 then '"[redacted]"'::jsonb
    else jsonb_build_array(
      case when pair -> 0 = 'null'::jsonb then 'null'::jsonb else '"[redacted]"'::jsonb end,
      case
        when pair -> 1 = 'null'::jsonb then 'null'::jsonb
        when pair -> 1 in ('"[redacted]"'::jsonb, '"[redacted, changed]"'::jsonb) then pair -> 1
        when pair -> 0 <> 'null'::jsonb and pair -> 0 is distinct from pair -> 1
          then '"[redacted, changed]"'::jsonb
        else '"[redacted]"'::jsonb
      end
    ) end as pair
  from candidates
)
update public.crm_audit_logs l
set diff = jsonb_set(l.diff, '{password_encrypted}', r.pair, false)
from redacted r
where l.id = r.id and (l.diff -> 'password_encrypted') is distinct from r.pair;
commit;
