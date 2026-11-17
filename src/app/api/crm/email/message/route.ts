import { NextResponse } from "next/server";
import { mailError } from "@/lib/crm/email/api-response";
import { fetchBody } from "@/lib/crm/email/imap";
import { emailMessageQuerySchema } from "@/lib/crm/email/schemas";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Text parts only; attachment bytes are fetched through a separate route. */
export async function GET(request: Request) {
  const guard = await crmGuard("email", "view");
  if (guard instanceof NextResponse) return guard;
  const parsed = emailMessageQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, parsed.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    const headerId = `${parsed.data.accountId}:${parsed.data.folder}:${parsed.data.uid}`;
    const body = await fetchBody(
      resolved.imap,
      parsed.data.accountId,
      parsed.data.folder,
      headerId,
      parsed.data.uid
    );
    if (!body) return jsonError(404, "not_found", "Message not found");
    return NextResponse.json(body);
  } catch (error) {
    return mailError("Email body fetch", error);
  }
}
