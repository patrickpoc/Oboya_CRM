# Production security runbook

Canonical URL: `https://crm.oboya-horticulture.com`.

Apply this checklist at deploy time. The CRM holds customer and lead personal data, and RLS is the source of truth for who sees it. Code changes alone do not protect production unless the migrations are applied to the live Supabase project and the dashboard settings below are set.

## 1. Supabase Authentication

- **Sign-ups off:** Authentication → Providers → Email → turn **off** "Allow new users to sign up". Users are created only from Setup → Users or `npm run create-admin`. Any other auth user gets a disabled `sales_rep` row with no access.
- **Email only:** keep email/password as the only provider unless a new one is explicitly approved.
- **Secure password change:** Authentication → Providers → Email → enable **"Secure password change"**. Supabase then requires a recent sign-in before a password update. The app also checks the current password on `/change-password`.
- **URL configuration:** set the Site URL to `https://crm.oboya-horticulture.com`. Add these redirect URLs:
  - `http://localhost:3000/auth/callback` (dev only; keep it on the dev project, not production)
  - `https://crm.oboya-horticulture.com/auth/callback`

  `/auth/callback` exchanges the recovery code and opens `/reset-password`. That page accepts only sessions opened from a recovery link.
- **CAPTCHA:** enable hCaptcha or Cloudflare Turnstile under Authentication → Attack Protection.
- **MFA:** enable TOTP under Authentication → Multi-Factor. Have every `super_admin` enroll on `/mfa` (QR code). Then set `CRM_REQUIRE_MFA=true` on Vercel. With that flag, super admins and anyone with a TOTP factor must reach AAL2: users without a factor are sent to `/mfa` to enroll, and enrolled users get a challenge there.

## 2. Bootstrap admin and passwords

- Create the first admin with `ADMIN_EMAIL=… ADMIN_PASSWORD='…' npm run create-admin`, run from a trusted machine. The script never prints the password. Set `ADMIN_MUST_CHANGE_PASSWORD=1` when someone else will use the account.
- The alternative is the one-shot `bootstrap_admin_email` setting (`docs/SUPABASE.md` §4). It applies only while no active super admin exists and is deleted after use.
- Users created from Setup → Users get a one-time random password with `app_metadata.must_change_password = true`. `src/proxy.ts` sends them to `/change-password` until they set their own password.
- `/api/crm/me/change-password` is rate-limited in the database (`crm_rate_limit_hit('change_password', 5, 900)`: 5 attempts per 15 minutes per user). Above the limit it returns `429`.
- Never document or reuse a default password. Rotate any password that was shared in chat or email.

## 3. Data access model

- **User-scoped client and RLS:** pages and `/api/crm/**` handlers use the Supabase client carrying the **user's JWT**, so Postgres RLS decides every read and write. Every page calls `requireCrmAuth()`. Every API handler calls `crmGuard(module, action)` and then validates input with zod. The app has no client-side Supabase queries.
- **Service-role allowlist:** the service-role client (`src/lib/supabase/admin.ts`) and `SUPABASE_SERVICE_ROLE_KEY` may be used only in `src/lib/crm/server/admin-only/**` (users admin), `src/app/api/inbound/**`, `scripts/`, `tests/` and `e2e/`. ESLint enforces this (`no-restricted-imports`, `no-restricted-syntax`), so `npm run lint` fails anywhere else.
- **Permission matrix enforced in the DB:** `crm_access_control.matrix` (role × module × action) plus per-user grants and denies is evaluated by `crm_has_permission()` inside the RLS policies and RPCs. It is not checked only in TypeScript, so a direct REST call cannot skip it. `super_admin` is always allowed. The Read Only role (`can_write = false`) cannot insert or update anything.
- **Row guard:** a trigger checks every user-session write. A new owner must be visible to the writer. Every reference (account, contact, parent, `what_id`) must point at a visible record. Clients can never write `converted_*` on leads, and converted leads are read-only. Users cannot change their own role, status or team.
- **Soft delete through an RPC:** clients have no `DELETE` policy on object tables. Deletes go through `crm_soft_delete` (needs `<module>.delete`), and only an admin may call `crm_restore`. Only the service role can hard-delete.
- **Audit by trigger:** every object table and config table has an audit trigger that writes `crm_audit_logs`. Clients have no insert, update or delete rights on it, which makes it tamper-proof and also covers service-role writes. Values of `admin_only` settings are redacted, and `raw_payload` is excluded from diffs.
- **Audit actor resolution:** the trigger records `actor_id = auth.uid()` (falling back to the row's `updated_by`, or to `system` for service writes) plus an `actor_name` snapshot. The UI resolves `actor_id` against the current `crm_users` name and falls back to the snapshot, then to `system` (`resolveActorName` in `src/lib/crm/setup/audit.ts`).
- **Function grants:** `EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated` on every function. Only the listed app RPCs and RLS helpers are granted back, and `security definer` functions pin `search_path`. `anon` has no table privileges.

## 4. Inbound endpoint (`POST /api/inbound/leads`)

- **HMAC:** the header `X-Oboya-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>` is checked against `INBOUND_LEADS_SECRET`, with a 5-minute tolerance and a constant-time comparison. Failures return a bare `401`. Without the secret the endpoint returns `503`. The body is limited to 64 KB. The contract is in `docs/INBOUND-LEADS.md`.
- **Secret rotation:** generate the secret with `openssl rand -hex 32` and store it only in Vercel env (CRM and website), never `NEXT_PUBLIC_`. To rotate without downtime, the website signs with both the old and the new secret (several `v1=` values are accepted), but the CRM checks a single secret. So the order is: set the new secret on the website as an additional signature, switch the CRM to the new secret and redeploy, then drop the old secret from the website. Rotate it whenever it may have leaked, and at least yearly.
- **Never relay the CRM response to visitors:** the website forwards submissions server-side, without blocking the visitor, and shows its own confirmation. CRM ids and errors stay in server logs.
- **WAF rate limiting:** the endpoint has no per-caller limit in the app. Add a Vercel Firewall rule that rate-limits `POST /api/inbound/leads` (for example per IP, tight enough that only the website's servers fit), and enable Attack Challenge if the path is flooded.

## 5. Headers

`next.config.ts` sets these on every path:

- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (production builds)
- `Cache-Control: private, no-cache, no-store, must-revalidate` on pages and API responses (static assets keep Next's caching)
- `X-Powered-By` is removed. The root layout sets `robots: noindex, nofollow`.

## 6. Secrets hygiene

- Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `INBOUND_LEADS_SECRET`, the DB password, and `ADMIN_*` / `DEMO_PASSWORD`. None of them may ever get a `NEXT_PUBLIC_` prefix.
- `.env.local` and `.env` are git-ignored. `.env.example` holds names only. Agents never read or print `.env*`.
- Vercel: set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `INBOUND_LEADS_SECRET`, and optionally `CRM_REQUIRE_MFA`. Mark the secret ones as sensitive. Do not set `SEED_*` or `ADMIN_*` there.

> **Action items before production:**
> 1. **Rotate the `service_role` key and the database password.** Both were shared during setup. Rotate the key under Project Settings → API (JWT keys), reset the DB password under Project Settings → Database, then update Vercel and any local `.env.local`.
> 2. **Remove the demo users and demo data**: the `demo.*@example.com` users and every record with `external_ref like 'demo:%'`, plus their audit rows. Also remove any leftover `rls-admin-*` or `e2e-*` test rows. The alternative is to **use a clean production project** that has only the migrations applied and has never been seeded. That is the preferred option.
> 3. Keep the test and demo project separate from production, and never point `test:rls` or `test:e2e` at production.

## 7. Smoke tests after deploy

- `GET /api/crm/me`, `GET /api/crm/leads` and `GET /api/crm/dashboard` without a session return `401`.
- `GET /dashboard` without a session redirects to `/login`.
- Anon REST: `GET https://<project-ref>.supabase.co/rest/v1/crm_leads` (repeat for `crm_accounts`, `crm_contacts`, `crm_opportunities`, `crm_activities`, `crm_users` and `crm_audit_logs`) with only the anon key returns `401` (permission denied), never rows or an empty `[]`.
- `POST /api/inbound/leads` with no or a bad signature returns `401`.
- The response headers on `/login` include everything in §5, including `Strict-Transport-Security` and `Cache-Control: no-store`.
- The page source has `<meta name="robots" content="noindex, nofollow">`.
- Log in as the admin and confirm MFA is required when `CRM_REQUIRE_MFA=true`.
- Next.js on the deployment is ≥ 16.3.3 (the repo pins 16.3.4).

## 8. LGPD notes

- **Lead PII:** leads, contacts and activities hold names, emails, phones, companies, countries and free-text messages. Access follows the role scope (RLS). CSV export follows the same scope and needs the `export` permission. Grant it sparingly.
- **Retention: open question (TBD).** No retention period or purge job is defined yet for unconverted leads, inbound notes or audit logs. Decide the period (the website purges unconverted inquiries after 12 months) and add a purge or anonymize job before go-live.
- **Inbound `raw_payload`:** `crm_leads.raw_payload` keeps the validated website submission, including the message, consent flags (`privacyAccepted`, `marketingOptIn`) and `submittedAt`, as evidence of consent. It is excluded from audit diffs. The website must not send IP hashes or other context (they are stripped anyway). Include `raw_payload` in any deletion or anonymization request.
- **Data subject requests:** a super admin soft-deletes the records, then hard-deletes them with the service role when erasure is required. Audit rows for those records must be handled under the same retention decision.
- The privacy contact and controlling policy are the same as the website's (`pt-BR` and English privacy policy).
