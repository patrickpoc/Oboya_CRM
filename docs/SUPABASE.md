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
| `20261116000750_crm_preserve_module_permissions.sql` | Upgrade adapter: preserves customised permissions while unapplied historical module seeds add their own module |
| `20261116000800_crm_industry_news.sql` | Industry News config + article tables, RLS, indexes, audit trigger, access-matrix seed |
| `20261116000900_crm_industry_news_hardening.sql` | AI columns, cursor/deferred-join RPCs, batched ingest/save, 30-day retention and optional `pg_cron` jobs |
| `20261117000000_crm_industry_news_global.sql` | Single global Industry News config/articles, read-only for viewers, super-admin writes, service-role cron writers |
| `20261117010000_crm_email.sql` | Per-user SMTP/IMAP accounts, encrypted credentials, RLS and email permission seed |
| `20261118000000_crm_cases.sql` | Support cases table + RLS, per-priority SLA rules, resolution reporting RPC, activity-on-case parent, cases permission seed |
| `20261119000000_crm_industry_news_last_fetched.sql` | Dedicated last-successful-ingest timestamp, read policy for viewers, bootstrap/ingest RPC updates |
| `20261119010000_crm_audit_repairs.sql` | Restore converted-lead guard; case delete/restore, activities and recent views; owner-scoped email deletion; credential audit redaction |
| `20261119020000_crm_case_email_threads.sql` | Atomic RLS-scoped thread conversion, message aliases, idempotent replies and owner-scoped uniqueness |
| `20261119030000_crm_visibility_and_credential_audit.sql` | Parent-visible activity audit reads without broader deletion; redact historical mailbox credential differences |
| `20261120000000_crm_casdoor_sso.sql` | Casdoor `sub` ↔ Supabase user links, back-channel logout timestamps, owner-readable RLS policy |
| `20261125000000_crm_casdoor_access_requests.sql` | Admin review queue for Casdoor sign-in/link requests, immutable request guard, RLS and audit trigger |

Either:

- **SQL editor:** run only unapplied files, in filename order. Do not replay historical permission seeds: they replace the access matrix when run without the upgrade adapter.
- **CLI:** `supabase link --project-ref <ref>`, review `supabase db push --include-all --dry-run`, then `supabase db push --include-all`. The 14-digit versions keep the CLI order identical.

Existing projects must use `supabase db push --include-all` for the backfilled `000750` migration. Review the dry run first: `000750` must run before any still-unapplied Industry News, Email or Cases migration, and `20261119010000` removes its temporary adapter afterwards. If those module migrations are already applied, do not replay them; apply the remaining new migrations in order. Future module migrations should call `crm_add_module_permissions(matrix, module, defaults_by_role)` to add a single module while preserving existing cells and custom roles.

Permissions already overwritten by an earlier deployment cannot be inferred from the current matrix. Review `crm_audit_logs` rows with `object = 'access_control'` and `diff -> 'matrix'` (the `[old, new]` snapshots) against the intended policy before restoring through Setup. The repair does not automatically restore historical snapshots or undo later administrator edits.

Email browser storage is now named by the authenticated CRM user ID. Every asynchronous operation retains that user's database handle; logout/identity changes close old handles, and the old user interface is discarded. The legacy shared `oboya-email` database is quarantined: the application never opens or automatically imports it because its records have no reliable user ownership. This means old local-only drafts/sent copies do not automatically appear in the new user database; server mail is fetched again. The unified Sent folder combines server messages with this user's local copies using account + Message-ID and retains local attachment Blobs.

After `20261119020000`, email-to-case conversion follows `In-Reply-To` and `References` using an atomic `crm_case_from_email` invoker RPC. Only RLS-visible, writable cases can be updated. Original messages and replies share one case even when a reply is converted first. New replies append history and set status to `working`, including previously resolved/closed cases; retries of the same message do not append or reopen it. History is limited to 1,000,000 characters, with up to 10,000 characters retained per email; the edit form uses the same total limit.

Case recent views accept `case` after `20261119010000`. Case and activity reads follow either visible parent (account or contact), even when another user owns both the case and activity. After `20261119030000`, activity audit reads use the activity's own SELECT RLS and still require `audit_logs.view`; parent visibility does not grant deletion of another owner's activity.

Mailbox audit credentials are masked on new events after `20261119010000`. `20261119030000` also removes existing `password_encrypted` copies from `email_account` audit differences, preserving event IDs, actors, timestamps, unrelated differences, null endpoints and rotation markers. Repeating the migration does not rewrite already-masked rows. Live mailbox ciphertext, backups and exported audit copies are unchanged.

Built-in email templates use the current CRM language (`en`, `pt-BR`, `es`, `zh-CN`) at render time. Exact unedited legacy English seeds are replaced in memory; customized saved templates and existing drafts are preserved. Email dates and the last news fetch use the CRM locale and its existing UTC timezone, rather than browser defaults. Case resolution durations use localized minute/hour/day units. Mailbox colors are restricted to the Oboya palette in both input validation and the database.

Offline verification: `npm test` includes PGlite (a development-only WASM PostgreSQL dependency) executing the complete application migration chain with local Supabase auth/default-grant fixtures. Tests cover both cross-owner parent paths, activity audits, audit permission denial, unchanged delete rights, historical redaction and repeat-migration idempotency. `npm run build && npm run test:email:offline` runs the real email components against local fake HTTP endpoints in Chromium/installed Edge with real IndexedDB, covering user isolation, delayed responses, sent deduplication, attachment bytes, header refresh, four-language templates/date/duration formatting and 375px layout. These checks do not connect to Supabase or an actual mailbox and do not replace a deployed migration rehearsal or multi-session concurrency tests.

Never edit an applied migration; add a new file (`YYYYMMDDhhmmss_name.sql`).

`20261116000900_crm_industry_news_hardening.sql` also schedules a daily 30-day purge at 03:17 UTC when `pg_cron` is available, and cleans `cron.job_run_details` older than 7 days at 03:27 UTC. If `pg_cron` is unavailable, the same retention function runs inside every Industry News ingest, so the table still cannot grow without bound.

After `20261117000000_crm_industry_news_global.sql`, the source list is a single global config: every user with `industry_news:view` sees the same articles, but only an active `super_admin` can save the config or press "Fetch now". `vercel.json` schedules the shared fetch at **00:00 UTC = 08:00 UTC+8** daily through `/api/crm/industry-news/cron`; change only the `schedule` value in `vercel.json` if another time is needed (Vercel always interprets cron expressions in UTC). Set `CRON_SECRET` in Vercel and mark it sensitive; without it the endpoint returns 503. The page header shows the last successful ingest from `crm_industry_news_fetch_state`, not the config edit time, so it advances on both manual and scheduled fetches even when no article changed.

The Email module stores **only** encrypted mailbox settings in Supabase. Browsers cannot open raw IMAP/SMTP TCP sockets, so a thin Node bridge translates IMAP/SMTP on demand; it never persists messages or attachments. The client requests headers first, keeps headers/bodies/attachments/drafts in IndexedDB, and streams attachments only when opened. Outgoing attachments are uploaded as multipart/form-data, read into memory and handed straight to SMTP — never written to disk or the database — with a 4 MB total / 4 MB per-file / 10-file cap that stays under Vercel's request-body limit. Sent copies (including attachment Blobs) are kept only in the browser's IndexedDB sent box and can be deleted individually or cleared to reclaim local space. Generate `EMAIL_CREDENTIALS_KEY` with `openssl rand -base64 32` and keep it server-only. Header sync uses per-folder UID cursors in batches of at most 200 with client concurrency capped at 3; customer record links use IMAP SEARCH across enabled mailboxes and cache the result locally without resetting the cursor. Deleted accounts are soft-deleted, then purged in 200-row batches after 30 days.

Cases use the standard object framework (`/cases`, `/cases/[id]`) with `cases` permissions and RLS that follows the owner plus the linked account/contact. `crm_case_rules()` stamps `sla_due_at` from `crm_settings.case_sla_hours` (low 72h / normal 48h / high 24h / urgent 8h by default) and records `resolved_at` / `resolution_minutes` on resolution; the read-only `case.sla` virtual field derives on-track / warning / overdue / met / missed from those timestamps. `/api/crm/cases/report` runs one RLS-scoped aggregate for the list summary. "Create case" in the email reader upserts by `source_message_id`, so replying on the same thread updates the existing case instead of duplicating it; contact/account pages can open the create drawer with the relationship prefilled. Case permission is included in the `20261118000000_crm_cases.sql` access seed, so the migration must be applied before the menu appears for the standard roles.

## 2b. Casdoor SSO (optional, OIDC authorization code + PKCE)

The app is an OIDC relying party of Casdoor at `https://oboss.psorai.eu.org`; its discovery document publishes `authorization_endpoint=/login/oauth/authorize`, `token_endpoint=/api/login/oauth/access_token`, `userinfo_endpoint=/api/userinfo`, `end_session_endpoint=/api/logout` and `jwks_uri=/.well-known/jwks`. No Casdoor SDK is used: the browser only sees `/api/auth/casdoor/login`, the token exchange and profile lookup happen server-side, and the result is exchanged into a normal Supabase session. `auth.uid()`, RLS and `crm_users` activation therefore stay unchanged.

Configure the Casdoor application `oboyacrm` (client ID `51a7f410327c44d55e4e`):

- **Redirect URLs** must contain both `https://oboyacrm.vercel.app/callback` and `https://oboyacrm.vercel.app/login` (add `http://localhost:3000/callback` and `http://localhost:3000/login` for local development). Casdoor matches a full-URL entry by scheme, host, port and **path** (query strings are not part of the match), so an unregistered `/login` was the reason `/login?signed_out=1` was rejected. The app uses the query-free `/login` and carries the signed-out notice in a short-lived first-party cookie.
- **Backchannel logout URL**: `https://oboyacrm.vercel.app/api/auth/casdoor/backchannel-logout`. Casdoor POSTs a signed `logout_token` there; the receiver verifies it against the JWKS and records a logout timestamp that invalidates older CRM sessions. A public HTTPS URL is required — Casdoor will not call loopback addresses.
- Sign-up page: `https://oboss.psorai.eu.org/signup/oboyacrm` (shown as a link on the login page).
- Request scopes are `openid profile email`. The discovery document does **not** list a `read` scope; a hand-built URL with `scope=read` cannot return usable OIDC profile claims, so do not use it.

Environment variables (server-only secret, set the same values in Vercel):

| Variable | Value |
|---|---|
| `CASDOOR_CLIENT_SECRET` | the `oboyacrm` application secret (no default — login button is hidden without it) |
| `CASDOOR_ISSUER` | optional, defaults to `https://oboss.psorai.eu.org` (browser authorize/logout URL) |
| `CASDOOR_API_ORIGIN` | optional server-to-server origin for token/userinfo/JWKS; defaults to `CASDOOR_ISSUER`. Set this to an unchallenged hostname if Cloudflare blocks Vercel on the issuer |
| `CASDOOR_CLIENT_ID` | optional, defaults to `51a7f410327c44d55e4e` |
| `CASDOOR_REDIRECT_URI` | optional, defaults to `${NEXT_PUBLIC_SITE_URL}/callback` |
| `CASDOOR_POST_LOGOUT_URI` | optional, defaults to `${NEXT_PUBLIC_SITE_URL}/login` (must be query-free and registered in Casdoor) |
| `CASDOOR_SIGNUP_URL` | optional, defaults to `https://oboss.psorai.eu.org/signup/oboyacrm` |
| `CASDOOR_ALLOWED_EMAIL_DOMAINS` | optional comma-separated work domains, e.g. `oboya.cc,oboya-horticulture.com`; empty means no domain filter |
| `CASDOOR_ALLOWED_USER_TYPES` | optional comma-separated Casdoor `type` values; defaults to `normal-user` (self-service signup normally gets this value); empty disables the check |
| `CASDOOR_FORBIDDEN_USER_TAGS` | optional comma-separated Casdoor user `tag` values; empty by default, so guest/customer tags are only shown to the reviewer in Setup → Users; set to `guest-user` to reject guest accounts automatically (Casdoor marks them via `tag`, while their `type` is still `normal-user`) |
| `CASDOOR_ALLOWED_ORGANIZATIONS` | optional comma-separated Casdoor `owner` organizations; empty means no organization filter |

The type check fails closed: if `/api/get-account` cannot be read, `casdoorType` is null and the sign-in is rejected with `account_type_not_allowed` instead of being silently trusted. This means a Casdoor outage blocks new sign-ins but cannot let a customer account into the CRM. Guest/customer accounts are identified by `tag=guest-user` (their `type` is still `normal-user`). By default the tag is only recorded for admin review; setting `CASDOOR_FORBIDDEN_USER_TAGS=guest-user` turns it into an automatic rejection with `account_type_not_allowed`.

Flow: `/api/auth/casdoor/login` creates a PKCE verifier and CSRF state in short-lived httpOnly cookies and redirects to Casdoor. `/callback` validates the state and RFC 9207 `iss`, exchanges the code, and reads `/api/userinfo` plus `/api/get-account` so the Casdoor `type`, tags, roles and organization are available for policy checks. Casdoor proves identity, not employment: a first sign-in finds or creates a disabled Supabase Auth user and writes a pending row to `crm_casdoor_access_requests`, but **no OTP is generated and no CRM session is opened**. The browser returns to `/login?error=pending_approval`. A super admin reviews the request in Setup → Users and either rejects it or approves it with a role/team; approval activates the `crm_users` row, applies the verified OIDC metadata and link, and only the next sign-in creates the Supabase session. The ID token is kept in an httpOnly cookie only as an `id_token_hint` for logout. `CRM_BOOTSTRAP_ADMIN_EMAIL` still promotes the first super admin, but a Casdoor identity must be approved like everyone else.

"Sign out" in the topbar goes through `/api/auth/casdoor/logout`: it clears the Supabase session, then sends the browser to Casdoor's `/api/logout` with `id_token_hint`, `client_id`, `post_logout_redirect_uri` and `state`, ending the SSO session as well. The post-logout URI is the query-free `/login`; a five-minute `casdoor_signed_out` cookie makes the login page show the signed-out notice, and the page clears it on load. Casdoor then notifies other relying parties through back-channel logout. Supabase access tokens are stateless, so the back-channel receiver also stores `logout_at`; proxy and `crmGuard()` reject a Casdoor-backed session whose `casdoor_auth_at` predates that timestamp. Apply `20261120000000_crm_casdoor_sso.sql` and `20261125000000_crm_casdoor_access_requests.sql` before enabling this flow. `20261126000000_crm_casdoor_profile_fields.sql` adds the Casdoor signup fields (country code, phone, work unit/company) to the review queue and to `crm_users`; apply it before using the profile-sync button.

A failed link now reports a specific cause instead of one generic message: `oauth_state` (CSRF state/PKCE verifier cookie expired — retry from the page), `oauth_session` (CRM session lost or changed during the Casdoor round trip — sign in again), `oauth_token` (the code exchange failed — check the Vercel log for the exact Casdoor/Cloudflare response), `oauth_profile` (`/api/userinfo` and the ID token did not provide a valid `sub`/email — check the application's OIDC scopes). The token exchange uses PKCE first (no `client_secret` required by Casdoor), then falls back to `client_secret_post` and `client_secret_basic`; each failure is logged with its HTTP status and a redacted response body. If that body is a Cloudflare “Just a moment…” challenge, disable Bot Fight Mode for the Casdoor domain or set `CASDOOR_API_ORIGIN` to an unchallenged hostname serving the same Casdoor APIs. The userinfo mapping also falls back to ID-token claims when Casdoor's token format omits email, so a missing email no longer aborts the flow.

**Account linking:** normal Casdoor sign-in resolves an existing CRM user by email but does not attach `casdoor_sub` until an admin approves the pending request; a Casdoor identity bound to a different user is rejected instead of hijacking an account. For a different email, the signed-in user can open **Personal settings** (`/profile`, topbar user menu) and choose "Link Casdoor account": `/api/auth/casdoor/login?intent=link` keeps the current session, while `/callback` files a review request instead of binding immediately. Approval attaches the verified `sub` to that user without creating or switching accounts; rejection leaves the current session untouched. One `sub` and one CRM user may be linked only once, and unlinking revokes the approval so a new link must be reviewed again. The imported profile (display name, title, email, country/region, phone, region, work unit/company, avatar, Casdoor type/tags/roles/organization) is stored on the review request and, after approval, in `user_metadata`; country names/codes are normalized to the CRM's two-letter `country_code`, and Casdoor `affiliation` (or a custom `company` / `workUnit` / `工作单位` property) becomes the CRM company. "Sync profile from Casdoor" copies the imported name/title (always) and fills empty phone, country code and company fields; existing values are never overwritten, while the Casdoor email is displayed read-only because changing the Supabase email requires verification. Unlinking is only enabled after the user has signed in with a password at least once (or changed their password), so a Casdoor-only account cannot lock itself out. `/profile` also exposes self-editing of full name, job title, phone and language.

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
- **Inbound owner:** inserts into `crm_leads` by a privileged session (service role, imports, SQL editor) without an `owner_id` are assigned by the `trg_crm_leads_assign_owner` trigger (assignment rules first, then the fallback below; see Automation). The inbound route no longer sends `owner_id`. The fallback is `crm_assign_fallback_owner()`, and `rpc('crm_assign_inbound_owner')` stays as a service-role-only wrapper. It picks the next active user flagged `receives_inbound` (round-robin, cursor kept in `crm_settings.inbound_rr_cursor` under a row lock). If nobody is flagged, or `inbound_assignment.mode` is `default_owner`, it uses `crm_settings.inbound_default_owner`, then the oldest active super admin.
- **Audit:** a trigger on every object table writes `crm_audit_logs`. The action is one of `create`, `update`, `delete`, `restore`, `stage_change`, `owner_change` or `convert`. A lead `status` change is a `stage_change`. Config tables are audited too, with these `object` values: `crm_pipeline_stages` → `setup_stage`, `crm_picklist_values` → `picklist`, `crm_entities` → `entity`, `crm_roles` → `role`, `crm_teams` → `team`, `crm_users` → `user`, `crm_access_control` → `access_control`, `crm_settings` → `settings`. Rows keyed by a uuid fill `record_id`; others fill `record_key` (role id, setting key, `matrix` for the access matrix) and leave `record_id` null. For `admin_only` settings the value is never stored (`"[redacted]"`, `"[redacted, changed]"`), and the round-robin cursor is not audited. The diff is `{field: [old, new]}` for changed keys only. `updated_at`, `updated_by` and `raw_payload` are excluded. The app never writes audit rows. `actor_name` is a snapshot taken at write time, so the UI should resolve `actor_id` against `crm_users` to show the current name and use `actor_name` only as a fallback (system writes, deleted users).

## 6b. Automation (assignment rules, stage tasks, alerts, SLA, notifications)

The engine is Postgres (migrations `20261128000000_crm_automation.sql` and `20261128000100_crm_automation_cron.sql`); the app only edits configuration (`automation.view` / `automation.edit`) and shows results.

- **Tables:** `crm_assignment_rules`, `crm_assignment_cursors` (no client access), `crm_stage_task_templates`, `crm_alert_rules` (seeded: stalled 14 days, overdue grace 0 h, SLA on), `crm_notifications` (a user reads and marks only their own rows read; inserts come from definer functions only) and `crm_automation_runs`.
- **"Automation" actor:** automated writes run between `crm_automation_begin(ctx)` and `crm_automation_end(prev)`, which set and restore the transaction-local setting `crm.actor = 'automation'`. While it is set, `created_by`/`updated_by` are null, `crm_audit_logs.actor_id` is null, `actor_name` is `'Automation'`, and `crm_audit_logs.context` holds `{kind, rule_id, template_id, rule_name, template_name, triggered_by}`. Inbound lead inserts use a per-row key instead, cleared right after the audit row is written. Both helpers are revoked from clients.
- **Schedulers:** pg_cron runs `select public.crm_run_automation(now(), 'pg_cron', null)` every 15 minutes (job `crm-automation-run`). The Vercel cron `/api/crm/automation/cron` (daily, `CRON_SECRET` bearer) is the fallback and the only trigger when pg_cron is unavailable. Concurrent runs are serialised by an advisory lock; a busy lock records a `skipped` run. Check the job with `select jobid, jobname, schedule, active from cron.job where jobname = 'crm-automation-run';` and recent executions with `select status, start_time, return_message from cron.job_run_details order by start_time desc limit 10;`. The Runs tab lists recent runs. The cron migration only emits a notice when pg_cron is missing.
- **Runner:** `crm_run_automation(now, trigger, actor)` is service role only (the app calls it from `src/lib/crm/server/admin-only/automation-run.ts`). Sections: stalled deals (notify the owner, and the manager when the rule asks), overdue tasks, first-response SLA escalation (urgent task plus notification for the owner's manager, else the default owner, else the oldest super admin), and retention (read notifications and runs older than 90 days). Each kind handles at most 500 items per run; dedupe keys make a repeated run a no-op.
- **Assignment:** `crm_assign_lead_owner` is internal. `rpc('crm_assignment_preview', {p_country, p_entity, p_source})` previews without moving the round-robin cursor, and `rpc('crm_apply_assignment_rules', {p_lead_id})` assigns an existing lead (`leads.edit`, rate limited, `lead_converted` / `rate_limited` / `42501` / `P0002` errors).
- **Stage tasks and first response:** triggers on `crm_opportunities` (stage entry, including convert) and `crm_activities` (a done call or meeting, or an email whose `meta.direction` is not `inbound`, stamps `first_responded_at` on a `new` lead).

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
