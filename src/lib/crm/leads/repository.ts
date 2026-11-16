import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import type { RecordRow } from "@/lib/crm/objects/types";
import { isLeadConverted } from "./status";

export type LeadLink = { id: string; name: string } | null;

export type LeadSummary = {
  id: string;
  name: string;
  company: string | null;
  status: string;
  unqualifiedReason: string | null;
  convertedAt: string | null;
  account: LeadLink;
  contact: LeadLink;
  opportunity: LeadLink;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Converted record link from the lead row; the label comes from `_display` (null when RLS hides it). */
function link(row: RecordRow, key: string): LeadLink {
  const id = text(row[key]);
  const name = row._display?.[key];
  return id && name !== undefined ? { id, name } : null;
}

/**
 * What the lead page needs for the path, Convert dialog and conversion banner,
 * derived from the record RecordPage already loaded (no second read).
 */
export function leadSummaryFromRecord(row: RecordRow): LeadSummary {
  return {
    id: row.id,
    name: row._display?._name || text(row.full_name) || text(row.email) || "",
    company: text(row.company),
    status: text(row.status) ?? "new",
    unqualifiedReason: text(row.unqualified_reason),
    convertedAt: isLeadConverted(row) ? (row.converted_at as string) : null,
    account: link(row, "converted_account_id"),
    contact: link(row, "converted_contact_id"),
    opportunity: link(row, "converted_opportunity_id"),
  };
}

/** Default currency of a group company (Convert dialog), "USD" when unknown. */
export async function getEntityDefaultCurrency(client: CrmSupabaseClient, entityId: unknown): Promise<string> {
  if (typeof entityId !== "string") return "USD";
  const { data } = await client.from("crm_entities").select("default_currency").eq("id", entityId).maybeSingle();
  return (data as { default_currency?: string } | null)?.default_currency ?? "USD";
}
