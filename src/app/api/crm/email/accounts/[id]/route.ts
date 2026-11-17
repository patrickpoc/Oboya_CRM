import { NextResponse } from "next/server";
import { deleteAccount } from "@/lib/crm/email/account-repository";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await crmGuard("email", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return jsonError(400, "invalid_input", "Invalid mailbox id");
  }
  try {
    await deleteAccount(guard.supabase, guard.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Email account delete");
  }
}
