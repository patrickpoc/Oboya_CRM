# Reports & Dashboards (+ editable Home widgets)

- status: done (2026-11-27) · migrations applied, test:rls + test:e2e green
- requested: 2026-11-27 · by: Patrick Oliveira


## Context
"Reports & Dashboards" is still a planned roadmap module that renders `PlannedModulePage`. The user wants it built to its roadmap scope:
- a report builder over the CRM objects, with columns, filters, row and column grouping, and sum, avg and count;
- bar, line, funnel and donut charts in brand colours;
- private, team and public folders;
- dashboards per team built from saved reports;
- CSV export that respects the viewer's visibility.

The user's decisions:
1. Only **Sales Managers and Admins** publish to a team or to everyone. Reps keep private reports.
2. **Objects in v1:** leads, accounts, contacts, opportunities and activities. Cases come later.
3. **Home becomes an editable widget grid**, and a team dashboard can be pinned to it.

Results are always computed with the viewer's Supabase client, so sharing a report never shares records.

## Architecture
- **Aggregation in TypeScript on the server.** A pure engine reads rows through the existing `baseQuery`/`fetchRows` in `src/lib/crm/repositories/object-repository.ts`, using the user-scoped client, so RLS applies automatically.
  - Reused: `parseListQuery` whitelists and value parsing from `src/lib/crm/objects/query.ts`, the virtual-field filters, the FX helpers in `src/lib/crm/dashboard/aggregate.ts` (`sumByCurrency`, `parseFxTable`, `convertTotals`), the timezone helpers in `time.ts` (`safeTimeZone`, `zonedMidnight`), the label lookups in `lookups.ts`, and `csvCell`/`toCsv` from `src/lib/crm/csv.ts`.
  - No dynamic SQL. The scan is capped at 20k rows, with a "truncated" notice.
  - The engine reads through a `ReportSource` interface, so an RPC can replace it later.
- **Permission module `reports`** (actions view, create, edit, delete, export). Running a report also requires `view` on the object's module; exporting also requires `export` on it.
- **Single publish rule**, `crm_can_publish(vis, team)`, mirrored by `canPublish()` in TypeScript:
  - `private` is allowed for everyone;
  - `team` is allowed for admins and for the manager of that team;
  - `public` is allowed for admins and for users who manage at least one team (sales managers).

## Database: `supabase/migrations/20261127000000_crm_reports.sql`
No `begin;`/`commit;` in the file. It is idempotent: `if not exists` and `drop policy if exists`.

- **Permissions:** `update crm_access_control set matrix = crm_add_module_permissions(matrix,'reports',$json${super_admin:full, sales_manager:full, sales_rep:[view,create,edit,delete,export], read_only:[view,export]}$json$) where id;`. This is incremental and never overwrites custom roles.
- **Helpers** (security definer, stable, `search_path` pinned): `crm_in_team(team)`, `crm_can_read_shared(owner, vis, team)` and `crm_can_publish(vis, team)`.
- **Common columns on every new table:** owner, created/updated by and at, soft-delete columns. Triggers: `crm_set_record_meta()` and `crm_audit_trigger(...)`.
- **Tables:**
  - `crm_report_folders`: name, visibility, team_id. Check: `team` visibility requires a team.
  - `crm_reports`: folder_id (nullable; no folder means private), name, description, object (enum of the 5), definition jsonb (≤32 KB), schema_version. **A report inherits its folder's visibility.**
  - `crm_dashboards`: name, description, visibility, team_id, widgets jsonb (≤20 widgets of `{id, reportId, chartOverride?, size sm|md|lg, position}`).
  - `crm_home_layouts`: scope `default` | `team` | `user`, team_id or user_id, widgets jsonb (≤24), unique per scope target.
- **Policies:**
  - Folders and dashboards: read if owner, admin, public, or team member/manager. Insert and update require owner or admin plus `crm_has_permission` plus `crm_can_publish`. Delete is soft.
  - Reports: readable by the owner, an admin, or anyone who can read the report's folder. Only the folder owner or an admin can file reports into a folder.
  - Home layouts: everyone reads the default, their own team's layout and their own layout. Admins write the default; admins or the team's manager write the team layout; the user writes their own.

## Contracts (fixed first): `src/lib/crm/reports/definition.ts`
- **`ReportDefinitionSchema`** (zod):
  - `version`, `object` (5), `type` tabular | summary | matrix;
  - `columns` (≤20), `filters` (same strings as list URLs), `q`, `scope` mine | all;
  - `rowGroups` (≤2 of `{field, bucket?: day|week|month|quarter|year}`), `columnGroup?`;
  - `aggregates` (≤6 of count | sum | avg | min | max on number, currency or percent);
  - `sort`, `limit` (≤2000);
  - `chart {type: none|bar|line|funnel|donut, metric, stacked?}`.
- **`validateDefinition(def, RecordConfig)`** checks:
  - fields exist;
  - buckets only on date fields;
  - aggregate functions match field types;
  - matrix reports have 1 row group plus a column group;
  - funnel and donut charts have one dimension.
- **Other types in the same file:**
  - `ReportResult`: columns; rows (tabular); groups/colKeys/cells (grouped); totals; `currency {base, missing}`; `truncated?`; timeZone.
  - Zod schemas for `DashboardWidget` and `HomeWidget`. A Home widget is `{id, kind: 'builtin'|'report'|'dashboard', ref, size, position}`.

## Engine (`src/lib/crm/reports/`)
- `source.ts` (server): `scanRows(client, config, query, select, cap)` uses chunks of 1000 rows, up to 4 in parallel, with an exact count on the first chunk.
- `buckets.ts`: buckets in the viewer's timezone (ISO week, `YYYY-Qn`).
- `engine.ts`: pure grouping and aggregation.
  - Multi-value fields count once per value; the UI labels this.
  - Currency values are converted to the FX base, and missing rates are reported.
- `labels.ts`: labels for picklists, stages, owners, entities and booleans. Lookups the viewer cannot see show "(restricted)".
- `csv.ts`: rows or the flattened grouped table, keeping the injection guard.
- `repository.ts` and `sharing.ts`: CRUD for folders, reports, dashboards and home layouts, plus `canPublish`.
- **Small, opt-in changes to `object-repository.ts`:**
  - export `attachDisplay` and `attachVirtual`;
  - add optional `select` and `timeZone` parameters to `baseQuery`.

## API (`src/app/api/crm/reports/**`, plus `src/app/api/crm/home/layout`)
Every handler calls `crmGuard("reports", action)` (Home layout uses the `home` module), then zod, then `jsonError`/`dbErrorResponse`, and uses only the user client.
- **Folders:** list and CRUD.
- **Reports:** list and CRUD.
- **Run:** `POST run` (preview of an unsaved definition, with `tz`) and `GET [id]/run`.
- **Export:** `[id]/export?mode=rows|grouped`, capped at 5000 rows.
- **Dashboards:** CRUD, plus `dashboards/[id]/data`, which runs at most 3 widgets at a time. A widget that fails or is forbidden returns its own error without breaking the others or leaking its name.
- **Home layout:** `GET`/`PUT home/layout?scope=user|team|default`. The resolved layout is user, then team, then default.

## UI
- **`/reports`:** tabs for Reports and Dashboards, a folder sidebar (a select on mobile), search, and DataTable. FormDrawer is used for folders and dashboards; the visibility options shown depend on `canPublish`.
- **`/reports/new` and `/reports/[id]/edit`:** the `ReportBuilder`, with a configuration panel on the left and a live preview on the right (debounced 600 ms, stacked below `md`).
  - The panel contains: object picker, column picker (with up and down buttons), filters (reusing FilterSelect and DateRangeFilter), grouping, aggregates, chart, and save dialog (name, folder).
- **`/reports/[id]`:** chart, `ReportTable` (summary groups collapse, matrix keeps a sticky first column), notices (truncation, missing FX rate), CSV export and edit.
- **`/reports/dashboards/[id]`:** a responsive grid (sm = 1 column, md = 2 columns, lg = full width) and an edit mode.
  - Edit mode can add a widget from saved reports, reorder (buttons plus Alt+Arrow, announced via `aria-live`, no new dependency), and resize.
- **`src/components/crm/dashboard/ReportChart.tsx`:**
  - multi-series bar (stacked for matrix), line, funnel (`FunnelChart`) and donut (`PieChart` with `innerRadius`);
  - brand palette in order: blue, green, blue-light, green-light, orange, yellow-dark, blue-dark, yellow-light, with "Other" beyond 8 series;
  - an sr-only table (the `PipelineChart` model) inside the `ChartCard` shell.
- **Editable Home:**
  - Refactor `DashboardHome.tsx` into a widget registry `src/lib/crm/home/widgets.ts` with built-ins: the 4 KPIs, pipeline chart, my tasks, recent records and quick access. Each built-in declares a permission and default size.
  - Add `report:<id>` and `dashboard:<id>` widgets. Dashboard widgets render that dashboard's widgets inline, which is the "pinned dashboard".
  - An "Edit home" mode lets you add, remove, reorder and resize, then save:
    - as **My home** (any user);
    - as **Team home** (team managers and admins);
    - as **Default** (admins).
  - "Reset to team default" removes the user layout.
  - The current KPI data (`/api/crm/dashboard`) is reused as is.
- **Shell:** in `roadmap.ts`, set reports to `status:"live"` and `module:"reports"`. The quick link at `DashboardHome.tsx:108` becomes permission-gated. Add a `reports` label to the Setup matrix.

## Files
- **New:**
  - the migration above;
  - `src/lib/crm/reports/*`, `src/lib/crm/home/*`, with their `__tests__`;
  - the API routes above;
  - `src/app/(crm)/reports/**`;
  - `src/components/crm/reports/*`, `src/components/crm/home/*`, `ReportChart.tsx`;
  - `messages/*/reports.json` and `messages/*/home.json`;
  - `tests/rls/reports.test.ts`, `e2e/reports.spec.ts`.
- **Modified:**
  - `src/lib/crm/types.ts` (`CRM_MODULES` gains `reports`);
  - `permissions/defaults.ts`, plus `__tests__/permissions.test.ts` (compare with reports omitted against the cases seed, and assert the reports defaults against the new migration's `$json$` block);
  - `object-repository.ts` (opt-in parameters);
  - `roadmap.ts`, `DashboardHome.tsx`, `src/app/(crm)/dashboard/page.tsx`;
  - `messages/*/{index.ts,setup.json,roadmap.json}`;
  - `AGENTS.md` (new "reports/home" row in the area table).

## Tasks
| # | Agent | Work | Parallel |
|---|---|---|---|
| 0 | builder-crm-objects | Contracts: `definition.ts`, widget schemas, `CRM_MODULES`, API shapes | no (first) |
| 1 | builder-crm-data | Migration, permissions + test, `repository.ts`/`sharing.ts`, all reports and home-layout APIs, RLS tests | yes, after 0 |
| 2 | builder-crm-objects | Engine (source, buckets, labels, csv) + vitest, `ReportBuilder`, `ReportTable`, `ReportView`, builder pages | yes, after 0 |
| 3 | builder-crm-ui | `ReportChart`, Reports home and folders, dashboard view and editor, editable Home with widget registry, roadmap and nav, e2e | yes, after 0 (e2e after 1 and 2) |
| 4 | — | Apply the migration via the pooler (`SUPABASE_POOLER_URL`), with a dry run first | after 1 |
| 5 | i18n | Mirror `reports`, `home`, `setup` and `roadmap` keys to pt-BR, es and zh-CN | after 1–3 |
| 6 | reviewer + security-reviewer | Policies, `crm_can_publish`, export checks, CSV injection, no service role, limits. At most 2 fix loops | last |

## Verification
- **Vitest:**
  - schema refinements;
  - buckets in São Paulo and Shanghai around midnight and DST, plus ISO week and quarter;
  - summary with 2 levels and matrix totals;
  - avg, min and max;
  - FX with a missing rate;
  - truncation;
  - labels, including a restricted lookup;
  - CSV formula guard;
  - Home layout resolution (user, then team, then default);
  - the permissions test.
- **RLS** (`npm run test:rls`, live project):
  - a private folder of Lucas is invisible to the others;
  - a team folder of Ricardo's team is read by Lucas, Camila and Ricardo, not by Pieter;
  - a public dashboard is readable by everyone and writable only by the owner or an admin;
  - a rep cannot publish to the team or publicly;
  - a rep cannot file a report into another person's folder;
  - read_only cannot write;
  - the same shared report returns different counts for Lucas, Ricardo and Pieter;
  - home layout permissions per scope.
- **e2e:**
  1. A manager builds an opportunity report grouped by stage with a bar chart.
  2. They save it to a team folder and create a dashboard with that widget.
  3. They pin it on the Team home.
  4. A rep on that team sees it on Home.
  5. Repeat at 375 px.
- **Gate:** `npm run lint && npm run i18n:check && npm test && npm run build && npm run test:e2e && npm run test:rls`. Then `/reports` and `/dashboard` are checked by hand on the dev server.

## Risks
- **Scale:** the 20k-row cap is a guarded limit and RPCs can replace the source later.
- **Stale field keys:** a saved definition with an outdated field shows an "invalid field" state instead of crashing.
- **Datetime filters:** in reports they follow the viewer's timezone; list views stay on UTC days. This is documented.
