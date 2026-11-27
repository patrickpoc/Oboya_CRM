// Hard-deletes everything the smoke run created (service role): leads whose
// email is e2e-*@example.com, the account / contact / opportunity they were
// converted into, activities attached to any of them, and their audit rows.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../tests/support/env";

export const E2E_EMAIL_PREFIX = "e2e-";

export default async function globalTeardown() {
  const db = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  await cleanupReports(db);
  await cleanupAutomation(db);

  const { data: leads, error } = await db
    .from("crm_leads")
    .select("id, converted_account_id, converted_contact_id, converted_opportunity_id")
    .like("email", `${E2E_EMAIL_PREFIX}%@example.com`);
  if (error) throw new Error(`e2e teardown: ${error.message}`);
  if (!leads?.length) return;

  const ids = (key: "id" | "converted_account_id" | "converted_contact_id" | "converted_opportunity_id") =>
    leads.map((lead) => lead[key] as string | null).filter((id): id is string => Boolean(id));
  const leadIds = ids("id");
  const accountIds = ids("converted_account_id");
  const contactIds = ids("converted_contact_id");
  const opportunityIds = ids("converted_opportunity_id");
  const all = [...leadIds, ...accountIds, ...contactIds, ...opportunityIds];

  const errors: string[] = [];
  const run = async (label: string, promise: PromiseLike<{ error: { message: string } | null }>) => {
    const result = await promise;
    if (result.error) errors.push(`${label}: ${result.error.message}`);
  };

  const { data: activities } = await db
    .from("crm_activities")
    .select("id")
    .or(`what_id.in.(${all.join(",")})${contactIds.length ? `,who_contact_id.in.(${contactIds.join(",")})` : ""}`);
  const activityIds = (activities ?? []).map((row: { id: string }) => row.id);

  if (activityIds.length) await run("activities", db.from("crm_activities").delete().in("id", activityIds));
  await run("leads", db.from("crm_leads").delete().in("id", leadIds));
  if (opportunityIds.length) await run("opportunities", db.from("crm_opportunities").delete().in("id", opportunityIds));
  if (contactIds.length) await run("contacts", db.from("crm_contacts").delete().in("id", contactIds));
  if (accountIds.length) await run("accounts", db.from("crm_accounts").delete().in("id", accountIds));
  await run("audit", db.from("crm_audit_logs").delete().in("record_id", [...all, ...activityIds]));
  await run("recent views", db.from("crm_recent_views").delete().in("record_id", [...all, ...activityIds]));
  if (errors.length) throw new Error(`e2e teardown: ${errors.join("; ")}`);
}

/** Removes reports, dashboards, folders and team home layouts the reports e2e created ("E2E Reports ..."). */
async function cleanupReports(db: SupabaseClient) {
  const like = "E2E Reports %";
  const [dashboards, reports, folders] = await Promise.all([
    db.from("crm_dashboards").select("id").like("name", like),
    db.from("crm_reports").select("id").like("name", like),
    db.from("crm_report_folders").select("id").like("name", like),
  ]);
  // The reports tables may not exist yet (migration not applied): nothing to clean.
  if (dashboards.error || reports.error || folders.error) return;
  const dashboardIds = (dashboards.data ?? []).map((r: { id: string }) => r.id);
  const reportIds = (reports.data ?? []).map((r: { id: string }) => r.id);
  const folderIds = (folders.data ?? []).map((r: { id: string }) => r.id);

  if (dashboardIds.length) {
    // Never delete layouts (they may pre-exist): only strip the E2E dashboard refs from their widgets.
    const { data: layouts } = await db.from("crm_home_layouts").select("id, widgets").in("scope", ["team", "user", "default"]);
    for (const l of (layouts ?? []) as { id: string; widgets: { ref?: string }[] | null }[]) {
      const widgets = l.widgets ?? [];
      const kept = widgets.filter((w) => !(w.ref && dashboardIds.includes(w.ref)));
      if (kept.length !== widgets.length) await db.from("crm_home_layouts").update({ widgets: kept }).eq("id", l.id);
    }
    await db.from("crm_dashboards").delete().in("id", dashboardIds);
  }
  if (reportIds.length) await db.from("crm_reports").delete().in("id", reportIds);
  if (folderIds.length) await db.from("crm_report_folders").delete().in("id", folderIds);
  const all = [...dashboardIds, ...reportIds, ...folderIds];
  if (all.length) await db.from("crm_audit_logs").delete().in("record_id", all);
}

/**
 * Removes what e2e/automation.spec.ts created: stage task templates "E2E Automation %",
 * their tasks (external_ref automation:stage:<tpl>%), notifications for those tasks / with the test subject
 * and any leftover temporary admin. Skips quietly when the automation tables are missing.
 */
async function cleanupAutomation(db: SupabaseClient) {
  const templates = await db.from("crm_stage_task_templates").select("id").like("subject", "E2E Automation %");
  if (templates.error) return;
  const templateIds = (templates.data ?? []).map((r: { id: string }) => r.id);

  const taskIds: string[] = [];
  for (const id of templateIds) {
    const { data } = await db.from("crm_activities").select("id").like("external_ref", `automation:stage:${id}%`);
    taskIds.push(...(data ?? []).map((r: { id: string }) => r.id));
  }
  if (taskIds.length) await db.from("crm_activities").delete().in("id", taskIds);
  if (templateIds.length) await db.from("crm_stage_task_templates").delete().in("id", templateIds);
  // Notifications the engine created for the test's tasks (by record) or carrying the test subject.
  if (taskIds.length) await db.from("crm_notifications").delete().in("record_id", taskIds);
  await db.from("crm_notifications").delete().like("params->>subject", "E2E Automation %");
  const all = [...templateIds, ...taskIds];
  if (all.length) await db.from("crm_audit_logs").delete().in("record_id", all);

  const { data: admins } = await db.from("crm_users").select("id").like("email", "e2e-automation-admin-%@example.com");
  for (const a of (admins ?? []) as { id: string }[]) {
    await db.from("crm_users").delete().eq("id", a.id);
    await db.auth.admin.deleteUser(a.id);
  }
}
