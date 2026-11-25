begin;

-- Casdoor proves that somebody owns an external identity; it does not prove
-- that the person is a CRM employee. Every first sign-in / link therefore
-- creates a review record and stays without a Supabase session until a CRM
-- super admin approves it. Only the service role may insert or delete rows.
create table if not exists public.crm_casdoor_access_requests (
  id uuid primary key default gen_random_uuid(),
  sub text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  title text,
  country text,
  country_code text,
  location text,
  avatar text,
  casdoor_type text,
  casdoor_tags text[] not null default '{}',
  casdoor_roles text[] not null default '{}',
  organization text,
  intent text not null default 'login' check (intent in ('login', 'link')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  review_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_casdoor_requests_sub_status_idx
  on public.crm_casdoor_access_requests (sub, status, created_at desc);
create index if not exists crm_casdoor_requests_user_idx
  on public.crm_casdoor_access_requests (user_id);
create index if not exists crm_casdoor_requests_pending_idx
  on public.crm_casdoor_access_requests (status, created_at desc)
  where status = 'pending';

-- A rejected/approved/revoked request may be retried, but never two pending
-- requests for the same identity/target pair.
create unique index if not exists crm_casdoor_requests_pending_uniq
  on public.crm_casdoor_access_requests (sub, user_id)
  where status = 'pending';

alter table public.crm_casdoor_access_requests enable row level security;

drop policy if exists "casdoor requests readable by setup users" on public.crm_casdoor_access_requests;
create policy "casdoor requests readable by setup users"
  on public.crm_casdoor_access_requests
  for select
  to authenticated
  using (public.crm_has_permission('setup_users', 'view'));

drop policy if exists "casdoor requests reviewable by setup editors" on public.crm_casdoor_access_requests;
create policy "casdoor requests reviewable by setup editors"
  on public.crm_casdoor_access_requests
  for update
  to authenticated
  using (public.crm_has_permission('setup_users', 'edit'))
  with check (public.crm_has_permission('setup_users', 'edit'));

revoke all on public.crm_casdoor_access_requests from anon;
grant select, update on public.crm_casdoor_access_requests to authenticated;

-- Admins may only change the review fields. Identity/profile data comes from
-- the verified OIDC response and must not be rewritten during review.
create or replace function public.crm_casdoor_request_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.crm_is_privileged_session() then
    NEW.updated_at := now();
    return NEW;
  end if;

  if NEW.sub is distinct from OLD.sub
     or NEW.user_id is distinct from OLD.user_id
     or NEW.email is distinct from OLD.email
     or NEW.intent is distinct from OLD.intent
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'Casdoor access request identity fields are immutable';
  end if;

  if NEW.status not in ('approved', 'rejected', 'revoked') then
    raise exception 'Invalid Casdoor access review status';
  end if;

  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := now();
  NEW.updated_at := now();
  return NEW;
end;
$$;

revoke all on function public.crm_casdoor_request_guard() from public, anon;
grant execute on function public.crm_casdoor_request_guard() to authenticated, service_role;

drop trigger if exists trg_crm_casdoor_request_guard on public.crm_casdoor_access_requests;
create trigger trg_crm_casdoor_request_guard
  before update on public.crm_casdoor_access_requests
  for each row execute function public.crm_casdoor_request_guard();

drop trigger if exists trg_crm_casdoor_requests_audit on public.crm_casdoor_access_requests;
create trigger trg_crm_casdoor_requests_audit
  after insert or update on public.crm_casdoor_access_requests
  for each row execute function public.crm_audit_trigger('user');

commit;
