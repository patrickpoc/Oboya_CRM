import { NextResponse } from "next/server";
import { z } from "zod";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { stagePatchSchema } from "@/lib/crm/setup/schemas";
import { loadDefaultPipeline } from "@/lib/crm/setup/stages.server";
import { checkStageUpdate, planStageDelete } from "@/lib/crm/setup/stages";

const UPDATE_MESSAGES = {
  fixed_kind: "Won and lost stages keep their kind",
  won_lost_active: "Won and lost stages must stay active",
  last_open: "Pipeline needs at least one active open stage",
  kind_change: "Stage kind cannot be changed",
} as const;

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_pipeline", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Stage not found");

  const body = await parseBody(request, stagePatchSchema);
  if (body instanceof NextResponse) return body;
  const patch = body.data;

  const current = await loadDefaultPipeline(guard.supabase);
  if ("error" in current) return dbErrorResponse(current.error, "Stages read");
  if (!current.stages.some((s) => s.id === id)) return jsonError(404, "not_found", "Stage not found");

  const rule = checkStageUpdate(current.stages, id, patch);
  if (rule) return jsonError(409, `stage_${rule}`, UPDATE_MESSAGES[rule], { invariant: true });

  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.probability !== undefined) update.probability = patch.probability;
  if (patch.colorToken !== undefined) update.color_token = patch.colorToken;
  if (patch.active !== undefined) update.active = patch.active;
  if (Object.keys(update).length === 0) return jsonError(400, "invalid_input", "Nothing to update");

  const { data, error } = await guard.supabase
    .from("crm_pipeline_stages")
    .update(update)
    .eq("id", id)
    .select("id");
  if (error) return dbErrorResponse(error, "Stage update");
  if (!data?.length) return jsonError(403, "forbidden", "Forbidden");

  const result = await loadDefaultPipeline(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Stages read");
  return NextResponse.json(result);
}

const deleteQuery = z.object({ target: z.uuid().optional() });

/** DELETE /api/crm/stages/:id?target=<stage id> (target required when opportunities exist). */
export async function DELETE(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_pipeline", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Stage not found");

  const query = deleteQuery.safeParse({
    target: new URL(request.url).searchParams.get("target") || undefined,
  });
  if (!query.success) return jsonError(400, "invalid_input", "Invalid target stage");

  const current = await loadDefaultPipeline(guard.supabase);
  if ("error" in current) return dbErrorResponse(current.error, "Stages read");
  const plan = planStageDelete(current.stages, id);
  if (!plan.ok) {
    if (plan.reason === "not_found") return jsonError(404, "not_found", "Stage not found");
    return jsonError(
      409,
      plan.reason === "fixed_kind" ? "stage_won_lost_fixed" : "stage_needs_open",
      plan.reason === "fixed_kind"
        ? "Won and lost stages cannot be removed"
        : "Pipeline needs at least one active open stage",
      { invariant: true }
    );
  }
  if (plan.needsTarget && !query.data.target) {
    return jsonError(409, "stage_target_required", "Choose a stage for the opportunities in this stage", {
      invariant: true,
    });
  }

  // The RPC re-checks everything (admin, kind, target) in one transaction.
  const { data: moved, error } = await guard.supabase.rpc("crm_delete_stage", {
    p_stage_id: id,
    p_target_stage_id: query.data.target ?? null,
  });
  if (error) return dbErrorResponse(error, "Stage delete");

  const result = await loadDefaultPipeline(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Stages read");
  return NextResponse.json({ ...result, moved: moved ?? 0 });
}
