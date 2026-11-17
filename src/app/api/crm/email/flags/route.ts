import { NextResponse } from "next/server";
import { mailError } from "@/lib/crm/email/api-response";
import { setMailFlags } from "@/lib/crm/email/imap";
import { emailFlagsSchema } from "@/lib/crm/email/schemas";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = await crmGuard("email", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await request.json().catch(() => null);
  const parsed = emailFlagsSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, parsed.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    await setMailFlags(resolved.imap, parsed.data.folder, parsed.data.uid, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mailError("Email flag update", error);
  }
}
