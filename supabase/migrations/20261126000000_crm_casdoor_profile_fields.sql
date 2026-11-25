begin;

-- Snapshot the Casdoor signup profile (country/phone/work unit) for reviewers.
alter table public.crm_casdoor_access_requests
  add column if not exists phone text,
  add column if not exists company text,
  add column if not exists region text;

-- CRM user fields populated from an approved Casdoor identity. Service-role
-- writes bypass crm_users_guard; users can still edit them through /profile.
alter table public.crm_users
  add column if not exists country_code text
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column if not exists company text;

commit;
