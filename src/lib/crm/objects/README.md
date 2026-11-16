# CRM object framework

One config per object drives the list page, record page, generic API, CSV and validation.

## Pieces
- `types.ts`: `RecordConfig`, `FieldConfig`, `OBJECT_META` (table, name column and route per object).
- `schema.ts`: `buildSchema(config, "create" | "update")` (zod generated from the fields; unknown keys are stripped).
- `query.ts`: `parseListQuery` (sort and filter keys are whitelisted from the config), search escaping, `listParamsKey`.
- `registry.ts`: `getRecordConfig(name)`. It is client-safe; client components resolve configs by name.
- `../repositories/object-repository.ts`: `list/get/create/update/softDelete/markViewed/related/exportCsv`. Always use the user-scoped client.
- `../repositories/lookups.ts`: picklists, users, entities, stages and the lead SLA hours (React `cache`). `virtual-fields.ts` holds handlers for non-column fields. `chunk.ts` splits `.in("id", ids)` lookups into 200-id chunks (URL length).
- `record-access.ts`: `recordAccess(config, row, can)` (module permissions AND `config.readOnly`).
- API: `/api/crm/objects/[object]` (GET list, POST), `/[id]` (GET, PATCH, DELETE = `crm_soft_delete`), `/export` (permission `export`).
- UI: `components/crm/list/ObjectListView`, `components/crm/record/{RecordPage,RecordView,RecordPath,FieldValue,FieldInput,RecordFormDrawer}`.

## Add an object (e.g. `contact`)
1. Create `lib/crm/objects/contact.ts` exporting a `RecordConfig`. Use the real columns from `supabase/migrations/*_crm_objects.sql`.
   - `namespace`: the messages file (`messages/en/contacts.json`). Every `labelKey` and static option `labelKey` is relative to it. Also add `title` and `singular`.
   - `nameFields`: the columns that make the display name. Use generated `full_name` when there is one.
   - Field flags: `listable`, `sortable`, `filterable` and `searchable` (ilike). `editable: false` marks read-only columns such as `created_at`. `required` makes create require the field and update reject null.
   - Picklists: `{ kind: "static", options }` for DB check enums, or `{ kind: "picklist", picklist: "lead_source" }` for `crm_picklist_values`.
   - `lookup: "account"` for FKs. The label is resolved server-side into `row._display[key]`.
   - `owner_id` is `type: "owner"`. Entity is `type: "entity"`, or `multiple: true, virtual: true` for link tables.
   - Field keys must not be `view`, `q`, `sort`, `dir`, `page` or `pageSize`.
   - `path`: `{ field: "status", source: "static" }` (uses the field's static options) or `{ field: "stage_id", source: "stages" }`.
   - `relatedLists`: `{ key, object, foreignKey, columns, labelKey, where? }`. Use `where` for polymorphic parents (`what_object`). For "View all" to work, the foreign key field must be `filterable` in the child config.
2. Register it in `registry.ts` (one line).
3. Pages (always call `requireCrmAuth()`):
   - list: copy `app/(crm)/accounts/page.tsx` (server loads the first page and lookups, then `<ObjectListView object=… />`).
   - detail: `<RecordPage object="contact" id={id} />`. It checks `can(module,"view")`, returns a 404 when RLS hides the record, and calls `markViewed`. Build slots from the loaded record with `slots={({ record, lookups }) => ({ actionSlot, pathSlot })}` instead of reading the record again.
   - `readOnly: (row) => boolean` locks a record in the UI (inline edits, path, edit/change-owner/delete actions), e.g. converted leads. The server must enforce the same rule.
4. Add copy to `messages/en/<namespace>.json` and register the namespace in `messages/*/index.ts`.
5. Tests: `__tests__/` for any custom logic (schema edge cases, handlers).

## Extending without forking
- Custom header buttons (for example Convert lead): pass `actionSlot={<ConvertLeadButton …/>}` to `RecordPage`. It must be a client component. After it changes data, call `router.refresh()`.
- Custom path behaviour (for example a Closed Lost reason): pass `pathSlot`, using `RecordPath` with your own `onStageChange`.
- Values stored outside the table: add a `VirtualFieldHandler` (`load`, `save`, optional `filter` embed) in `repositories/virtual-fields.ts` under `"<object>.<key>"`. Computed values read the loaded `rows` (declare the columns in `columns`) instead of re-querying; `createWith` makes a create atomic (account + entity links via `crm_create_account`).
- Object-specific routes (`/api/crm/leads/[id]/convert`, `/api/crm/leads/[id]/status`, `/api/crm/opportunities/[id]/stage` → `crm_change_opportunity_stage`) live next to the generic API. They follow the same order: `crmGuard` → zod → repository → `mapDbError`.
- Activity timeline: `components/crm/activities/ActivityTimelineSlot.tsx` (`{object, recordId, refreshKey}`) renders `ActivityTimeline` (composer, upcoming/overdue, past activities + audit events from `/api/crm/activities/timeline`). `refreshKey` is the record's `updated_at`, so any save, path or stage change refetches it. Lead status changes are `stage_change` audit events (`lib/crm/activities/audit.ts`).

## Rules
- Never import the service-role client here. Writes go through the API with the user's JWT, so RLS, the row guard and the audit triggers apply.
- Delete is only `crm_soft_delete` (via DELETE). Restore is admin-only (`crm_restore`).
- Errors reach the UI as `{error, code}`: 403 `forbidden`, 409 `duplicate`, 422 rule codes (`lead_converted`, `reason_required`, `loss_reason_required`, `stage_unavailable`, `one_primary_required`; `RULE_CODES` in `errors.ts`) or generic `rule`, 400 `invalid` (+`fields`), 404 `not_found`. The UI shows `record.errors.rules.<code>` and never server text.
