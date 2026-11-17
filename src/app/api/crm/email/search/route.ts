import { NextResponse } from "next/server";
import { mailError } from "@/lib/crm/email/api-response";
import { searchHeaders } from "@/lib/crm/email/imap";
import { emailSearchQuerySchema } from "@/lib/crm/email/schemas";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** IMAP SEARCH by a CRM contact address; returns headers only. */
export async function GET(request: Request) {
  const guard = await crmGuard("email", "view");
  if (guard instanceof NextResponse) return guard;
  const parsed = emailSearchQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, parsed.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    const items = await searchHeaders(
      resolved.imap,
      resolved.account,
      parsed.data.folder,
      parsed.data.q,
      parsed.data.limit
    );
    return NextResponse.json({ items });
  } catch (error) {
    return mailError("Email history search", error);
  }
}
