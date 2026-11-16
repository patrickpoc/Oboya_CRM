# Oboya CRM

Internal CRM for the Oboya group, served at `https://crm.oboya-horticulture.com`.

- **Website admin:** the CRM belongs to the same product family as the Oboya_Website admin. It uses the same shell, brand tokens, component patterns and agent workflow, but it runs on its **own Supabase project**. The two share no database. The website sends contact-form and RFQ submissions to the CRM through a signed endpoint (`docs/INBOUND-LEADS.md`).
- **Salesforce:** the data model follows Salesforce Sales Cloud: Leads, Accounts, Contacts, Opportunities and Activities, with lead conversion, pipeline stages and record pages. It is a standalone app and does not sync with Salesforce.
- **Plan of record:** `plans/crm-foundation.md`.

## Stack

Next.js 16 (App Router, `src/proxy.ts`) · React 19 · next-intl 4 (`en`, `pt-BR`, `es`, `zh-CN`) · Supabase (Auth, Postgres, RLS) · Tailwind 4 · shadcn / base-ui · zod 4 · recharts · Vitest · Playwright · Vercel.

## Prerequisites

- Node.js 20+ and npm.
- A Supabase project for the CRM (create a separate one for dev/test).
- The Supabase CLI via `npx supabase` (to apply migrations).
- Chromium for the e2e suite: `npx playwright install chromium`.

## Setup

```bash
npm install
cp .env.example .env.local      # then fill in the values (never commit it)
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `NEXT_PUBLIC_SITE_URL` and `INBOUND_LEADS_SECRET`. Optional: `CRM_REQUIRE_MFA=true`. The full table is in `docs/SUPABASE.md` §3.

**1. Configure Auth.** Turn off sign-ups, enable "Secure password change" and set the redirect URLs (`docs/SUPABASE.md` §1, `docs/SECURITY.md` §1).

**2. Apply the migrations** in `supabase/migrations/` (7 files, applied in filename order):

```bash
npx supabase db push --db-url "postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres"
```

If the direct connection fails (it is IPv6-only on many networks), use the **session pooler** URL from Project Settings → Database → Connection string → Session pooler, for example `postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. You can also paste each file into the SQL editor in order. Each file is one transaction and can be re-run.

**3. Bootstrap the first admin.** The password is read from the env and never printed:

```bash
ADMIN_EMAIL=you@oboya-horticulture.com ADMIN_PASSWORD='…' npm run create-admin
```

Set `ADMIN_MUST_CHANGE_PASSWORD=1` to force a password change at first login. Other users are created from Setup → Users.

**4. Demo data (optional, dev/test projects only).** The seed refuses to run unless both guards match the project in `NEXT_PUBLIC_SUPABASE_URL`:

```bash
SEED_ALLOW=1 SEED_PROJECT_REF=<project-ref> DEMO_PASSWORD='…' npm run seed:demo
```

**5. Run the app:**

```bash
npm run dev     # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server on port 3000 |
| `npm run lint` | Runs ESLint, which also enforces the service-role import allowlist |
| `npm run i18n:check` | Checks that all four locales have the same keys and ICU placeholders |
| `npm test` | Runs the Vitest unit tests (no network) |
| `npm run test:rls` | Runs the RLS tests with real user JWTs against a seeded **test** project |
| `npm run test:e2e` | Runs the Playwright smoke tests: builds the app, serves it on port 3100 and needs a seeded test project |
| `npm run build` | Builds for production |
| `npm run seed:demo` | Loads demo teams, users and records (guarded; never run it on production) |
| `npm run create-admin` | Creates or resets an active `super_admin` |

A task is done only when lint, i18n:check, test and build all pass. Run e2e as well when routes or UI changed.

## Project map

| Path | Contents |
|---|---|
| `src/app/(auth)` | Login, MFA, and the forgot, reset and change password pages |
| `src/app/(crm)` | Shell, dashboard, objects, setup and planned-module pages |
| `src/app/api/crm/**` | Guarded CRM API (`crmGuard` → zod → RLS-scoped client) |
| `src/app/api/inbound/leads` | Signed website endpoint (service role) |
| `src/components/crm` | Layout, record page, list views, pipeline and shared components |
| `src/lib/crm` | Objects, repositories, permissions, server guards, inbound logic, roadmap |
| `supabase/migrations` | Schema, RLS, audit triggers and RPCs |
| `messages/{locale}` | UI copy per namespace |
| `tests/rls`, `e2e`, `**/__tests__` | Test suites |

Ownership and rules per area are in [AGENTS.md](AGENTS.md).

## v1 features

- Leads with a 24/48 h SLA, a status path, priorities and tags, plus a **Convert Lead** flow that creates or links an Account, Contact and Opportunity in one transaction.
- Accounts (linked to one or more group companies), Contacts and Opportunities, all on one config-driven record page. Each record page has highlights, a path, inline edit, related lists and an activity timeline.
- An opportunity list and a pipeline kanban (drag and drop plus a keyboard "Move to…" menu). A lost stage requires a loss reason. Amounts carry a currency.
- Activities (tasks, calls, meetings, notes) and **My tasks** (overdue, today, upcoming).
- List views (mine, all, recent) with filters, server-side sort and pagination, and CSV export.
- A home dashboard, global search (`⌘K`) and sidebar count badges.
- Record visibility (own, team or all) enforced by Postgres RLS. Scope is editable per role.
- **Setup:** users, roles, the access matrix, group companies, pipeline stages, picklists, lead assignment (round-robin or a default owner) and the audit log.
- Audit by database trigger on every object table and every config table.
- An inbound leads endpoint for the website (HMAC, dedupe, idempotency).
- Four UI languages and a responsive layout from 375 px. Optional TOTP MFA.

## To be done (planned modules)

Fourteen modules appear in the sidebar with a "Soon" badge and open a "To be done" page that describes their capabilities and dependencies: Products & Price Books, Quotes, Orders, Campaigns, Email, Reports & Dashboards, Forecasting, Cases, Automation, Approvals, AI Assistant, Integrations, Data Import and Duplicate Management.

They are driven by one registry: [`src/lib/crm/roadmap.ts`](src/lib/crm/roadmap.ts), with copy in `messages/*/roadmap.json`. **To promote a module:** replace `src/app/(crm)/<module>/page.tsx` (which renders `<PlannedModulePage id="…" />`) with the real module, then flip its `status` from `"planned"` to `"live"` in `roadmap.ts`.

## Docs

- [docs/SUPABASE.md](docs/SUPABASE.md): project setup, migrations, env, data model, the RLS policy table and testing
- [docs/SECURITY.md](docs/SECURITY.md): production security runbook and post-deploy checklist
- [docs/INBOUND-LEADS.md](docs/INBOUND-LEADS.md): website → CRM endpoint contract
- [plans/crm-foundation.md](plans/crm-foundation.md): plan of record and status

## Agent workflow

Work is coordinated by Claude Code agents (`.claude/agents/`): a planner, three area builders, an i18n agent, a reviewer and a security reviewer. Start with [CLAUDE.md](CLAUDE.md) (orchestration) and [AGENTS.md](AGENTS.md) (project map, area ownership and rules). New plans go in `plans/` from `plans/TEMPLATE.md`.
