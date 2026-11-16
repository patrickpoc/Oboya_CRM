import { NextResponse } from "next/server";
import { z } from "zod";
import { fieldErrors } from "@/lib/crm/objects/schema";
import { errorResponse, invalid, isRecordId, notFound, readJson } from "@/lib/crm/objects/route-helpers";
import { changeStage } from "@/lib/crm/opportunities/stage-service";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    stageId: z.guid(),
    lossReason: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
      .nullish(),
    lossNote: z.string().trim().max(2000).nullish(),
    probability: z.number().int().min(0).max(100).nullish(),
  })
  .strip();

/**
 * POST /api/crm/opportunities/:id/stage { stageId, lossReason?, lossNote?, probability? }
 * Rules: lib/crm/opportunities/stages.ts. 422 with a stable code
 * (`loss_reason_required`, `stage_unavailable`) when a rule fails.
 */
export async function POST(request: Request, { params }: Ctx) {
  const guard = await crmGuard("opportunities", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isRecordId(id)) return notFound();
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  try {
    const result = await changeStage(guard.supabase, id, parsed.data);
    if (result.ok) return NextResponse.json({ record: result.record });
    switch (result.reason) {
      case "not_found":
        return notFound();
      case "loss_reason_invalid":
        return invalid({ lossReason: "invalid" });
      case "loss_reason_required":
      case "stage_unavailable":
        return NextResponse.json({ error: result.reason, code: result.reason }, { status: 422 });
    }
  } catch (error) {
    return errorResponse(error, "opportunity stage");
  }
}
