begin;

-- Maps a Casdoor subject to the Supabase Auth user that backs its CRM session.
-- Only the service role writes; an authenticated user may read their own link
-- so a back-channel logout can invalidate sessions opened before logout_at.
create table if not exists public.crm_casdoor_sessions (
  sub text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  logout_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists crm_casdoor_sessions_user_idx
  on public.crm_casdoor_sessions (user_id);

-- One CRM user may link at most one Casdoor identity.
create unique index if not exists crm_casdoor_sessions_user_uniq
  on public.crm_casdoor_sessions (user_id);

alter table public.crm_casdoor_sessions enable row level security;

drop policy if exists "casdoor sessions readable by owner" on public.crm_casdoor_sessions;
create policy "casdoor sessions readable by owner"
  on public.crm_casdoor_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.crm_casdoor_sessions from anon;
grant select on public.crm_casdoor_sessions to authenticated;

commit;
