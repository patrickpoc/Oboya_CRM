import "server-only";

import { getLeadSlaHours } from "@/lib/crm/repositories/lookups";
import type { VirtualFieldHandler } from "@/lib/crm/repositories/virtual-fields";
import { slaFromRows } from "./sla";

/**
 * `lead.sla` (read-only, computed): SLA state per lead from the rows' status,
 * created_at and first_responded_at, with thresholds from
 * crm_settings.lead_sla_hours (cached per request).
 */
export const leadSlaHandler: VirtualFieldHandler = {
  columns: ["status", "created_at", "first_responded_at"],
  async load(client, _ids, rows) {
    if (rows.length === 0) return new Map();
    return slaFromRows(rows, Date.now(), await getLeadSlaHours(client));
  },
  async save() {
    // Computed; never written.
  },
};
