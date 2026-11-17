import { NextResponse } from "next/server";
import { listAccounts, saveAccount } from "@/lib/crm/email/account-repository";
import { emailAccountInputSchema, emailAccountListQuerySchema } from "@/lib/crm/email/schemas";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await crmGuard("email", "view");
  if (guard instanceof NextResponse) return guard;
  const parsed = emailAccountListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");
  try {
    return NextResponse.json(await listAccounts(guard.supabase, guard.user.id, parsed.data.cursor, parsed.data.limit));
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Email account list");
  }
}

export async function PUT(request: Request) {
  const guard = await crmGuard("email", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, emailAccountInputSchema);
  if (body instanceof NextResponse) return body;
  try {
    const account = await saveAccount(guard.supabase, guard.user.id, body.data);
    return NextResponse.json({ account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "not_found") return jsonError(404, "not_found", "Mailbox not found");
    if (message.startsWith("Password")) return jsonError(400, "invalid_input", message);
    return dbErrorResponse(error as { code?: string; message?: string }, "Email account save");
  }
}
