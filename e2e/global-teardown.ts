// Hard-deletes everything the smoke run created (service role): leads whose
// email is e2e-*@example.com, the account / contact / opportunity they were
// converted into, activities attached to any of them, and their audit rows.
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "../tests/support/env";

export const E2E_EMAIL_PREFIX = "e2e-";

export default async function globalTeardown() {
  const db = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

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
