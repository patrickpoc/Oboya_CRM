import { NextResponse } from "next/server";
import { z } from "zod";
import { ACTIVITY_PARENTS, activityConfig } from "@/lib/crm/objects/activity";
import { buildSchema, fieldErrors } from "@/lib/crm/objects/schema";
import { errorResponse, invalid, readJson } from "@/lib/crm/objects/route-helpers";
import { create } from "@/lib/crm/repositories/object-repository";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

/** The related record (read-only after creation, so not in the generic create schema). */
const relatedSchema = z
  .object({
    what_object: z.enum(ACTIVITY_PARENTS).optional(),
    what_id: z.guid().optional(),
  })
  .strip()
  .refine((v) => (v.what_object === undefined) === (v.what_id === undefined), {
    message: "what_pair",
    path: ["what_id"],
  });

/**
 * POST /api/crm/activities — creates an activity, optionally related to a
 * lead/account/contact/opportunity (timeline composer). RLS rejects a parent
 * the user cannot see (403).
 */
export async function POST(request: Request) {
  const guard = await crmGuard("activities", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await readJson(request);
  const base = buildSchema(activityConfig, "create").safeParse(body);
  const related = relatedSchema.safeParse(body ?? {});
  if (!base.success || !related.success) {
    return invalid({
      ...(base.success ? {} : fieldErrors(base.error)),
      ...(related.success ? {} : fieldErrors(related.error)),
    });
  }
  try {
    const record = await create(guard.supabase, activityConfig, { ...base.data, ...related.data });
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "activity create");
  }
}
