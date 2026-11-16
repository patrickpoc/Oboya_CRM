import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";
import { stageCreateSchema } from "@/lib/crm/setup/schemas";
import { loadDefaultPipeline } from "@/lib/crm/setup/stages.server";
import { orderWithNewStage } from "@/lib/crm/setup/stages";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("setup_pipeline", "view");
  if (guard instanceof NextResponse) return guard;
  const result = await loadDefaultPipeline(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Stages read");
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const guard = await crmGuard("setup_pipeline", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, stageCreateSchema);
  if (body instanceof NextResponse) return body;

  const current = await loadDefaultPipeline(guard.supabase);
  if ("error" in current) return dbErrorResponse(current.error, "Stages read");

  const maxSort = current.stages.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  const { data, error } = await guard.supabase
    .from("crm_pipeline_stages")
    .insert({
      pipeline_id: current.pipeline.id,
      label: body.data.label,
      probability: body.data.probability,
      color_token: body.data.colorToken ?? null,
      kind: "open",
      active: true,
      sort_order: maxSort + 10,
    })
    .select("id")
    .single();
  if (error) return dbErrorResponse(error, "Stage create");

  // New open stages go before won/lost.
  const ids = orderWithNewStage(current.stages, data.id);
  const { error: reorderError } = await guard.supabase.rpc("crm_reorder_stages", {
    p_pipeline_id: current.pipeline.id,
    p_ids: ids,
  });
  if (reorderError) console.error("Placing the new stage failed:", reorderError.message);

  const result = await loadDefaultPipeline(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Stages read");
  return NextResponse.json({ ...result, createdId: data.id }, { status: 201 });
}
