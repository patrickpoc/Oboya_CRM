import "server-only";

import { fromDbRow, type AutomationRun, type RunTrigger } from "@/lib/crm/automation/types";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Runs crm_run_automation (service role only). Callers authorise first: the
 * cron route via CRON_SECRET, the manual route via automation.edit + rate limit.
 */
export async function runAutomation(input: { trigger: RunTrigger; actorId?: string | null }): Promise<AutomationRun> {
  const { data, error } = await createServiceClient().rpc("crm_run_automation", {
    p_now: new Date().toISOString(),
    p_trigger: input.trigger,
    p_actor: input.actorId ?? null,
  });
  if (error) throw error;
  const row = fromDbRow<AutomationRun>(data as Record<string, unknown>);
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    counts: row.counts,
    errors: row.errors,
  };
}
