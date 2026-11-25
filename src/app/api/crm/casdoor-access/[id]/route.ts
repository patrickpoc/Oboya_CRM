import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approveCasdoorRequest,
  CasdoorLinkError,
  rejectCasdoorRequest,
} from "@/lib/crm/server/admin-only/casdoor-session";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { jsonError, parseBody, type IdParams, isUuid } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const note = z.string().trim().max(500).nullable().optional();
const reviewSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("approve"),
      role: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
      teamId: z.uuid().nullable().optional(),
      note,
    })
    .strict(),
  z.object({ action: z.literal("reject"), note }).strict(),
]);

/** Super-admin review of a pending Casdoor sign-in / link request. */
export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_users", "edit");
  if (guard instanceof NextResponse) return guard;
  if (guard.user.role !== "super_admin") {
    return jsonError(403, "forbidden", "Only a super admin can review Casdoor access");
  }

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Request not found");

  const body = await parseBody(request, reviewSchema);
  if (body instanceof NextResponse) return body;
  const input = body.data;

  try {
    const updated =
      input.action === "approve"
        ? await approveCasdoorRequest({
            requestId: id,
            actorId: guard.user.id,
            role: input.role,
            teamId: input.teamId ?? null,
            note: input.note ?? null,
          })
        : await rejectCasdoorRequest({
            requestId: id,
            actorId: guard.user.id,
            note: input.note ?? null,
          });
    return NextResponse.json({ ok: true, request: updated });
  } catch (error) {
    if (error instanceof CasdoorLinkError) {
      const status = error.code === "not_found" ? 404 : error.code === "policy" ? 403 : 400;
      return jsonError(status, error.code, error.message);
    }
    console.error("Casdoor access review failed:", error);
    return jsonError(500, "failed", "Review failed");
  }
}
