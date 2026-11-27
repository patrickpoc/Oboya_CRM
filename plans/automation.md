# Automation module

- status: done (2026-11-27) · migrations applied, test:rls + test:e2e green
- requested: 2026-11-27 · by: Patrick Oliveira


## Context
`/automation` is a planned roadmap module (`src/lib/crm/roadmap.ts:142-150`) that still renders `PlannedModulePage`. The roadmap scope is:
- lead assignment rules by country, group company and round-robin;
- tasks created automatically when an opportunity enters a stage;
- alerts for stalled deals and overdue tasks;
- escalation to the manager when a lead misses its first-response SLA;
- every automated change written to the audit log.

User decisions:
1. Alerts are delivered through an **in-app bell**, not email.
2. Assignment rules apply **always to inbound leads**. They apply to CRM-created leads only when the user ticks **"Assign using rules"**.
3. On an SLA miss, the owner keeps the lead and their **manager gets a notification plus an urgent task**.
4. Logging a **call, email or meeting** on a `new` lead stamps `first_responded_at`.

Additional recommendations:
- `sales_manager` gets `automation:["view"]`. Admins can widen this in the matrix.
- Setup → Lead assignment stays where it is. It is embedded as the "Fallback" card in the Assignment tab, and the Setup page links to it.

## Architecture
The engine lives in **Postgres**, as security-definer functions plus triggers. This covers every write path: the stage RPC, the kanban, `crm_convert_lead`, imports and inbound. It is transactional and audited in one place.

**Attribution.** Automated writes are attributed through a transaction-local GUC `crm.actor='automation'`:
- It is set only by `crm_automation_begin(ctx)` and reset by `crm_automation_end(prev)`. Both are definer functions revoked from clients.
- Three shared functions read it. Copy their latest bodies verbatim and add only the new branch:
  - `crm_set_record_meta` (`20261116000300`): `created_by`/`updated_by` become null.
  - `crm_audit_trigger` (latest is `20261119010000:203`): `actor_id` becomes null, `actor_name` becomes `'Automation'`, and the new `context jsonb` column records `{kind, rule_id, template_id, triggered_by}` plus `rule_name`/`template_name` snapshots (accepted as low-sensitivity).
  - `crm_record_guard` (latest is `20261119010000`): skip only the owner-visibility check.
- Precedent: `crm.keep_probability` in `crm_change_opportunity_stage`.

**Scheduling.**
- pg_cron runs `crm_run_automation` every 15 minutes. The setup is guarded like `20261116000900:97-124` and emits a notice if pg_cron is unavailable.
- A daily Vercel cron at `/api/crm/automation/cron` is the fallback. It checks `CRON_SECRET` via `isCronAuthorized` and runs with the service role in `src/lib/crm/server/admin-only/automation-run.ts`.

## Database
Two migrations: `20261128000000_crm_automation.sql` and `20261128000100_crm_automation_cron.sql`. No `begin;`/`commit;`, and both are idempotent.

**Permissions**
- Grant `automation` through `crm_add_module_permissions` with `{super_admin: full, sales_manager: [view], sales_rep: none, read_only: none}`.
- Follow the update with a `do $$` assertion that raises if a system role is missing the cell. This avoids a repeat of the silent-swallow problem seen today.

**Config tables** (standard columns, meta and audit triggers):
- `crm_assignment_rules`: name, active, sort_order, `country_codes text[]`, `entity_ids uuid[]`, `sources text[]` (empty means any), `target_type` `user` | `round_robin`, `target_user_id`, `pool_user_ids uuid[]` (≤50), `stop_processing`, `notify_assignee`.
- `crm_assignment_cursors`: `rule_id` primary key, `last_user_id`. No client access and no audit.
- `crm_stage_task_templates`: `stage_id`, `pipeline_id`, subject, description, `due_in_days` (0–365), priority, `assignee_type` `owner` | `owner_manager` | `user`, `assignee_user_id`, active, sort_order.
- `crm_alert_rules`: `kind` `stalled_deal` | `overdue_task` | `sla_escalation`, optional pipeline and stage override, `threshold` (stalled days or overdue grace hours), `notify_manager`, active. Seeded with: stalled 14 days, overdue grace 0 h, SLA on.

**Private and log tables**
- `crm_notifications`: user_id, kind (`sla_escalation | stalled_deal | overdue_task | task_assigned | lead_assigned`), `params jsonb` (≤4 KB), object, record_id, `dedupe_key unique`, `read_at`. RLS lets users see only their own rows. Clients have `grant update(read_at)` only; inserts come only from definer functions.
- `crm_automation_runs`: trigger source, status `ok | partial | failed | skipped`, counts, errors (≤20).

**Other schema changes**
- New column `crm_opportunities.stage_entered_at`, maintained by a BEFORE trigger and backfilled from the last `stage_change` audit row, falling back to `created_at`.
- Add an activities index on `(what_object, what_id, created_at desc)`.
- In the audit select policy (`20261119030000:7`), map the new config objects to `automation.view`.

**Functions** (definer, pinned `search_path`)
- **Helpers:**
  - `crm_user_manager(user)`.
  - `crm_escalation_target(user)`: the manager, then the active default owner, then the oldest super_admin.
  - `crm_assign_fallback_owner()`: the current body of `crm_assign_inbound_owner`, which stays as a compatibility wrapper.
- **`crm_assign_lead_owner(country, entity, source)`** returns `(owner_id, rule_id, via)`. Internal only.
  1. Evaluate active rules ordered by sort_order. A non-empty criterion must contain the lead's value. Countries compare case-insensitively; null never matches a non-empty criterion.
  2. For a `user` target, the user must be active and have `can_write`.
  3. For a `round_robin` target, lock the cursor `FOR UPDATE` and take the next eligible pool member, wrapping around.
  4. If a rule matches but has no assignee: with `stop_processing`, fall back; otherwise try the next rule.
  5. If nothing matches, use the fallback.
- **`crm_assignment_preview(...)`**: the same matching without moving the cursor. Requires `automation.view`.
- **Inbound:** a BEFORE INSERT trigger on `crm_leads` fires for a privileged session with a null owner. It assigns the owner and notifies with `lead_assigned`. The inbound route (`src/app/api/inbound/leads/route.ts:180`) stops calling `crm_assign_inbound_owner` and stops sending `owner_id`.
- **`crm_apply_assignment_rules(lead_id)`**, granted to authenticated, used for manual opt-in and "Reassign using rules":
  - It requires an active user, `can_write`, `leads.edit`, a visible lead that is neither converted nor deleted, and passes `crm_rate_limit_hit('automation.assign', 30, 60)` (the bucket regex forbids `:`; the run route uses `automation.run`, previews `automation.preview`).
  - It writes the change inside begin/end, producing an `owner_change` audit row by Automation with `triggered_by`.
- **Stage tasks:** an AFTER INSERT OR UPDATE OF `stage_id` trigger on opportunities, which also catches convert.
  - Each active template on the new stage creates a task (`what=opportunity`, `due=now+due_in_days`, `meta.automation`).
  - `external_ref` is `automation:stage:<tpl>:<opp>:<epoch(stage_entered_at)>` with `on conflict do nothing`. Re-entering the stage creates a new task; replaying the same move does not.
  - The assignee is notified with `task_assigned` when they are not the person who moved the deal.
- **First response:** an AFTER INSERT OR UPDATE OF `status` trigger on activities.
  - It fires for `what_object='lead'` when the activity is a call or meeting marked done, or an outbound email (verify the direction key in `src/lib/crm/email`).
  - It sets `first_responded_at` on a `new` lead that has none.
- **`crm_run_automation(now, trigger, actor)`**: service role only.
  - It takes an advisory lock; a busy lock records `skipped`.
  - Each section runs in its own `exception` block. A failing section marks the run `partial`.
  - Each kind is capped at 500 items per run.
  - **Stalled deals:** open opportunities whose `greatest(stage_entered_at, last activity)` is older than the most specific threshold. Notify the owner, plus the manager if `notify_manager`. Dedupe key: `stalled:<opp>:<user>:<epoch(last_touch)>`.
  - **Overdue tasks:** open tasks with `due_at < now - grace`. Dedupe key: `overdue:<task>:<epoch(due_at)>`.
  - **SLA:** new, unresponded leads older than `lead_sla_hours.overdue`. Create an urgent task for the escalation target (`external_ref automation:sla:<lead>`). Only when that insert succeeds, send the notification with dedupe key `sla:<lead>`.
  - **Retention:** delete notifications read more than 90 days ago and runs older than 90 days.
- **Reordering:** `crm_reorder_assignment_rules(ids)` and `crm_reorder_stage_task_templates(ids)`, following the `crm_reorder_picklist` pattern and requiring `automation.edit`.

## App, API and UI
- **Contracts first:**
  - `src/lib/crm/automation/{schemas,matching,due,types}.ts`. `matching.ts` is a pure TypeScript mirror used for preview and tests.
  - `src/lib/crm/notifications/{kinds,schemas}.ts`, mapping each kind to its i18n key, icon and href.
  - Add `automation` to `CRM_MODULES`, its defaults and the permissions test (asserted against the migration's `$json$` block).
  - Add an `AGENTS.md` row for Automation & notifications.
- **Routes** (`crmGuard`, then zod, then `dbErrorResponse`, user client only):
  - `/api/crm/automation/assignment-rules` with `[id]`, `reorder` and `preview`;
  - `stage-tasks` with `[id]` and `reorder`;
  - `alert-rules` with `[id]`;
  - `runs`;
  - `run`: POST, requires `automation.edit`, rate-limited;
  - `cron`;
  - `/api/crm/leads/[id]/assign`: requires `leads.edit`;
  - `/api/crm/notifications` (cursor-paginated, limit ≤50) and `notifications/read` (`{ids≤100}` or `{all}`);
  - `nav-counts` gains `notificationsUnread`;
  - `vercel.json` gets a second cron.
- **`/automation`** (`requireCrmAuth` and `automation.view`), with tabs selected by `?tab=`:
  - **Assignment:** a SortableList of rules with criteria chips. Editing happens in a FormDrawer with country, company and source pickers, a target selector and a pool picker, plus a live preview showing who would receive the lead. The embedded `LeadAssignmentSetup` appears as the Fallback card.
  - **Stage tasks:** choose a pipeline, then the stages, then templates per stage.
  - **Alerts & SLA:** global thresholds, per-pipeline or per-stage overrides, and the SLA toggle. The SLA hours are shown read-only with a link to where they are set.
  - **Runs:** DataTable of runs plus "Run now".
- **Bell** (`src/components/crm/notifications/NotificationBell.tsx`, in `CrmTopbar`):
  - the unread badge comes from nav-counts;
  - a popover, which becomes a full-width sheet below `sm`, with mark-read and mark-all-read;
  - links go to the record;
  - count changes are announced through `aria-live`.
- **Leads:**
  - An "Assign using rules" checkbox in the lead create drawer (`RecordFormDrawer`). After the record is created it calls `leads/[id]/assign`. On failure, a toast says the lead stays with its current owner.
  - A "Reassign using rules" action with a confirm dialog that shows the preview.
- **Timeline and audit:** an "Automated" badge on automated tasks. The audit log shows the actor "Automation" with the rule or template name.
- **Shell:**
  - in `roadmap.ts`, set automation to `status:"live"` and `module:"automation"`;
  - add the Setup matrix label;
  - add a banner on Setup → Lead assignment;
  - add docs in `docs/SUPABASE.md` covering both schedulers, `cron.job` and the "Automation" actor.
- **i18n:** the `automation` and `notifications` namespaces, pre-registered by the orchestrator. Builders write `en` and mirror it.

## Tasks
| # | Agent | Work | Parallel |
|---|---|---|---|
| 0 | builder-crm-data | Contracts, module, `AGENTS.md` row | first |
| 1 | builder-crm-data | Both migrations, plus the PGlite harness (all migrations, twice); APIs, runner, cron, inbound change, nav-counts, vercel.json, docs, permissions test, RLS tests | after 0 |
| 2 | builder-crm-objects | `matching.ts` and `due.ts` with vitest; "Assign using rules" and "Reassign"; the `leads/[id]/assign` route; timeline badge | after 0 |
| 3 | builder-crm-ui | `/automation` tabs, bell and topbar, roadmap, audit actor display, Setup banner and embed; e2e | after 0 (e2e after 1 and 2) |
| 4 | orchestrator | Apply via the pooler: dry run first, then confirm the module assertion and `cron.job` | after 1 + security review |
| 5 | i18n | Mirror pt-BR, es and zh-CN | after 1–3 |
| 6 | reviewer + security-reviewer | See focus list below; at most 2 fix loops | last |

Security review focus for task 6:
- the GUC cannot be forged and is reset after use;
- the checks inside `crm_apply_assignment_rules`;
- grants on notifications;
- the runner is callable by the service role only;
- the copied trigger bodies are identical to the originals.

## Verification
- **Vitest:**
  - rule matching: empty criteria, case, null values, stop_processing, order;
  - due dates;
  - the notification kinds map matches `en/notifications.json`;
  - schemas;
  - permission defaults.
- **PGlite**, all migrations applied twice:
  - **Assignment:** order and cursor wrap, inactive members skipped, fallback used.
  - **Inbound insert:** gets an owner and is audited as "Automation" with context. The GUC is reset afterwards, so a later user write is still attributed to the user.
  - **Stage tasks:** moving via the stage RPC, the kanban or convert creates the task once, and a replay creates none.
  - **First response:** a call or meeting marked done stamps it; a note or an inbound email does not.
  - **Run idempotency:** running twice gives the same counts and creates no new notifications or SLA tasks the second time.
  - **Stall re-arm:** a stalled deal alerts again only after new activity followed by another threshold period.
- **RLS:**
  - notifications are private and clients cannot insert them;
  - reps and read_only cannot write rules; a manager can view but not edit;
  - the assign RPC fails without `leads.edit`, on an invisible lead and on a converted lead;
  - authenticated users cannot call the runner, `crm_assign_lead_owner` or `crm_automation_begin`;
  - automation rows have `actor_name 'Automation'` and a null `actor_id`.
- **e2e:**
  1. An admin creates a "Qualification" task template.
  2. A rep moves an opportunity into that stage.
  3. The task appears with the "Automated" badge, and the bell count goes up.
  4. Mark read and mark all.
  5. Repeat at 375px.
- **Gate:** `npm run lint && npm run i18n:check && npm test && npm run build && npm run test:e2e && npm run test:rls`, plus a manual check of `/automation` and the bell on the dev server.

## Risks
- **Regressions in shared triggers.** Redefining meta, audit and guard could break existing paths. Mitigated by copying their bodies verbatim and running the PGlite regression cases.
- **No pg_cron available.** Escalations would then run only daily. Check `pg_extension` before shipping and show "Last run" in Runs.
- **Broad inbound trigger.** It covers any privileged insert without an owner (imports, scripts). This is intended and documented.
- **Convert fires first-stage templates.** Converting a lead triggers the templates on the first open stage. This is intended.
- **Notification volume.** Bounded by per-episode dedupe keys and the 500-items-per-kind cap.
