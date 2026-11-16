import { NextResponse } from "next/server";
import { fieldErrors } from "@/lib/crm/objects/schema";
import { invalid, isRecordId, notFound, readJson } from "@/lib/crm/objects/route-helpers";
import {
  convertLeadSchema,
  mapConvertError,
  parseConvertResult,
  toConvertRpcArgs,
} from "@/lib/crm/leads/convert";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/crm/leads/:id/convert — crmGuard(leads.convert) → zod →
 * rpc crm_convert_lead (security definer; re-checks every permission and
 * visibility itself) with the user's JWT → safe error mapping.
 */
export async function POST(request: Request, { params }: Ctx) {
  const guard = await crmGuard("leads", "convert");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isRecordId(id)) return notFound();

  const parsed = convertLeadSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const { data, error } = await guard.supabase.rpc("crm_convert_lead", toConvertRpcArgs(id, parsed.data));
  if (error) {
    const mapped = mapConvertError(error);
    if (mapped.status >= 500) console.error("[crm leads] convert:", error.code, error.message);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const result = parseConvertResult(data);
  if (!result) {
    console.error("[crm leads] convert: unexpected RPC result");
    return NextResponse.json({ error: "Request failed", code: "unavailable" }, { status: 500 });
  }
  return NextResponse.json({ result });
}
