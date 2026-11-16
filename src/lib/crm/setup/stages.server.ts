import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { STAGE_COLUMNS, toStageFields } from "./rows";
import type { SetupStage } from "./stages";

export type PipelineStages = { pipeline: { id: string; name: string }; stages: SetupStage[] };

/** Default pipeline with its stages (sort order) and opportunity counts per stage. */
export async function loadDefaultPipeline(
  supabase: CrmSupabaseClient
): Promise<PipelineStages | { error: { code?: string; message?: string } | null }> {
  const { data: pipeline, error } = await supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("is_default", true)
    .maybeSingle();
  if (error || !pipeline) return { error: error ?? { code: "P0002", message: "No default pipeline" } };

  const { data: rows, error: stagesError } = await supabase
    .from("crm_pipeline_stages")
    .select(STAGE_COLUMNS)
    .eq("pipeline_id", pipeline.id)
    .order("sort_order")
    .order("label");
  if (stagesError) return { error: stagesError };

  // crm_delete_stage counts every opportunity (deleted ones too); a super
  // admin sees all of them through RLS, so the counts match the RPC.
  const counts = await Promise.all(
    (rows ?? []).map((row) =>
      supabase
        .from("crm_opportunities")
        .select("id", { count: "exact", head: true })
        .eq("stage_id", row.id)
        .then(({ count }) => count ?? 0)
    )
  );

  return {
    pipeline,
    stages: (rows ?? []).map((row, i) => ({ ...toStageFields(row), opportunityCount: counts[i] })),
  };
}
