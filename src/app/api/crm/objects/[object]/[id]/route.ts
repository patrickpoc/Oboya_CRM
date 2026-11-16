import { NextResponse } from "next/server";
import { buildSchema, fieldErrors } from "@/lib/crm/objects/schema";
import {
  errorResponse,
  guardObject,
  invalid,
  isRecordId,
  notFound,
  readJson,
} from "@/lib/crm/objects/route-helpers";
import { get, softDelete, update } from "@/lib/crm/repositories/object-repository";

type Ctx = { params: Promise<{ object: string; id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { object, id } = await params;
  const ctx = await guardObject(object, "view");
  if (ctx instanceof NextResponse) return ctx;
  if (!isRecordId(id)) return notFound();
  try {
    const record = await get(ctx.guard.supabase, ctx.config, id);
    return record ? NextResponse.json({ record }) : notFound();
  } catch (error) {
    return errorResponse(error, "get");
  }
}

/** Partial update of editable fields only (unknown keys are stripped). */
export async function PATCH(request: Request, { params }: Ctx) {
  const { object, id } = await params;
  const ctx = await guardObject(object, "edit");
  if (ctx instanceof NextResponse) return ctx;
  if (!isRecordId(id)) return notFound();
  const parsed = buildSchema(ctx.config, "update").safeParse(await readJson(request));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  try {
    const record = await update(ctx.guard.supabase, ctx.config, id, parsed.data);
    return record ? NextResponse.json({ record }) : notFound();
  } catch (error) {
    return errorResponse(error, "update");
  }
}

/** Soft delete via crm_soft_delete (no hard delete from the app). */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { object, id } = await params;
  const ctx = await guardObject(object, "delete");
  if (ctx instanceof NextResponse) return ctx;
  if (!isRecordId(id)) return notFound();
  try {
    await softDelete(ctx.guard.supabase, ctx.config, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "delete");
  }
}
