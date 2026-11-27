import { NextResponse } from "next/server";
import { deleteFolder, publishActor, updateFolder } from "@/lib/crm/reports/repository";
import {
  FolderPatchSchema,
  IdSchema,
  failure,
  forbidden,
  notFound,
  reportsGuard,
  viewerOf,
} from "@/lib/crm/reports/route";
import { canPublish } from "@/lib/crm/reports/sharing";
import { parseBody, type IdParams } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await reportsGuard("edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  const body = await parseBody(request, FolderPatchSchema);
  if (body instanceof NextResponse) return body;
  try {
    if (body.data.visibility) {
      const actor = await publishActor(guard.supabase, viewerOf(guard));
      if (!canPublish(actor, body.data.visibility, body.data.teamId)) return forbidden();
    }
    const folder = await updateFolder(guard.supabase, viewerOf(guard), id, body.data);
    return folder ? NextResponse.json({ folder }) : notFound();
  } catch (error) {
    return failure(error, "Update report folder");
  }
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await reportsGuard("delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  try {
    return (await deleteFolder(guard.supabase, id))
      ? NextResponse.json({ ok: true })
      : notFound();
  } catch (error) {
    return failure(error, "Delete report folder");
  }
}
