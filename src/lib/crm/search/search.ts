import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import type { CrmAction, CrmModule } from "@/lib/crm/types";
import { requireRecordConfig } from "@/lib/crm/objects/registry";
import {
  SEARCH_LIMIT,
  SEARCH_OBJECTS,
  joinSecondary,
  searchFilter,
  type SearchGroup,
  type SearchHit,
  type SearchObject,
} from "./query";

type Row = Record<string, unknown> & { id: string };

/** Columns and secondary text per object. Embedded accounts are RLS-scoped too. */
const SPECS: Record<SearchObject, { select: string; name: (r: Row) => unknown; secondary: (r: Row) => string }> = {
  lead: {
    select: "id, full_name, company, email",
    name: (r) => r.full_name || r.company || r.email,
    secondary: (r) => joinSecondary([r.company, r.email]),
  },
  account: {
    select: "id, name, billing_city, country_code, email",
    name: (r) => r.name,
    secondary: (r) => joinSecondary([r.billing_city, r.country_code, r.email]),
  },
  contact: {
    select: "id, full_name, title, email, crm_accounts(name)",
    name: (r) => r.full_name,
    secondary: (r) => joinSecondary([r.title, accountName(r), r.email]),
  },
  opportunity: {
    select: "id, name, amount, currency, crm_accounts(name)",
    name: (r) => r.name,
    secondary: (r) =>
      joinSecondary([accountName(r), r.amount != null ? `${r.currency ?? ""} ${Number(r.amount).toLocaleString("en-US")}`.trim() : null]),
  },
};

function accountName(row: Row): unknown {
  const embed = row.crm_accounts as { name?: unknown } | Array<{ name?: unknown }> | null | undefined;
  return Array.isArray(embed) ? embed[0]?.name : embed?.name;
}

/** Top hits per object the user may view (RLS scopes rows). Empty groups are dropped. */
export async function globalSearch(
  client: CrmSupabaseClient,
  q: string,
  can: (module: CrmModule, action?: CrmAction) => boolean
): Promise<SearchGroup[]> {
  const groups = await Promise.all(
    SEARCH_OBJECTS.map(async (object): Promise<SearchGroup | null> => {
      const config = requireRecordConfig(object);
      if (!can(config.module, "view")) return null;
      const filter = searchFilter(config, q);
      if (!filter) return null;
      const spec = SPECS[object];
      const { data, error } = await client
        .from(config.table)
        .select(spec.select)
        .or(filter)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(SEARCH_LIMIT);
      if (error) throw new Error(`search ${object}: ${error.message}`);
      const hits: SearchHit[] = ((data ?? []) as unknown as Row[]).map((row) => ({
        id: row.id,
        name: String(spec.name(row) ?? "") || "—",
        secondary: spec.secondary(row),
      }));
      return hits.length > 0 ? { object, hits } : null;
    })
  );
  return groups.filter((g): g is SearchGroup => g !== null);
}
