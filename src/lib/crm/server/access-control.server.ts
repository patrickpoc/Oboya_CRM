import "server-only";

import type { AccessMatrix } from "@/lib/crm/permissions/access-types";
import { parseAccessMatrix } from "@/lib/crm/permissions/access-store";
import type { CrmSupabaseClient } from "@/lib/supabase/server";

/**
 * Reads the crm_access_control singleton with the user-scoped client (RLS:
 * readable by active CRM users). A missing row means builtin; a failed read
 * throws so callers fail closed.
 */
export async function loadAccessMatrix(supabase: CrmSupabaseClient): Promise<AccessMatrix> {
  const { data, error } = await supabase
    .from("crm_access_control")
    .select("matrix")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`crm_access_control read failed: ${error.message}`);
  // Per-request value: never stored in module state on the server.
  return parseAccessMatrix(data ? data.matrix : null);
}
