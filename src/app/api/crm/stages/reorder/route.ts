import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { reorderSchema } from "@/lib/crm/setup/schemas";
import { loadDefaultPipeline } from "@/lib/crm/setup/stages.server";
import { isValidReorder } from "@/lib/crm/setup/stages";

export async function POST(request: Request) {
  const guard = await crmGuard("setup_pipeline", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, reorderSchema);
  if (body instanceof NextResponse) return body;

  const current = await loadDefaultPipeline(guard.supabase);
  if ("error" in current) return dbErrorResponse(current.error, "Stages read");
  if (!isValidReorder(current.stages.map((s) => s.id), body.data.ids)) {
    return jsonError(409, "stage_invalid_order", "The list of stages changed; reload and try again", {
      invariant: true,
    });
  }

  const { error } = await guard.supabase.rpc("crm_reorder_stages", {
    p_pipeline_id: current.pipeline.id,
    p_ids: body.data.ids,
  });
  if (error) return dbErrorResponse(error, "Stage reorder");

  const result = await loadDefaultPipeline(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Stages read");
  return NextResponse.json(result);
}
