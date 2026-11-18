import "server-only";

import { cache } from "react";
import type { CrmSupabaseClient } from "@/lib/supabase/server";
import type { VirtualFieldHandler } from "@/lib/crm/repositories/virtual-fields";
import { caseSlaFromRows, parseCaseSlaHours } from "./sla";

/** crm_settings.case_sla_hours, cached per request like the lead SLA setting. */
export const getCaseSlaHours = cache(async (client: CrmSupabaseClient): Promise<Record<string, number>> => {
  const { data, error } = await client
    .from("crm_settings")
    .select("value")
    .eq("key", "case_sla_hours")
    .maybeSingle();
  if (error) console.error("case sla setting read failed:", error.code);
  return parseCaseSlaHours((data as { value?: unknown } | null)?.value);
});

/**
 * `case.sla` (read-only, computed): resolution SLA state from status,
 * priority and the timestamps stamped by crm_case_rules.
 */
export const caseSlaHandler: VirtualFieldHandler = {
  columns: ["status", "priority", "created_at", "sla_due_at", "resolved_at"],
  async load(client, _ids, rows) {
    if (rows.length === 0) return new Map();
    return caseSlaFromRows(rows, Date.now(), await getCaseSlaHours(client));
  },
  async save() {
    // Computed from timestamps; never written directly.
  },
};
