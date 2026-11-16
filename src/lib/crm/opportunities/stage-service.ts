import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { RepositoryError } from "@/lib/crm/objects/errors";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import type { RecordRow } from "@/lib/crm/objects/types";
import { getPicklists } from "@/lib/crm/repositories/lookups";
import { get } from "@/lib/crm/repositories/object-repository";
import { planStageChange, type StageChangeInput, type StageInfo } from "./stages";

export type StageChangeResult =
  | { ok: true; record: RecordRow }
  | { ok: false; reason: "not_found" | "stage_unavailable" | "loss_reason_invalid" | "loss_reason_required" };

type StageRow = StageInfo & { active: boolean; pipeline_id: string };

/**
 * Applies a stage change with the user-scoped client (RLS + row guard + audit
 * trigger apply). Reads the current state to plan the change (probability
 * override, loss fields), then writes it in one call to
 * crm_change_opportunity_stage, which re-checks the rules and raises P0001
 * `loss_reason_required` / `stage_unavailable`.
 */
export async function changeStage(
  client: CrmSupabaseClient,
  id: string,
  input: StageChangeInput
): Promise<StageChangeResult> {
  const current = await client
    .from("crm_opportunities")
    .select("id, stage_id, probability, loss_reason, loss_note")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (current.error) throw new RepositoryError(current.error, "stage change read");
  if (!current.data) return { ok: false, reason: "not_found" };
  const row = current.data as {
    stage_id: string;
    probability: number | null;
    loss_reason: string | null;
    loss_note: string | null;
  };

  const stages = await client
    .from("crm_pipeline_stages")
    .select("id, kind, probability, active, pipeline_id")
    .in("id", [...new Set([row.stage_id, input.stageId])]);
  if (stages.error) throw new RepositoryError(stages.error, "stage change stages");
  const byId = new Map(((stages.data ?? []) as StageRow[]).map((s) => [s.id, s]));
  const currentStage = byId.get(row.stage_id) ?? null;
  const target = byId.get(input.stageId);
  if (!target || (!target.active && target.id !== row.stage_id)) return { ok: false, reason: "stage_unavailable" };
  if (currentStage && currentStage.pipeline_id !== target.pipeline_id) return { ok: false, reason: "stage_unavailable" };

  if (input.lossReason) {
    const reasons = (await getPicklists(client)).loss_reason ?? [];
    if (!reasons.some((r) => r.value === input.lossReason)) return { ok: false, reason: "loss_reason_invalid" };
  }

  const plan = planStageChange(
    { stageId: row.stage_id, probability: row.probability, lossReason: row.loss_reason, lossNote: row.loss_note },
    currentStage,
    target,
    input
  );
  if (!plan.ok) return { ok: false, reason: plan.error };

  if (plan.changed) {
    // One atomic write: the RPC updates stage, loss fields and probability
    // together (an explicit p_probability is kept instead of the stage default).
    const { error } = await client.rpc("crm_change_opportunity_stage", {
      p_id: id,
      p_stage_id: plan.patch.stage_id,
      p_loss_reason: plan.patch.loss_reason,
      p_loss_note: plan.patch.loss_note,
      p_probability: plan.patch.probability,
    });
    if (error) {
      const code = (error.message ?? "").trim();
      if (error.code === "P0001" && (code === "loss_reason_required" || code === "stage_unavailable")) {
        return { ok: false, reason: code };
      }
      if (error.code === "P0002") return { ok: false, reason: "not_found" };
      throw new RepositoryError(error, "stage change");
    }
  }

  const record = await get(client, opportunityConfig, id);
  return record ? { ok: true, record } : { ok: false, reason: "not_found" };
}
