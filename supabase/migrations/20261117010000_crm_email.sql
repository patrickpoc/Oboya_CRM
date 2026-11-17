-- Oboya CRM 9/8: Email module.
-- Per-user SMTP/IMAP accounts. Only encrypted credentials live in Supabase;
-- messages, bodies, attachments and drafts stay in the browser IndexedDB.

begin;
set local lock_timeout = '5s';
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Permission matrix (mirrored by BUILTIN_MATRIX). `email` is a personal module:
-- every non-read-only role can manage its own accounts; read_only can view.
-- ---------------------------------------------------------------------------
insert into public.crm_access_control (id, matrix)
values (true, $json$
{
  "super_admin": {
    "home": "full", "leads": "full", "accounts": "full", "contacts": "full",
    "opportunities": "full", "activities": "full", "email": "full", "industry_news": "full",
    "setup_users": "full", "setup_roles": "full", "setup_access": "full",
    "setup_companies": "full", "setup_pipeline": "full", "setup_picklists": "full",
    "setup_lead_assignment": "full", "audit_logs": "full"
  },
  "sales_manager": {
    "home": "full", "leads": "full", "accounts": "full", "contacts": "full",
    "opportunities": "full", "activities": "full", "audit_logs": ["view"],
    "email": ["view", "create", "edit", "delete"],
    "industry_news": ["view", "create", "edit"],
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  },
  "sales_rep": {
    "home": ["view"],
    "leads": ["view", "create", "edit", "convert", "export"],
    "accounts": ["view", "create", "edit", "export"],
    "contacts": ["view", "create", "edit", "export"],
    "opportunities": ["view", "create", "edit", "export"],
    "activities": ["view", "create", "edit", "delete"],
    "email": ["view", "create", "edit", "delete"],
    "industry_news": ["view"],
    "audit_logs": "none",
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  },
  "read_only": {
    "home": ["view"],
    "leads": ["view", "export"], "accounts": ["view", "export"],
    "contacts": ["view", "export"], "opportunities": ["view", "export"],
    "activities": ["view", "export"], "email": ["view"], "industry_news": ["view"],
    "audit_logs": "none",
    "setup_users": "none", "setup_roles": "none", "setup_access": "none",
    "setup_companies": "none", "setup_pipeline": "none", "setup_picklists": "none",
    "setup_lead_assignment": "none"
  }
}
$json$::jsonb)
on conflict (id) do update set matrix = excluded.matrix;

-- ---------------------------------------------------------------------------
-- Mailbox settings. `password_encrypted` is AES-GCM ciphertext produced by
-- the server with EMAIL_CREDENTIALS_KEY; the browser never receives it.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_email_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.crm_users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  email text not null check (char_length(email) between 3 and 320),
  provider text not null check (provider in ('263', 'simply', 'custom')),
  username text not null check (char_length(username) between 1 and 320),
  password_encrypted text not null,
  smtp_host text not null check (char_length(smtp_host) between 1 and 253),
  smtp_port integer not null check (smtp_port between 1 and 65535),
  smtp_secure boolean not null default true,
  imap_host text not null check (char_length(imap_host) between 1 and 253),
  imap_port integer not null check (imap_port between 1 and 65535),
  imap_secure boolean not null default true,
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  enabled boolean not null default true,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users (id) on delete set null
);

create unique index if not exists crm_email_accounts_owner_email_uq
  on public.crm_email_accounts (owner_id, lower(email)) where deleted_at is null;
create index if not exists crm_email_accounts_owner_idx
  on public.crm_email_accounts (owner_id) where deleted_at is null;
create index if not exists crm_email_accounts_deleted_idx
  on public.crm_email_accounts (deleted_at) where deleted_at is not null;
create index if not exists crm_email_contacts_email_idx
  on public.crm_contacts (lower(email)) where deleted_at is null and email is not null;
create index if not exists crm_email_accounts_crm_email_idx
  on public.crm_accounts (lower(email)) where deleted_at is null and email is not null;

alter table public.crm_email_accounts enable row level security;

drop policy if exists crm_email_accounts_select on public.crm_email_accounts;
create policy crm_email_accounts_select on public.crm_email_accounts
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and deleted_at is null
    and (select public.crm_has_permission('email', 'view'))
  );

drop policy if exists crm_email_accounts_insert on public.crm_email_accounts;
create policy crm_email_accounts_insert on public.crm_email_accounts
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('email', 'create'))
  );

drop policy if exists crm_email_accounts_update on public.crm_email_accounts;
create policy crm_email_accounts_update on public.crm_email_accounts
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and deleted_at is null
    and (select public.crm_can_write())
    and (select public.crm_has_permission('email', 'edit'))
  )
  with check (
    owner_id = (select auth.uid())
    and deleted_at is null
  );

drop policy if exists crm_email_accounts_delete on public.crm_email_accounts;
create policy crm_email_accounts_delete on public.crm_email_accounts
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.crm_can_write())
    and (select public.crm_has_permission('email', 'delete'))
  );

drop trigger if exists trg_crm_email_accounts_touch on public.crm_email_accounts;
create trigger trg_crm_email_accounts_touch
  before update on public.crm_email_accounts
  for each row execute function public.crm_touch_updated_at();

drop trigger if exists trg_crm_email_accounts_audit on public.crm_email_accounts;
create trigger trg_crm_email_accounts_audit
  after insert or update or delete on public.crm_email_accounts
  for each row execute function public.crm_audit_trigger('email_account');

-- ---------------------------------------------------------------------------
-- Small batched purge of soft-deleted accounts. No email rows exist on the
-- server, so there are no article-style orphans to clean up here.
-- ---------------------------------------------------------------------------
create or replace function public.crm_email_accounts_retention(p_batch integer default 500)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch, 500), 1), 1000);
  v_deleted integer;
  v_total integer := 0;
begin
  loop
    with doomed as (
      select id
      from public.crm_email_accounts
      where deleted_at is not null
        and deleted_at < now() - interval '30 days'
      order by deleted_at
      limit v_batch
    )
    delete from public.crm_email_accounts a
    using doomed d
    where a.id = d.id;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0 or v_total >= 2000;
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contact matching. A narrow id CTE (deferred join) keeps the wide row read
-- small, and the lower(email) partial index avoids a full table scan.
-- RLS stays active because the function is SECURITY INVOKER.
-- ---------------------------------------------------------------------------
create or replace function public.crm_email_match_contacts(p_emails text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if coalesce(array_length(p_emails, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  with narrowed as (
    select c.id
    from public.crm_contacts c
    where c.deleted_at is null
      and lower(c.email) = any (p_emails)
    order by c.email
    limit 200
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'recordType', 'contact',
      'fullName', c.full_name,
      'email', c.email,
      'accountId', c.account_id,
      'accountName', a.name
    ) order by c.email
  ), '[]'::jsonb)
  into v_result
  from public.crm_contacts c
  join narrowed n on n.id = c.id
  left join public.crm_accounts a on a.id = c.account_id;

  return v_result;
end;
$$;

-- Same shape for CRM accounts, so a customer email can be matched without
-- reading the whole account table.
create or replace function public.crm_email_match_accounts(p_emails text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if coalesce(array_length(p_emails, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  with narrowed as (
    select a.id
    from public.crm_accounts a
    where a.deleted_at is null
      and lower(a.email) = any (p_emails)
    order by a.email
    limit 200
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'recordType', 'account',
      'fullName', a.name,
      'email', a.email,
      'accountId', a.id,
      'accountName', a.name
    ) order by a.email
  ), '[]'::jsonb)
  into v_result
  from public.crm_accounts a
  join narrowed n on n.id = a.id;

  return v_result;
end;
$$;

revoke all on function public.crm_email_accounts_retention(integer) from public, anon;
revoke all on function public.crm_email_match_contacts(text[]) from public, anon;
revoke all on function public.crm_email_match_accounts(text[]) from public, anon;
grant execute on function public.crm_email_accounts_retention(integer) to authenticated, service_role;
grant execute on function public.crm_email_match_contacts(text[]) to authenticated, service_role;
grant execute on function public.crm_email_match_accounts(text[]) to authenticated, service_role;

grant select, insert, update, delete on public.crm_email_accounts to authenticated;

commit;
