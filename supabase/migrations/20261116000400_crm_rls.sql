-- Oboya CRM 4/6: row level security policies.
-- Depends on 000100..000300. Idempotent (drop policy if exists + create).
--
-- Summary
--   Objects (accounts, contacts, leads, opportunities):
--     select  crm_can_see(owner_id), and deleted rows only for super_admin
--     insert  crm_can_write() and owner visible to the inserter, not deleted
--     update  same as select (old row) + crm_can_write() and new owner visible;
--             only super_admin may write deleted_at (non-admins soft delete
--             through crm_soft_delete(), see 000600)
--     delete  no policy: hard delete only with the service role
--   Activities: as objects, but visible when the owner OR the parent record
--     (what_object/what_id) is visible: crm_can_see_record().
--   Configuration tables: read by any active CRM user, written by super_admin.
--   crm_users: read by active users (directory) and by yourself; written by
--     super_admin; self-update allowed, columns limited by crm_users_guard.
--   crm_audit_logs: no client writes; read by super_admin, and by users with
--     the audit_logs.view permission for records they can currently see.
--   Permission matrix (crm_has_permission, see 000100): insert needs
--     <module>.create, update needs <module>.edit; soft delete (RPC) needs
--     <module>.delete; convert (RPC) needs leads.convert.
--   All policies target "authenticated"; anon gets nothing.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- crm_can_see_record(object, id): can the current user see that parent record?
-- Deleted parents count as visible only for super_admin.
-- ---------------------------------------------------------------------------
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
    else
      return false;
  end case;

  if v_owner is null then
    return false;
  end if;
  if v_deleted is not null and not public.crm_is_admin() then
    return false;
  end if;
  return public.crm_can_see(v_owner);
end;
$$;

revoke all on function public.crm_can_see_record(text, uuid) from public, anon;
grant execute on function public.crm_can_see_record(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Object tables
-- ---------------------------------------------------------------------------

-- crm_accounts
drop policy if exists crm_accounts_select on public.crm_accounts;
create policy crm_accounts_select on public.crm_accounts
  for select to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())));

drop policy if exists crm_accounts_insert on public.crm_accounts;
create policy crm_accounts_insert on public.crm_accounts
  for insert to authenticated
  with check ((select public.crm_can_write()) and (select public.crm_has_permission('accounts', 'create')) and public.crm_can_see(owner_id) and deleted_at is null);

drop policy if exists crm_accounts_update on public.crm_accounts;
create policy crm_accounts_update on public.crm_accounts
  for update to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())))
  with check (
    (select public.crm_can_write()) and (select public.crm_has_permission('accounts', 'edit')) and public.crm_can_see(owner_id)
    and (deleted_at is null or (select public.crm_is_admin()))
  );

-- crm_contacts
drop policy if exists crm_contacts_select on public.crm_contacts;
create policy crm_contacts_select on public.crm_contacts
  for select to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())));

drop policy if exists crm_contacts_insert on public.crm_contacts;
create policy crm_contacts_insert on public.crm_contacts
  for insert to authenticated
  with check ((select public.crm_can_write()) and (select public.crm_has_permission('contacts', 'create')) and public.crm_can_see(owner_id) and deleted_at is null);

drop policy if exists crm_contacts_update on public.crm_contacts;
create policy crm_contacts_update on public.crm_contacts
  for update to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())))
  with check (
    (select public.crm_can_write()) and (select public.crm_has_permission('contacts', 'edit')) and public.crm_can_see(owner_id)
    and (deleted_at is null or (select public.crm_is_admin()))
  );

-- crm_leads
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())));

drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
  for insert to authenticated
  with check ((select public.crm_can_write()) and (select public.crm_has_permission('leads', 'create')) and public.crm_can_see(owner_id) and deleted_at is null);

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())))
  with check (
    (select public.crm_can_write()) and (select public.crm_has_permission('leads', 'edit')) and public.crm_can_see(owner_id)
    and (deleted_at is null or (select public.crm_is_admin()))
  );

-- crm_opportunities
drop policy if exists crm_opportunities_select on public.crm_opportunities;
create policy crm_opportunities_select on public.crm_opportunities
  for select to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())));

drop policy if exists crm_opportunities_insert on public.crm_opportunities;
create policy crm_opportunities_insert on public.crm_opportunities
  for insert to authenticated
  with check ((select public.crm_can_write()) and (select public.crm_has_permission('opportunities', 'create')) and public.crm_can_see(owner_id) and deleted_at is null);

drop policy if exists crm_opportunities_update on public.crm_opportunities;
create policy crm_opportunities_update on public.crm_opportunities
  for update to authenticated
  using (public.crm_can_see(owner_id) and (deleted_at is null or (select public.crm_is_admin())))
  with check (
    (select public.crm_can_write()) and (select public.crm_has_permission('opportunities', 'edit')) and public.crm_can_see(owner_id)
    and (deleted_at is null or (select public.crm_is_admin()))
  );

-- crm_activities: owner OR parent visible
drop policy if exists crm_activities_select on public.crm_activities;
create policy crm_activities_select on public.crm_activities
  for select to authenticated
  using (
    (deleted_at is null or (select public.crm_is_admin()))
    and (public.crm_can_see(owner_id) or public.crm_can_see_record(what_object, what_id))
  );

drop policy if exists crm_activities_insert on public.crm_activities;
create policy crm_activities_insert on public.crm_activities
  for insert to authenticated
  with check (
    (select public.crm_can_write()) and (select public.crm_has_permission('activities', 'create'))
    and public.crm_can_see(owner_id)
    and deleted_at is null
    and (what_id is null or public.crm_can_see_record(what_object, what_id))
  );

drop policy if exists crm_activities_update on public.crm_activities;
create policy crm_activities_update on public.crm_activities
  for update to authenticated
  using (
    (deleted_at is null or (select public.crm_is_admin()))
    and (public.crm_can_see(owner_id) or public.crm_can_see_record(what_object, what_id))
  )
  with check (
    (select public.crm_can_write()) and (select public.crm_has_permission('activities', 'edit'))
    and (deleted_at is null or (select public.crm_is_admin()))
    and (public.crm_can_see(owner_id) or public.crm_can_see_record(what_object, what_id))
    and (what_id is null or public.crm_can_see_record(what_object, what_id))
  );

-- crm_account_entities: follows the account; link rows may be deleted
drop policy if exists crm_account_entities_select on public.crm_account_entities;
create policy crm_account_entities_select on public.crm_account_entities
  for select to authenticated
  using (public.crm_can_see_record('account', account_id));

drop policy if exists crm_account_entities_insert on public.crm_account_entities;
create policy crm_account_entities_insert on public.crm_account_entities
  for insert to authenticated
  with check ((select public.crm_can_write()) and (select public.crm_has_permission('accounts', 'edit')) and public.crm_can_see_record('account', account_id));

drop policy if exists crm_account_entities_update on public.crm_account_entities;
create policy crm_account_entities_update on public.crm_account_entities
  for update to authenticated
  using ((select public.crm_can_write()) and (select public.crm_has_permission('accounts', 'edit')) and public.crm_can_see_record('account', account_id))
  with check ((select public.crm_can_write()) and (select public.crm_has_permission('accounts', 'edit')) and public.crm_can_see_record('account', account_id));

drop policy if exists crm_account_entities_delete on public.crm_account_entities;
create policy crm_account_entities_delete on public.crm_account_entities
  for delete to authenticated
  using ((select public.crm_can_write()) and (select public.crm_has_permission('accounts', 'edit')) and public.crm_can_see_record('account', account_id));

-- crm_recent_views: private to each user
drop policy if exists crm_recent_views_own on public.crm_recent_views;
create policy crm_recent_views_own on public.crm_recent_views
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.crm_is_active_user()))
  with check (user_id = (select auth.uid()) and (select public.crm_is_active_user()));

-- ---------------------------------------------------------------------------
-- Configuration tables: read by active users, write by super_admin
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_roles', 'crm_teams', 'crm_access_control', 'crm_picklist_values',
    'crm_pipelines', 'crm_pipeline_stages', 'crm_entities'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.crm_is_active_user()))',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.crm_is_admin()))',
      t || '_admin_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.crm_is_admin())) with check ((select public.crm_is_admin()))',
      t || '_admin_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.crm_is_admin()))',
      t || '_admin_delete', t);
  end loop;
end
$$;

-- crm_settings: admin_only rows are hidden from non-admins
drop policy if exists crm_settings_select on public.crm_settings;
create policy crm_settings_select on public.crm_settings
  for select to authenticated
  using ((select public.crm_is_admin()) or ((select public.crm_is_active_user()) and not admin_only));

drop policy if exists crm_settings_admin_insert on public.crm_settings;
create policy crm_settings_admin_insert on public.crm_settings
  for insert to authenticated with check ((select public.crm_is_admin()));

drop policy if exists crm_settings_admin_update on public.crm_settings;
create policy crm_settings_admin_update on public.crm_settings
  for update to authenticated
  using ((select public.crm_is_admin())) with check ((select public.crm_is_admin()));

drop policy if exists crm_settings_admin_delete on public.crm_settings;
create policy crm_settings_admin_delete on public.crm_settings
  for delete to authenticated using ((select public.crm_is_admin()));

-- ---------------------------------------------------------------------------
-- crm_users
-- ---------------------------------------------------------------------------
drop policy if exists crm_users_select on public.crm_users;
create policy crm_users_select on public.crm_users
  for select to authenticated
  using (id = (select auth.uid()) or (select public.crm_is_active_user()));

drop policy if exists crm_users_admin_insert on public.crm_users;
create policy crm_users_admin_insert on public.crm_users
  for insert to authenticated with check ((select public.crm_is_admin()));

drop policy if exists crm_users_admin_update on public.crm_users;
create policy crm_users_admin_update on public.crm_users
  for update to authenticated
  using ((select public.crm_is_admin())) with check ((select public.crm_is_admin()));

-- Column limits for self-updates live in crm_users_guard (full_name, locale, title, phone).
drop policy if exists crm_users_self_update on public.crm_users;
create policy crm_users_self_update on public.crm_users
  for update to authenticated
  using (id = (select auth.uid()) and (select public.crm_is_active_user()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- crm_audit_logs: read-only for clients
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.crm_audit_logs from anon, authenticated;

drop policy if exists crm_audit_logs_select on public.crm_audit_logs;
create policy crm_audit_logs_select on public.crm_audit_logs
  for select to authenticated
  using (
    (select public.crm_is_admin())
    or (
      (select public.crm_has_permission('audit_logs', 'view'))
      and public.crm_can_see_record(object, record_id)
    )
  );

commit;
