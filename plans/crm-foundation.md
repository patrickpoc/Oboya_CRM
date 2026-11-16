# Oboya CRM: foundation + v1

- status: done (v1, 2026-11-16) · decisions D1–D6 below
- requested: 2026-11-16 · by: Patrick Oliveira

## Goal
Build the foundation and v1 of Oboya CRM (`crm.oboya-horticulture.com`): a Salesforce Sales Cloud object model (Leads, Accounts, Contacts, Opportunities, Activities) rendered in the Oboya admin shell, using the same stack, tokens, component patterns and agent workflow as `patrickpoc/Oboya_Website`. It runs on a new Supabase project. Record visibility (own / team / all) is enforced in RLS. Fourteen planned modules appear in the product as "To be done" pages driven by one registry.

## Phase 0 audit
- **This repo:** empty. `main` has no commits and no files, so nothing is kept or overwritten.
- **Reference** (`../_ref_oboya_website`, read-only, shallow clone): Next 16.3.4, React 19.2.4, next-intl 4, Tailwind 4, `@base-ui/react` + shadcn 4, zod 4, recharts 3, sonner 2, vitest 2, Playwright 1.64, `@supabase/ssr` 0.12.
- **What the CRM ports, and how:**

| Reference | CRM | Change |
|---|---|---|
| `src/styles/tokens.css`, `globals.css` (admin parts), `src/lib/fonts.ts` + `src/fonts/*` | same paths | Unchanged. Site-only keyframes and sections removed |
| `src/components/ui/*` (button, card, dialog, sheet, input, select, tabs, table, badge, checkbox, switch, skeleton, empty, label, textarea, separator, avatar, country-flag) | same | Unchanged. Marketing-only components dropped (typewriter, PageIntroBanner, section-title, container) |
| `components/admin/layout/*` | `components/crm/layout/Crm{Shell,Sidebar,Topbar,PageHeader,PageFooterActions,PageTransition,LoadingContext,LoadingOverlay,RouteDocumentTitle,LanguageSwitcher}` | Renamed. Topbar gains global search. Sidebar gains a "Soon" badge |
| `components/admin/common/*`, `data-table/DataTable`, `forms/FormDrawer`, `dashboard/{StatCard,ChartCard,QuickAccessGrid}`, `permissions/{Can,AccessDenied}`, `access-control/*` | `components/crm/...` | Same API. DataTable gains server pagination, sort and CSV hooks |
| `lib/cms/navigation.ts` | `lib/crm/navigation.ts` | Same shape plus `soon?: true`. Planned entries come from `roadmap.ts` |
| `lib/cms/permissions/*` (role × module × {view,create,edit,delete,publish}, grants/denies overrides, super_admin bypass) | `lib/crm/permissions/*` | Same resolver. Modules and roles are CRM-specific |
| `require-cms-auth.ts` (`cache()`, 401/403/503, MFA flag) | `lib/crm/server/require-crm-auth.ts` | **Change:** data queries use the user-JWT client, not the service role, so RLS applies. The service role is used only for users admin, inbound and seed |
| `(auth)/login, forgot-password, reset-password, change-password` + `must_change_password` | `src/app/(auth)/*` | Same flows at root paths |
| `lib/cms/forms/crm.ts` (SLA 24/48h, priorities, tags normalisation, CSV cell) | `lib/crm/leads/*` | SLA thresholds, priority values (`low/normal/high/urgent`), tag rules and the CSV escaping are reused verbatim |
| `cms_audit_logs` (text `details`) | `crm_audit_logs` | Adds `object`, `record_id`, `action`, `diff jsonb` |

## Architecture
- **Routing:** CRM at the root. The `(auth)` group holds `/login` and the password routes. The `(crm)` group holds the shell and everything else. `/` redirects to `/dashboard`. `src/proxy.ts` (Next 16 middleware) refreshes the Supabase session and redirects anonymous users to `/login`. Every page also calls `requireCrmAuth` (defence in depth). Every `/api/**` handler except `/api/inbound/*` calls `crmGuard(module, action)`.
- **Data access:** server components and route handlers call repositories in `src/lib/crm/repositories/*`. Repositories use the **user-scoped** Supabase client, so RLS is the source of truth for visibility. Writes go through route handlers (`/api/crm/<object>`): guard → zod → repository → audit. The app uses no client-side Supabase queries, which keeps one code path.
- **Record page:** one `RecordPage` driven by a per-object `RecordConfig` (`lib/crm/objects/<object>.ts`). The config declares fields (type, picklist source, editable, required), highlights fields, header actions, path (stage field + values), related lists and timeline. Leads, Accounts, Contacts and Opportunities all use it.
- **List views:** one `ObjectListView` (DataTable + FilterBar + URL filters) driven by the same config. It provides predefined views `mine | all | recent`, server-side sort and pagination (`?view=&sort=&dir=&page=&q=…`), and CSV export via `/api/crm/<object>/export` (same filters, RLS-scoped, `csvCell` from the reference).
- **Recently viewed:** `crm_recent_views (user_id, object, record_id, viewed_at)` is upserted on record page load.
- **Global search:** `/api/crm/search?q=` returns the top 5 per object from leads, accounts, contacts and opportunities, using `pg_trgm` + `ilike` on name/email/company. Results are RLS-scoped. A topbar combobox shows them with `⌘K`.
- **Audit:** `logAudit({object, recordId, action, before, after})` computes a shallow diff in TS and inserts into `crm_audit_logs`. Actions: `create | update | delete | restore | convert | stage_change | owner_change`. A DB trigger was considered and rejected because the actor name is easier to resolve in the app. **The open-question list asks you whether to use a trigger instead.**
- **Roadmap:** `lib/crm/roadmap.ts` is a typed registry `{ id, group, icon, href, status: "planned" | "live", i18n: { title, description, capabilities[], dependencies[] } }`. The sidebar reads it (`soon` badge when planned). Each route `src/app/(crm)/<module>/page.tsx` renders `<PlannedModulePage id="quotes" />`. To promote a module, replace the page and set `status: "live"`.

## Schema (new Supabase project, `supabase/migrations/`)
Every object table has `id uuid pk`, `owner_id uuid → crm_users`, `created_by`, `created_at`, `updated_at` (trigger), `deleted_at` (soft delete) and `deleted_by`. RLS is on for every table. Lists filter `deleted_at is null`. Restore is admin-only.

| Migration | Contents |
|---|---|
| `20261116_crm_core.sql` | extensions (`pgcrypto`, `pg_trgm`); `crm_teams (id, name, manager_id)`; `crm_users (id → auth.users, full_name, email, role, team_id, manager_id, status, permission_overrides jsonb, locale)`; `crm_roles`, `crm_access_control (singleton jsonb matrix)`; helper SQL functions `crm_current_role()`, `crm_is_admin()`, `crm_can_see(owner uuid)` (self, or manager of owner's team, or admin) as `security definer stable`; privilege guard trigger (users cannot change own role/status/team, as in reference `20261105`) |
| `20261116_crm_picklists.sql` | `crm_picklist_values (picklist, value, label, sort, active, meta jsonb)` for `lead_source`, `segment`, `loss_reason`, `industry`, `tag`; `crm_pipeline_stages (pipeline, key, label, probability, sort, is_closed, is_won, active)` with default pipeline `default`; `crm_pipelines`; `crm_entities` + `crm_account_entities` (D5); `crm_settings` (key/value jsonb: inbound assignment, FX table) |
| `20261116_crm_objects.sql` | `crm_accounts (name, type customer/prospect/distributor/partner, country_code, segment, industry, website, phone, entity, parent_account_id, billing address cols)`; `crm_contacts (account_id, first/last name, email, phone, title, country_code)`; `crm_leads (first/last name, company, email, phone, country_code, status new/working/qualified/unqualified, unqualified_reason, source, priority, tags text[], message, rating, entity, first_responded_at, converted_at, converted_account_id/contact_id/opportunity_id, external_ref, raw_payload jsonb)`; `crm_opportunities (name, account_id, primary_contact_id, pipeline_id, stage_id, probability, amount numeric(14,2), currency char(3), close_date, loss_reason, loss_note, entity, lead_source, closed_at)` + check that `loss_reason` is set when stage = closed_lost; `crm_activities (type task/call/meeting/note, subject, body, due_at, status open/done, priority, what_object + what_id (polymorphic), who_contact_id, completed_at)`; `crm_recent_views`; `crm_audit_logs (actor_id, actor_name, object, record_id, action, diff jsonb, created_at)`; trigram indexes; `unique (lower(email)) where deleted_at is null` on leads |
| `20261116_crm_rls.sql` | Per object: `select/update using crm_can_see(owner_id) and deleted_at is null`; `insert with check owner_id = auth.uid() or crm_is_manager_of(owner_id) or crm_is_admin()`; no `delete` policy (soft delete via update; hard delete only by service role). Activities inherit visibility from their own `owner_id` **or** visibility of the parent record. Audit logs: insert by authenticated users for themselves; select for admin + managers (team scope). Picklists/stages: read all authenticated, write admin. Read Only role: RLS gives `select` per `crm_can_see` scope "all", and module permission denies writes |
| `20261116_crm_functions.sql` | `crm_convert_lead(lead_id, account_id?, create_opportunity bool, opp_name, …)` as `security invoker` plpgsql: one transaction creates or links Account + Contact + optional Opportunity, marks the lead `qualified`/converted, repoints the lead's activities, returns ids. RLS applies to every step |

**Planned without creating tables (no breaking changes later):** `crm_products`, `crm_price_books`, `crm_price_book_entries`; `crm_opportunity_line_items (opportunity_id, product_id, qty, unit_price, discount)`, with opportunity `amount` becoming derived when line items exist; `crm_quotes (opportunity_id, rfq_reference)`; `crm_orders`; `crm_campaigns` + `crm_campaign_members`, and a nullable `campaign_id` column later added to leads/opportunities; `crm_cases`; `crm_email_messages` linking to activities by `what_object/what_id`; `crm_approval_requests` (reference change-request model); `crm_forecasts`, `crm_quotas`. The polymorphic `what_object` + stage table + picklist table + `external_ref` + `raw_payload` give these modules a place to attach without rewriting.

## Access model
- **Roles:** `super_admin`, `sales_manager`, `sales_rep`, `read_only`. They are editable in Setup like the reference. Custom roles are allowed and inherit the visibility scope of a chosen base.
- **Modules:** `home, leads, accounts, contacts, opportunities, activities, reports_soon, setup_users, setup_access, setup_pipeline, setup_picklists, audit_logs`. Actions: `view, create, edit, delete, convert` (`publish` is replaced by `convert`/`export`; mapped `delete` covers soft delete).
- **Visibility (RLS, `crm_can_see`):** rep = own; manager = own + users whose `team_id` is a team they manage; super_admin and read_only = all (read_only cannot write, enforced by RLS on insert/update via `crm_current_role() <> 'read_only'` and by the permission matrix).
- **Resolution in TS:** port `canAccessUser` (role ∪ grants − denies, super_admin bypass). Covered by vitest.

## Route map
`/login` `/forgot-password` `/reset-password` `/change-password` · `/dashboard` · `/leads`, `/leads/[id]` · `/accounts`, `/accounts/[id]` · `/contacts`, `/contacts/[id]` · `/opportunities` (list), `/opportunities/pipeline` (kanban), `/opportunities/[id]` · `/activities` (all), `/tasks` (My tasks: overdue / today / upcoming) · `/setup/users`, `/setup/roles` (incl. visibility scope), `/setup/access`, `/setup/companies`, `/setup/pipeline`, `/setup/picklists`, `/setup/lead-assignment`, `/setup/audit-log` · planned: `/products`, `/quotes`, `/orders`, `/campaigns`, `/email`, `/reports`, `/forecasting`, `/cases`, `/automation`, `/approvals`, `/ai-assistant`, `/integrations`, `/data-import`, `/duplicates`.
API: `/api/crm/{leads,accounts,contacts,opportunities,activities}` (+ `/[id]`, `/export`), `/api/crm/leads/[id]/convert`, `/api/crm/opportunities/[id]/stage`, `/api/crm/search`, `/api/crm/dashboard`, `/api/crm/nav-counts`, `/api/crm/{users,access-control,stages,picklists,audit-logs}`, `/api/crm/me`, `POST /api/inbound/leads`.

## Inbound leads (`POST /api/inbound/leads`)
- **Auth:** header `X-Oboya-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`. The tolerance is 5 min and the comparison is constant-time. The secret is `INBOUND_LEADS_SECRET`, server-only.
- **Payload:** a zod discriminated union on `type`:
  - `contact` uses the website contact fields: `firstName, lastName, email, phone?, countryCode, countryName?, company?, subject, message`.
  - `quote` uses the RFQ fields: `company, contactName, email, phone, country?, countryCode, currency, message?, referenceId, items[{sku,name,qty,unit?}]`.
  - Both carry optional `locale` and `submittedAt`, plus `privacyAccepted: true` (required).
- **Dedupe:** match on `lower(email)` against non-deleted leads.
  - Lead exists and is open: append an activity (note with payload summary, `meta.referenceId`), bump `last_activity_at`, return `200 {leadId, deduplicated:true}`.
  - Lead was converted: attach the activity to the converted contact.
  - No match: create the lead (source `website_contact` / `website_rfq`, owner = round-robin default owner from env/setting) and return 201.
- **Idempotency:** an optional `Idempotency-Key` header is stored on the activity/lead `external_ref`.
- Writes use the service role, because the endpoint has no user. Rate limiting is left to the Vercel WAF, as in the reference.
- The contract is documented in `docs/INBOUND-LEADS.md`.

## Tasks
| # | Task | Agent | Files | parallel |
|---|------|-------|-------|----------|
| 1 | Scaffold: Next 16 app, `package.json` (same versions as ref), eslint, tsconfig, vitest, playwright config, `AGENTS.md`, `CLAUDE.md`, `.claude/agents/{planner,builder-crm-ui,builder-crm-data,builder-crm-objects,i18n,reviewer,security-reviewer}.md`, `orca.yaml`, `.env.example`, `docs/`, i18n plumbing (`src/i18n`, `messages/{locale}/index.ts`, `scripts/check-i18n.mjs` ported) | orchestrator setup → builder-crm-ui | root, `src/i18n`, `scripts` | no (first) |
| 2 | Design system port: tokens, globals, fonts, `components/ui/*` | builder-crm-ui | `src/styles`, `src/fonts`, `src/lib/fonts.ts`, `src/components/ui` | yes (with 3) |
| 3 | Database: 5 migrations above, `supabase/seed/` + `scripts/seed-demo.mjs` (realistic demo: 3 teams, ~8 users, 60 leads, 25 accounts, 50 contacts, 35 opps, 120 activities across entities and countries), `scripts/create-admin-user.mjs` | builder-crm-data | `supabase/**`, `scripts/seed-*`, `scripts/create-admin-user.mjs` | yes (with 2) |
| 4 | Supabase clients, `proxy.ts`, `require-crm-auth`, `crmGuard`, permissions lib + defaults, audit helper, auth pages | builder-crm-data | `src/lib/supabase`, `src/lib/crm/{server,permissions,audit}`, `src/app/(auth)`, `src/proxy.ts` | no (after 3) |
| 5 | Shell + shared patterns port, `navigation.ts`, `roadmap.ts`, `PlannedModulePage`, 14 planned routes + `messages/en/roadmap.json` | builder-crm-ui | `src/components/crm/{layout,common,data-table,forms,dashboard,permissions}`, `src/lib/crm/{navigation,roadmap}.ts`, planned routes | no (after 2, 4) |
| 6 | Object framework: `RecordConfig`, `RecordPage` (highlights, Path, Details + inline edit, Related lists, Activity timeline + composer), `ObjectListView` (views, filters, sort, pagination, CSV), repositories base, generic `/api/crm/[object]` handlers | builder-crm-objects | `src/components/crm/record`, `src/components/crm/list`, `src/lib/crm/{objects,repositories}` | no (after 5) |
| 7a | Leads: config, SLA, status flow, Convert Lead dialog + RPC route, tests | builder-crm-objects | `lib/crm/leads`, `app/(crm)/leads`, `api/crm/leads/**` | yes (after 6) |
| 7b | Accounts + Contacts configs, pages, related lists | builder-crm-objects (2nd instance) | `app/(crm)/{accounts,contacts}`, `lib/crm/objects/{account,contact}.ts` | yes |
| 7c | Opportunities: list, kanban (native HTML5 DnD + keyboard move menu; no new dep), stage route enforcing loss reason, tests | builder-crm-objects (3rd instance) | `app/(crm)/opportunities/**`, `components/crm/pipeline` | yes |
| 7d | Activities + My tasks + timeline composer wiring | builder-crm-objects (4th) | `app/(crm)/{activities,tasks}`, `lib/crm/activities` | yes |
| 8 | Home dashboard, global search, nav counts | builder-crm-ui | `app/(crm)/dashboard`, `components/crm/search`, `api/crm/{dashboard,search,nav-counts}` | yes (after 7) |
| 9 | Setup: users & roles, access matrix, pipeline stages, picklists, audit log viewer | builder-crm-data | `app/(crm)/setup/**`, `api/crm/{users,access-control,stages,picklists,audit-logs}` | yes (with 8) |
| 10 | Inbound endpoint + `docs/INBOUND-LEADS.md` + tests | builder-crm-data | `api/inbound/**`, `lib/crm/inbound` | yes (with 8, 9) |
| 11 | Tests: vitest (conversion mapping, permission resolution, SLA, stage transitions, inbound zod + HMAC), RLS tests (`tests/rls/*.test.ts` against local Supabase via `supabase start`, using seeded rep/manager/admin JWTs), Playwright smoke (login, create lead, convert, move stage, planned page) | builder-crm-data + builder-crm-ui | `tests/**`, `**/__tests__` | after 7–10 |
| 12 | i18n mirror (pt-BR, es, zh-CN) | i18n | `messages/{pt-BR,es,zh-CN}` | after all builders |
| 13 | Review + security review, ≤2 fix loops, README, `docs/SUPABASE.md`, close | reviewer, security-reviewer | — | last |

## i18n
Namespaces in `messages/en/` (one JSON file each): `accounts`, `activities`, `auth`, `common`, `contacts`, `dashboard`, `leads`, `listViews`, `nav`, `opportunities`, `record`, `roadmap`, `search`, `setup`, `shell`. All keys are new. There is no separate `errors` namespace: API errors map to `record.errors.*` (rule-specific copy under `record.errors.rules.<code>`) and `setup.errors.*` through the one `useApiErrorMessage` hook in `components/crm/common/api.ts`; shell-level copy (topbar, sidebar, overlay) lives in `shell`.

## Roadmap copy (goes into `messages/en/roadmap.json`)
- **Products & Price Books:** a product catalog synced from the website marketplace (SKU = id, same as the shop). Price books per country and currency feed opportunity line items and quotes. Depends on: website catalog API, `opportunity_line_items`.
- **Quotes:** build a quote from an opportunity, with line items from price books, discounts, taxes and validity. Produces a branded PDF and goes through approval when discounts exceed the threshold. Linked to the website RFQ reference. Depends on: Products, Approvals.
- **Orders:** order records created from Closed Won opportunities or accepted quotes, with fulfilment status and ERP handoff. Depends on: Quotes, ERP integration.
- **Campaigns:** trade shows, digital and email campaigns with member lists (leads/contacts), lead-source attribution on leads and opportunities, cost and ROI. Depends on: `campaign_id` columns.
- **Email:** Microsoft 365 / Gmail mailbox sync, templates per locale, sending from the record page, and automatic logging to the activity timeline. Depends on: Integrations.
- **Reports & Dashboards:** a report builder on CRM objects with filters, grouping and charts. Saved and shared reports, and custom dashboards per team. Depends on: none.
- **Forecasting:** forecast by rep, team, entity and period, with quotas, weighted pipeline (amount × probability), commit/best case categories and multi-currency rollup. Depends on: Reports, FX rates.
- **Cases:** post-sale support tickets linked to accounts and contacts, with priority, SLA and resolution tracking. Depends on: Email.
- **Automation:** lead assignment rules (country, entity, round-robin), stage-based task creation, alerts, and first-response SLA escalation to the manager. Depends on: none.
- **Approvals:** discount and deal approvals, reusing the website's change-request model (policy, approvers, pending/approved/rejected). Depends on: Quotes.
- **AI Assistant:** lead scoring, record summaries, next-best action and email drafting on the record page (Claude API). Depends on: Email, Reports data.
- **Integrations:** website forms and RFQ (endpoint is live; wiring pending), ERP, WhatsApp Business, Google/Microsoft calendar. Depends on: none.
- **Data Import:** a spreadsheet import wizard with column mapping, validation preview, dedupe against existing records and an import log. Depends on: Duplicate Management.
- **Duplicate Management:** matching rules (email, normalised company + country), duplicate alerts on create, and a side-by-side record merge with audit trail. Depends on: none.

## Acceptance criteria
- [ ] Shell, tokens and components match the reference admin, compared visually at 375 / 768 / 1280.
- [ ] All v1 items 1–11 of the brief work end to end against Supabase. No mock data.
- [ ] RLS tests pass: a rep sees only own records, a manager sees the team, admin and read_only see all, read_only cannot write, and a soft-deleted record is hidden.
- [ ] Vitest covers conversion, permissions, SLA, stage transitions and inbound validation/HMAC.
- [ ] Playwright smoke covers login, create lead, convert lead, move stage and a planned page.
- [ ] `npm run lint && npm run i18n:check && npm test && npm run build` pass.
- [ ] README, `docs/SUPABASE.md`, `docs/INBOUND-LEADS.md` and `docs/SECURITY.md` are written.

## Assumptions
1. **Fonts:** the brand font files (Neue Haas, Plus Jakarta) are copied from the reference. Their license covers internal tools.
2. **Default locale:** `en`. Locale is stored per user plus a cookie, with no locale prefix in URLs (like the reference admin).
3. **Currency:** each opportunity has its own currency (`BRL, USD, EUR, CNY`). KPIs show per-currency totals plus a USD total from a static rate table in settings. FX sync is part of Forecasting.
4. **Teams:** each user belongs to one team. A manager manages one or more teams. Hierarchy is one level deep.
5. **Kanban drag and drop:** native HTML5 + pointer fallback plus a keyboard "Move to…" menu. No dnd library. If touch drag at 375px proves poor, I'll ask before adding `@dnd-kit` (≈ 12 kB).
6. **Lead dedupe:** email is unique among live leads. Manual creation of a duplicate email shows the existing lead instead of failing silently.
7. **RLS tests:** they run against a local Supabase stack (`supabase start`, needs Docker). If Docker is not available here, they run against a dedicated test project you provide.

## Decisions (answered 2026-11-16)
- **D1 Supabase:** Patrick creates the new project and fills `.env.local`. Until then builders code against the migrations, and RLS tests run against that project (or a local `supabase start` if Docker is available).
- **D2 Visibility per role is editable in admin:** `crm_roles.visibility_scope` (`own | team | all`) plus `crm_roles.can_write` are edited in Setup → Roles. `crm_can_see()` reads the scope from the user's role, so changing Read Only (or any custom role) to `team` or `all` takes effect in RLS immediately. Defaults: rep `own`, manager `team`, super_admin `all`, read_only `all` + `can_write=false`.
- **D3 Inbound owner:** a setting in Setup → Lead assignment chooses `round_robin` over active users flagged `receives_inbound`, or a fixed `default_owner`. It defaults to round-robin, with fallback to the default owner (and then the oldest super_admin) when nobody is flagged. The cursor is kept in `crm_settings` and updated atomically inside an RPC.
- **D4 Audit:** a Postgres trigger on every object table (`after insert/update/delete`). It is tamper-proof, also covers service-role writes (inbound, seed), and stores `old`/`new` diff as jsonb. The semantic action is derived in the trigger: `stage_change` (stage_id changed), `owner_change`, `convert` (converted_at set), `delete`/`restore` (deleted_at toggled), else `create`/`update`. The actor is `auth.uid()`, falling back to the row's `updated_by` (`system:inbound` for the endpoint). `crm_audit_logs` has no insert policy for clients. This replaces the app-level `logAudit` described in Architecture.
- **D5 Group companies (no visibility restriction):** `crm_entities` is editable in Setup → Companies (name, legal name, country, tax id, default currency, logo, active) and seeded with Oboya Horticulture, Oboya Horticultura and Oboya Reciclagem. Leads and opportunities have one `entity_id` (the company the deal is directed to). Accounts link to many entities through `crm_account_entities (account_id, entity_id, is_primary, since)`, because one customer can be served by several group companies. Entity is a filter in list views, kanban and dashboard. It is not part of RLS.
- **D6 Stages fully editable:** Setup → Pipeline supports creating, renaming, reordering (drag + keyboard), editing probability, setting a color from the brand tokens, and deactivating or removing stages. Opportunities reference `stage_id` (not a key), so renames are safe.
  - Removing a stage that still has opportunities requires choosing a target stage, and the RPC moves them; those moves are audited.
  - The system keeps at least one open stage, exactly one `won` and at least one `lost`. Won and Lost can be renamed but not removed.
  - The table carries `pipeline_id` (one default pipeline in v1), so pipelines per entity can be added later without a breaking change.
  - The six default stages listed under Q6 are seeded.

## Former open questions
1. **Supabase:** do you create the new project and give me the URL plus keys in `.env.local`, or should I build against local `supabase start` only for now?
2. **Read Only:** should it see all records (my default), or follow team scope?
3. **Inbound owner assignment:** round-robin across active reps, or a single default owner (for example a sales manager) until Automation exists?
4. **Audit:** app-level diff (my default) or a Postgres trigger that is tamper-proof but captures less context?
5. **Entities:** does the Oboya entity also restrict visibility (for example Reciclagem reps see only Reciclagem accounts), or is it only a field?
6. **Opportunity stages default:** Prospecting 10% → Qualification 20% → Needs Analysis 40% → Proposal/RFQ 60% → Negotiation 80% → Closed Won 100% / Closed Lost 0%. OK?

## Risks / notes
- Security review is required for tasks 3, 4, 9 and 10 (RLS, auth, permissions, `api/**`, inbound HMAC).
- RLS with a user-JWT client is a change from the reference, which uses the service role after the guard. It is the only way to meet "enforced in RLS", but every repository must use the right client. A lint rule (`no-restricted-imports` of the service client outside `lib/crm/server/admin-only/*`) enforces this.
- `security definer` helpers must pin `search_path`.
- The convert RPC runs as invoker, so a rep converting a lead owns the new records.
- Next 16 has breaking changes (`proxy.ts` replaces middleware, async params). Builders read `node_modules/next/dist/docs/` first.
- Scope is large: about 13 tasks and several agent runs. I will report at the end of each phase, not only at the end.

## Status (2026-11-16)
- **Done:** tasks 1–12 (scaffold, design system, database + seed, auth/permissions, shell + roadmap, object framework, Leads / Accounts / Contacts / Opportunities / Activities, dashboard + search, Setup, inbound endpoint, tests, i18n mirror).
- **In progress:** task 13 (review + security review, docs, close). The review and security-review findings were fixed across two loops. Docs written: `README.md`, `docs/SUPABASE.md`, `docs/INBOUND-LEADS.md`, `docs/SECURITY.md`.
- **Open before production:** rotate the service_role key and the DB password, remove the demo data or use a clean project, and decide LGPD retention (`docs/SECURITY.md` §6, §8).

### Final checks
**Final checks (2026-11-16):**
- `npm run lint`: pass.
- `npm run i18n:check`: 4 locales match en (1,023 keys, 15 namespaces).
- `npm test`: 14 files, 164/164.
- `npm run build`: pass, 77 routes.
- `npm run test:rls` (live project): 100/100.
- `npm run test:e2e`: 2/2 (login → create lead → status → convert → opportunity stage (Path + kanban) → planned page; 375px dashboard + drawer).
- Migrations 000100–000700 applied; history in sync.
