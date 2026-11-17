# Supabase setup

The CRM runs on its own Supabase project (no database shared with the website). Visibility is enforced by Postgres row level security (RLS); the app reads and writes with the user's JWT.

## 1. Create the project

1. Create a new Supabase project. Note the project URL, the anon key and the service role key (Project Settings → API).
2. **Auth → Providers → Email:** keep email/password on and **turn "Allow new users to sign up" off**. Every auth user automatically gets a `crm_users` row as `sales_rep` with `status = 'disabled'` (trigger `handle_new_user`), which gives no access until an admin activates it. Users are created from Setup → Users (service role, which must set `status: 'active'` explicitly) or with the scripts below.
3. **Auth → URL Configuration:**
   - Site URL: `https://crm.oboya-horticulture.com` (or `http://localhost:3000` for a dev project).
   - Redirect URLs: add `http://localhost:3000/**` and `https://crm.oboya-horticulture.com/**`, so the password reset link can return to `/auth/callback` (which then opens `/reset-password`).

### Auth settings

- **Auth → Providers → Email → "Secure password change": enable it.** Supabase then requires a recent sign-in (or reauthentication) before a password update. The app also checks the current password on `/change-password`, and `/reset-password` only accepts sessions opened from a recovery link (httpOnly marker set by `/auth/callback`).
- **MFA (optional):** with `CRM_REQUIRE_MFA=true`, super admins and anyone with a TOTP factor must reach AAL2. Users without a factor enroll on `/mfa` (QR code), and enrolled users get a challenge there. Enable TOTP under Auth → Multi-Factor.

## 2. Run the migrations in order

The files in `supabase/migrations/` must run in filename order:

| File | Contents |
|---|---|
| `20261116000100_crm_core.sql` | extensions, roles, teams, users, access matrix, settings, visibility helpers, privilege guard, auth bootstrap trigger |
| `20261116000200_crm_picklists.sql` | picklist values, pipelines + stages (with guards), group companies |
| `20261116000300_crm_objects.sql` | accounts, account ↔ company links, contacts, leads, opportunities, activities, recent views, audit log table, search indexes |
| `20261116000400_crm_rls.sql` | every RLS policy |
| `20261116000500_crm_audit.sql` | audit trigger on all object tables |
| `20261116000600_crm_functions.sql` | RPCs: delete/reorder stages, soft delete/restore, convert lead, inbound owner |
| `20261116000700_crm_v1_fixes.sql` | RPCs: opportunity stage change, account create + company links, picklist reorder, role permissions; converted leads read-only; audit on config tables (`record_key`) |
| `20261116000800_crm_industry_news.sql` | Industry News config + article tables, RLS, indexes, audit trigger, access-matrix seed |
| `20261116000900_crm_industry_news_hardening.sql` | AI columns, cursor/deferred-join RPCs, batched ingest/save, 30-day retention and optional `pg_cron` jobs |
| `20261117000000_crm_industry_news_global.sql` | Single global Industry News config/articles, read-only for viewers, super-admin writes, service-role cron writers |
| `20261117010000_crm_email.sql` | Per-user SMTP/IMAP accounts, encrypted credentials, RLS and email permission seed |

Either:

- **SQL editor:** paste each file, in order, and run it. Each file is one transaction and can be re-run safely.
- **CLI:** `supabase link --project-ref <ref>` then `supabase db push`. The 14-digit versions keep the CLI order identical.

Never edit an applied migration; add a new file (`YYYYMMDDhhmmss_name.sql`).

`20261116000900_crm_industry_news_hardening.sql` also schedules a daily 30-day purge at 03:17 UTC when `pg_cron` is available, and cleans `cron.job_run_details` older than 7 days at 03:27 UTC. If `pg_cron` is unavailable, the same retention function runs inside every Industry News ingest, so the table still cannot grow without bound.

After `20261117000000_crm_industry_news_global.sql`, the source list is a single global config: every user with `industry_news:view` sees the same articles, but only an active `super_admin` can save the config or press "Fetch now". `vercel.json` schedules the shared fetch at **00:00 UTC = 08:00 UTC+8** daily through `/api/crm/industry-news/cron`; change only the `schedule` value in `vercel.json` if another time is needed (Vercel always interprets cron expressions in UTC). Set `CRON_SECRET` in Vercel and mark it sensitive; without it the endpoint returns 503.

The Email module stores **only** encrypted mailbox settings in Supabase. Browsers cannot open raw IMAP/SMTP TCP sockets, so a thin Node bridge translates IMAP/SMTP on demand; it never persists messages or attachments. The client requests headers first, keeps headers/bodies/attachments/drafts in IndexedDB, and streams attachments only when opened. Outgoing attachments are uploaded as multipart/form-data, read into memory and handed straight to SMTP — never written to disk or the database — with a 4 MB total / 4 MB per-file / 10-file cap that stays under Vercel's request-body limit. Sent copies (including attachment Blobs) are kept only in the browser's IndexedDB sent box and can be deleted individually or cleared to reclaim local space. Generate `EMAIL_CREDENTIALS_KEY` with `openssl rand -base64 32` and keep it server-only. Header sync uses per-folder UID cursors in batches of at most 200 with client concurrency capped at 3; customer record links use IMAP SEARCH across enabled mailboxes and cache the result locally without resetting the cursor. Deleted accounts are soft-deleted, then purged in 200-row batches after 30 days.

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill:

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app + scripts | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server + scripts | **server only**, never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | app | base URL for password reset |
| `INBOUND_LEADS_SECRET` | server | HMAC secret shared with the website |
| `CRM_AI_API_KEY` | server only | optional; enables Industry News AI translation/summary via an OpenAI-compatible endpoint |
| `CRM_AI_BASE_URL` | server only | optional; defaults to `https://api.openai.com/v1` |
| `CRM_AI_MODEL` | server only | optional; defaults to `gpt-4o-mini` |
| `CRON_SECRET` | server only | required by `/api/crm/industry-news/cron`; Vercel Cron sends it as `Authorization: Bearer <secret>` |
| `EMAIL_CREDENTIALS_KEY` | server only | 32 random bytes in base64 (`openssl rand -base64 32`); encrypts per-user SMTP/IMAP passwords. Changing it invalidates saved mailboxes. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | `npm run create-admin` | do not commit |
| `SEED_ALLOW`, `SEED_PROJECT_REF`, `SEED_CREATE_ADMIN`, `DEMO_PASSWORD`, `DEMO_EMAIL_DOMAIN` | `npm run seed:demo` | demo/test projects only (see 5) |

## 4. First admin

Pick one:

- **Script (recommended):** `ADMIN_EMAIL=you@oboya… ADMIN_PASSWORD='…' npm run create-admin`. It creates or resets the auth user and upserts `crm_users` as an active `super_admin`. The password is not printed.
- **Bootstrap setting:** before the admin's account is created, run in the SQL editor:

  ```sql
  insert into public.crm_settings (key, value, admin_only)
  values ('bootstrap_admin_email', '"you@oboya-horticulture.com"', true)
  on conflict (key) do update set value = excluded.value;
  ```

  The value may also be a JSON array of emails. The first auth user with a matching **confirmed** email (`email_confirmed_at` set, either at creation or later) becomes an active `super_admin`, **only while no active super admin exists**. The setting is then deleted (one-shot). Every other new user is a disabled `sales_rep` until an admin activates them in Setup → Users.

## 5. Demo data (optional, never production)

```bash
SEED_ALLOW=1 SEED_PROJECT_REF=<ref> DEMO_PASSWORD='…' npm run seed:demo
```

The script refuses to run unless `SEED_ALLOW=1` is set **and** `SEED_PROJECT_REF` equals the project ref in `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`; for a local stack the ref is the host, e.g. `127.0.0.1`). This makes a mistyped `.env.local` pointing at production fail closed.

It creates 3 demo teams and 7 demo users (`demo.<name>@example.com`: 2 managers, 4 reps, 1 read-only), plus a demo super admin only with `SEED_CREATE_ADMIN=1`. It also creates 25 accounts across BR/NL/ES/CN/MX/CO/KE, 50 contacts, 60 leads in every status (some past the 24 h / 48 h SLA), 35 opportunities across all stages (BRL/USD/EUR, loss reasons on lost deals) and 120 activities. It prints the emails at the end.

It is idempotent: demo users are updated in place, and every record with `external_ref like 'demo:%'` (plus its audit rows) is deleted and recreated on each run.

## 6. Data model notes

- **Common columns** on every object table: `id`, `owner_id`, `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`, `deleted_by`. A shared trigger fills them; a user session cannot spoof `created_by`/`updated_by`.
- **Soft delete only.** Clients call `rpc('crm_soft_delete', {p_object, p_id})`. Restore is `rpc('crm_restore', …)` and only a super admin may call it. Hard delete is possible only with the service role.
- **Visibility** comes from `crm_roles.visibility_scope` (editable in Setup → Roles):
  - `own`: rows the user owns.
  - `team`: own rows, plus rows owned by members of any team whose `manager_id` is the user. Being a member of a team alone grants nothing.
  - `all`: every row.
  - A disabled user sees nothing. `crm_roles.can_write = false` (Read Only) blocks every insert and update.
- **Stages:** opportunities reference `stage_id`. Each pipeline must keep at least one active open stage, exactly one won stage and at least one lost stage (checked at commit). Won and lost stages cannot be deleted, deactivated or change kind. Remove open stages with `rpc('crm_delete_stage', {p_stage_id, p_target_stage_id})`, which moves the opportunities to another open stage and then deletes. Reorder with `rpc('crm_reorder_stages', {p_pipeline_id, p_ids})`.
- **Opportunity rules:** a lost stage requires `loss_reason`. `closed_at` is set when entering won/lost and cleared when reopened. `probability` follows the stage unless it is set in the same update.
- **Stage change:** `rpc('crm_change_opportunity_stage', {p_id, p_stage_id, p_loss_reason?, p_loss_note?, p_probability?})` returns the updated row as JSON. It is `security invoker` (RLS and the row guard apply) and does one update. Errors (`P0001`, message is the code): `stage_unavailable` (inactive stage or another pipeline), `loss_reason_required` (lost target without a reason; moving lost → same lost stage keeps the stored one). Leaving a lost stage clears `loss_reason`/`loss_note`. With `p_probability` (0–100, rounded) it sets `crm.keep_probability = 'on'` for the transaction, so the stage trigger keeps that probability instead of applying the stage default.
- **Accounts and companies:** `rpc('crm_create_account', {p_account, p_links?})` inserts an account from a JSON object, reading only the insertable columns (`name, type, country_code, segment, industry, website, phone, email, tax_id, parent_account_id, billing_*, description, owner_id`); `owner_id` defaults to the caller and RLS / the row guard check it. It then calls `crm_set_account_entities` in the same transaction and returns the row. `rpc('crm_set_account_entities', {p_account_id, p_links})` replaces all links atomically; `p_links = [{entity_id, is_primary}]` needs exactly one primary when non-empty (`P0001 one_primary_required`); `[]` removes every link. Both are `security invoker`. Writing links needs `accounts.edit` (`42501` otherwise), or `accounts.create` for an account inserted in the same transaction, which is how `crm_create_account` works for create-only users. The `crm_account_entities` policies apply the same rule through `crm_can_edit_account_entities`.
- **Converted leads are read-only:** once `converted_at` is set, any client update (`authenticated`, admins included) fails with `P0001 lead_converted`, except a soft-delete / restore toggle. `crm_convert_lead`, `crm_soft_delete` and the service role are unaffected.
- **Picklists:** reorder with `rpc('crm_reorder_picklist', {p_picklist, p_ids})` (admin, every value of the picklist exactly once, `22023` otherwise).
- **Role permissions:** `rpc('crm_set_role_permissions', {p_role, p_permissions})` sets one role's row of the matrix with a single `jsonb_set`, and `rpc('crm_remove_role_permissions', {p_role})` removes it (`matrix - role`). Neither accepts `super_admin` (`22023 invalid_role`). `rpc('crm_delete_role', {p_role})` deletes a custom role and its matrix row in one transaction; it refuses system roles (`system_role`) and roles still assigned to users (`23503 role_in_use`). Both are `security definer`, admin only, and validate the level shape (`"full" | "none" | [actions]`). No read-modify-write, so concurrent edits to different roles cannot overwrite each other.
- **Permission matrix (DB-enforced):** `crm_access_control.matrix` is `{ "<role>": { "<module>": "full" | "none" | ["view", "create", …] } }`. The modules are `home, leads, accounts, contacts, opportunities, activities, setup_users, setup_roles, setup_access, setup_companies, setup_pipeline, setup_picklists, setup_lead_assignment, audit_logs`. The actions are `view, create, edit, delete, convert, export`. A user's `permission_overrides` is `{ "grants": { "<module>": level }, "denies": { "<module>": level } }`. The effective permission is (role ∪ grants) − denies; `super_admin` is always allowed. `crm_has_permission(module, action)` evaluates it. RLS requires `<module>.create` on insert and `<module>.edit` on update, `crm_soft_delete` requires `<module>.delete`, `crm_convert_lead` requires `leads.convert`, and audit reads require `audit_logs.view`. The seeded defaults are mirrored by the app's `BUILTIN_MATRIX`. Keep them in sync.
- **Row guard (user sessions):** changing `owner_id` requires the new owner to be visible to you. Every changed reference must point at a record you can see: `accounts.parent_account_id`, `contacts.account_id`, `opportunities.account_id` / `primary_contact_id`, `activities.who_contact_id` / `what_object` + `what_id`. Clients can never write `crm_leads.converted_at` / `converted_*`; only `crm_convert_lead` can.
- **Lead email uniqueness:** a live lead's email is unique across the whole table, so trying to create a duplicate fails even when the existing lead is invisible to you. This reveals that the email exists. It is accepted on purpose as duplicate detection (Salesforce-style); the app shows "a lead with this email already exists".
- **Lead conversion:** `rpc('crm_convert_lead', {p_lead_id, p_account_id?, p_create_opportunity, p_opportunity_name?, p_amount?, p_currency?, p_close_date?})` is `security definer` with explicit checks: an active user with write access and `leads.convert`, plus `accounts.create` (only when it creates the account), `contacts.create` (when it creates a contact) and `opportunities.create` (when it creates an opportunity). The lead and any linked account must be visible to the caller. The row guard and audit triggers still run as the caller. It is one transaction. It returns `{lead_id, account_id, account_created, contact_id, contact_created, opportunity_id}` and fails with `lead_already_converted` on a second call. New records are owned by the lead owner. The lead's activities move to the opportunity, or to the account when no opportunity is created, and get the new contact as `who`.
- **Inbound owner:** `rpc('crm_assign_inbound_owner')` can be called by the service role only. It picks the next active user flagged `receives_inbound` (round-robin, cursor kept in `crm_settings.inbound_rr_cursor` under a row lock). If nobody is flagged, or `inbound_assignment.mode` is `default_owner`, it uses `crm_settings.inbound_default_owner`, then the oldest active super admin.
- **Audit:** a trigger on every object table writes `crm_audit_logs`. The action is one of `create`, `update`, `delete`, `restore`, `stage_change`, `owner_change` or `convert`. A lead `status` change is a `stage_change`. Config tables are audited too, with these `object` values: `crm_pipeline_stages` → `setup_stage`, `crm_picklist_values` → `picklist`, `crm_entities` → `entity`, `crm_roles` → `role`, `crm_teams` → `team`, `crm_users` → `user`, `crm_access_control` → `access_control`, `crm_settings` → `settings`. Rows keyed by a uuid fill `record_id`; others fill `record_key` (role id, setting key, `matrix` for the access matrix) and leave `record_id` null. For `admin_only` settings the value is never stored (`"[redacted]"`, `"[redacted, changed]"`), and the round-robin cursor is not audited. The diff is `{field: [old, new]}` for changed keys only. `updated_at`, `updated_by` and `raw_payload` are excluded. The app never writes audit rows. `actor_name` is a snapshot taken at write time, so the UI should resolve `actor_id` against `crm_users` to show the current name and use `actor_name` only as a fallback (system writes, deleted users).

## 7. Tables and RLS policies

Every table has RLS enabled. All policies apply to the `authenticated` role. `anon` has every table privilege revoked, and `authenticated` has no `truncate`, `references` or `trigger` (default privileges are adjusted too). The service role bypasses RLS and is used only by scripts, the inbound endpoint and users admin. "Active user" means a `crm_users` row with `status = 'active'`, and "admin" means an active `super_admin`.

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `crm_roles` | any active user | admin | admin (system roles keep their id; `super_admin` always keeps scope `all`, write access and active) | admin, custom roles only |
| `crm_teams` | any active user | admin | admin | admin |
| `crm_users` | any active user (directory), and your own row even when disabled | admin | admin edits anyone, but not their own role or status, and not in a way that leaves no active super admin. You can edit your own `full_name`, `locale`, `title` and `phone` only (enforced by trigger) | nobody (service role only) |
| `crm_access_control` | any active user | admin | admin | admin |
| `crm_settings` | any active user, except `admin_only` rows (bootstrap email, round-robin cursor), which only admins read | admin | admin | admin |
| `crm_picklist_values` | any active user | admin | admin | admin |
| `crm_pipelines` | any active user | admin | admin | admin |
| `crm_pipeline_stages` | any active user | admin | admin (within the stage rules) | admin, open stages without opportunities (use `crm_delete_stage`) |
| `crm_entities` | any active user | admin | admin | admin |
| `crm_accounts`, `crm_contacts`, `crm_leads`, `crm_opportunities` | when the owner is visible to you (scope). Deleted rows: admins only | users with write access and `<module>.create`, for an owner they can see; never pre-deleted | users with write access and `<module>.edit`, on rows they can see, and only to an owner they can see. Only admins may set or clear `deleted_at` directly; others use `crm_soft_delete` (`<module>.delete`) | nobody (soft delete) |
| `crm_activities` | when you can see the activity owner **or** its parent record (`crm_can_see_record`). Deleted rows: admins only | users with write access and `activities.create`, for a visible owner, and the parent record must be visible | users with write access and `activities.edit`, on rows they can see. A new owner, parent or contact must be visible (row guard) | nobody (soft delete) |
| `crm_account_entities` | when you can see the account | users with write access and `accounts.edit` who can see the account | same | same (link rows are deleted for real) |
| `crm_rate_limits` | nobody (no policies, grants revoked) | only through `crm_rate_limit_hit` | same | nobody |
| `crm_recent_views` | your own rows | your own rows | your own rows | your own rows |
| `crm_audit_logs` | admins see everything. Users with `audit_logs.view` see entries for records they can currently see (`crm_can_see_record`), and config entries when they also have the matching view permission: `setup_stage` → `setup_pipeline`, `picklist` → `setup_picklists`, `entity` → `setup_companies`, `role`/`team` → `setup_roles`, `user` → `setup_users`, `access_control` → `setup_access`, `settings` → `setup_lead_assignment` | nobody: the trigger writes, and insert/update/delete are revoked from clients | nobody | nobody |

**Function grants:** `EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated` on every function in `public`, including the default privileges for new functions. `authenticated` is then granted only:

- the app RPCs: `crm_soft_delete`, `crm_restore`, `crm_convert_lead`, `crm_delete_stage`, `crm_reorder_stages`, `crm_rate_limit_hit`, and (000700) `crm_change_opportunity_stage`, `crm_create_account`, `crm_set_account_entities`, `crm_reorder_picklist`, `crm_set_role_permissions`, `crm_remove_role_permissions`, `crm_delete_role`, plus the policy helper `crm_can_edit_account_entities`;
- the helpers evaluated with the caller's privileges (RLS, CHECK constraints, invoker triggers): `crm_is_active_user`, `crm_is_admin`, `crm_can_write`, `crm_can_see`, `crm_can_see_record`, `crm_has_permission`, `crm_tags_valid`, `crm_is_privileged_session`.

`service_role` keeps every function. New functions need an explicit grant in their migration.

**Rate limiting:** `rpc('crm_rate_limit_hit', {p_bucket, p_max, p_window_seconds})` counts hits per `auth.uid()` and bucket in a fixed window. It returns `true` while the call is allowed. The app uses `('change_password', 5, 900)`.

Helper functions used by the policies (all `security definer`, `search_path` pinned): `crm_is_active_user()`, `crm_current_user_role()`, `crm_current_scope()`, `crm_is_admin()`, `crm_can_write()`, `crm_can_see(owner)`, `crm_can_see_record(object, id)`, `crm_has_permission(module, action)`.

## 8. Testing

Three suites, all run from the repo root:

| Command | What | Network |
|---|---|---|
| `npm test` | Unit tests (`src/**/__tests__`, `vitest.config.ts`) | none |
| `npm run test:rls` | RLS tests (`tests/rls`, `vitest.rls.config.ts`) with real user JWTs | Supabase project |
| `npm run test:e2e` | Playwright smoke (`e2e/`) against `npm run build && npm run start -- --port 3100` | Supabase project |

Both networked suites need a **demo/test project** that has been seeded (`npm run seed:demo`, section 5). Never point them at production: the RLS suite creates a temporary super admin there.

**Environment** (read from the shell, then `.env.local`, then `.env`; values are never printed):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_PASSWORD` (the seed password of the `demo.*@example.com` users).
- The RLS suite prefers `RLS_TEST_SUPABASE_URL`, `RLS_TEST_SUPABASE_ANON_KEY`, `RLS_TEST_SERVICE_ROLE_KEY` and `RLS_TEST_DEMO_PASSWORD` when set, so it can target a dedicated test project without changing `.env.local`.

**RLS suite (`npm run test:rls`).** `tests/rls/global-setup.ts` runs once per run. With the service role it creates:

- a temporary active super admin, `rls-admin-<run>@example.com`, with a random password;
- one account, contact, lead, opportunity and activity owned by each of Lucas and Camila (reps in Ricardo's team), Ricardo (manager) and Pieter (rep in Sanne's team);
- a second set owned by Lucas, which the soft-delete tests remove.

Every fixture has `external_ref = 'rls-test:<run>:<owner>:<object>'`. The setup signs each demo user and the temporary admin in once and passes their access tokens to the tests. The tests then call PostgREST with the anon key plus each user's JWT, so RLS decides every result. Teardown hard-deletes everything tagged `rls-test:<run>:`, including the audit rows, and deletes the temporary admin, even when tests fail.

Per object (leads, accounts, contacts, opportunities, activities), the suite covers:

- **Visibility:** a rep sees their own records only, a manager sees their own plus their team's but not another team's, and the admin and read-only users see everything. Anon gets nothing.
- **Writes:**
  - read-only cannot insert or update;
  - a rep cannot update another rep's record;
  - a rep cannot hand a record to an invisible owner (42501);
  - a rep cannot link to an invisible account, contact or lead (42501).
- **Soft delete and restore:** `crm_soft_delete` run by the manager hides the record from non-admins, while the admin still sees it. Only the admin can `crm_restore`.
- **Audit:** a rep reads no audit rows, and a manager reads only rows for records they can see.
- **RPCs and users:**
  - `crm_convert_lead` on another user's lead fails;
  - a rep cannot change their own `crm_users.role` or team, and cannot set `converted_at`.

Requires the seeded users `demo.lucas.pereira`, `demo.camila.rocha`, `demo.pieter.bakker`, `demo.ricardo.souza`, `demo.sanne.de.vries` and `demo.wei.zhang` (all `@example.com`, active).

**Playwright smoke (`npm run test:e2e`).**

- Install the browser once with `npx playwright install chromium`.
- The config builds the app and serves it on port 3100, so it does not collide with `next dev` on 3000. The server uses the real Supabase env.
- As rep Lucas, the test:
  1. logs in;
  2. creates a lead from the list's **New** button, with email `e2e-<rand>@example.com`;
  3. moves the lead New → Working on the Path;
  4. converts it with an opportunity;
  5. moves the opportunity one stage forward on the Path;
  6. moves its card on `/opportunities/pipeline` with the "Move to…" control;
  7. checks the planned `/quotes` page ("To be done" pill and description card).
- A second test loads `/dashboard` at 375px and opens the sidebar drawer.
- `e2e/global-teardown.ts` hard-deletes, with the service role, the `e2e-*@example.com` leads and the account, contact and opportunity they were converted into, along with their activities, audit rows and recent views.
