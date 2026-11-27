<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:oboya-brand-palette -->
# Oboya Brand Palette

Canonical tokens live in `src/styles/tokens.css` (ported unchanged from Oboya_Website).

| Name | HEX | CSS token |
|------|-----|-----------|
| Orange Red | `#ea5744` | `--oboya-orange` |
| Main Blue | `#004F7C` | `--oboya-blue` |
| Light Blue | `#009CD4` | `--oboya-blue-light` |
| Main Green | `#4DAF4E` | `--oboya-green` |
| Light Green | `#75C566` | `--oboya-green-light` |
| Dark Blue | `#01203F` | `--oboya-blue-dark` |
| Light Yellow | `#DBE64C` | `--oboya-yellow-light` |
| Dark Yellow | `#909B03` | `--oboya-yellow-dark` |
| Soft White | `#F1F5F1` | `--oboya-soft-white` |

Brand tokens only. Do not invent off-brand colors.
<!-- END:oboya-brand-palette -->

# Oboya CRM

Internal CRM for the Oboya group (`crm.oboya-horticulture.com`). Same product family as the Oboya_Website admin (shell, tokens, component patterns); Salesforce Sales Cloud object model. Plan of record: `plans/crm-foundation.md`.

# i18n

UI copy lives in `messages/{locale}/{namespace}.json` for `en`, `pt-BR`, `es`, `zh-CN`; `messages/{locale}/index.ts` assembles them. Same keys and ICU placeholders in all four locales; run `npm run i18n:check`. URLs have no locale prefix (locale is per user / cookie, as in the reference admin).

# Project map

Next.js 16 (App Router) · React 19 · next-intl · Supabase (Auth + Postgres + RLS) · Tailwind 4 · shadcn/base-ui · Vercel.

| Area | Paths | Owner agent |
|------|-------|-------------|
| CRM UI & shell | `src/components/ui`, `src/constants`, `src/contexts`, `src/i18n`, `src/components/crm/{layout,common,data-table,forms,dashboard,permissions,search}`, `src/styles`, `src/fonts`, `src/lib/fonts.ts`, `src/lib/crm/{navigation,roadmap}.ts`, `src/app/(crm)/dashboard`, planned-module routes | `builder-crm-ui` |
| CRM objects | `src/components/crm/{record,list,pipeline,activities}`, `src/lib/crm/{objects,repositories,leads,opportunities,activities}`, `src/app/(crm)/{leads,accounts,contacts,opportunities,activities,tasks}`, `src/app/api/crm/{leads,accounts,contacts,opportunities,activities}` | `builder-crm-objects` |
| Data, auth, setup, inbound | `supabase/**`, `src/lib/supabase`, `src/lib/crm/{server,permissions,inbound,setup}`, `src/app/(auth)`, `src/app/(crm)/setup`, `src/app/api/crm/{users,roles,access-control,stages,picklists,entities,settings,audit-logs,me}`, `src/app/api/inbound`, `src/proxy.ts`, `scripts/seed-*`, `scripts/create-admin-user.mjs` | `builder-crm-data` (always triggers `security-reviewer`) |
| Reports & Home | `src/lib/crm/{reports,home}`, `src/components/crm/{reports,home}`, `src/app/(crm)/reports`, `src/app/api/crm/{reports,home}` | `builder-crm-data` (migration, API, repository, sharing), `builder-crm-objects` (engine, builder), `builder-crm-ui` (charts, dashboards, Home) |
| Automation & notifications | `src/lib/crm/{automation,notifications}`, `src/components/crm/{automation,notifications}`, `src/app/(crm)/automation`, `src/app/api/crm/{automation,notifications}`, `src/app/api/crm/leads/[id]/assign` | `builder-crm-data` (migrations, APIs, runner, cron, inbound), `builder-crm-objects` (matching, due, lead assign UI, timeline badge), `builder-crm-ui` (`/automation` tabs, bell, shell) |
| Translations | `messages/{pt-BR,es,zh-CN}/*.json` | `i18n` (only agent allowed to edit non-`en` files) |
| Tests | `**/__tests__`, `tests/rls`, `e2e` | the builder owning the code under test |

# Commands

- `npm run lint` · `npm run i18n:check` · `npm test` (vitest) · `npm run build` · `npm run test:e2e` (Playwright smoke) · `npm run test:rls` (needs a Supabase test project, see `docs/SUPABASE.md`)
- `npm run seed:demo` · `npm run create-admin`
- A task is done only when lint + i18n:check + test + build pass (e2e when routes or UI changed).

# Rules for every agent

1. Stay inside the paths of your area. Touching another area = stop and report.
2. Builders edit **only** `messages/en/<namespace>.json`. The `i18n` agent mirrors keys at the end.
3. Colors: brand tokens only (`oboya-*`).
4. No new dependency without stating why in the report.
5. Never read or print `.env*`. Never prefix server secrets with `NEXT_PUBLIC_`.
6. Supabase: schema changes only via a new file in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`, 14-digit version so `supabase db push` accepts several per day), never edit applied migrations. RLS on for every table. Every object table has `owner_id, created_by, created_at, updated_at, deleted_at` (soft delete).
7. **Data access goes through the user-scoped Supabase client so RLS decides visibility.** The service-role client (`src/lib/supabase/admin.ts`) is allowed only in `src/lib/crm/server/admin-only/**`, `src/app/api/inbound/**`, `scripts/`, `tests/` and `e2e/` (enforced by ESLint `no-restricted-imports`).
8. Every page calls `requireCrmAuth()`; every `/api/crm/**` handler calls `crmGuard(module, action)` then validates input with zod. Audit is written by DB triggers — do not write `crm_audit_logs` from the app.
9. Reuse before writing: if the Oboya_Website admin (`../_ref_oboya_website`, read-only) has the pattern, port it.
10. Responsive from 375px.
11. Final report in ≤5 lines: what changed, files, checks run, open risks.
