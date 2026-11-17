import { NextResponse } from "next/server";
import { touchSynced } from "@/lib/crm/email/account-repository";
import { mailError } from "@/lib/crm/email/api-response";
import { syncHeaders } from "@/lib/crm/email/imap";
import { emailSyncQuerySchema } from "@/lib/crm/email/schemas";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Metadata-only UID window. Clients cache the result in IndexedDB. */
export async function GET(request: Request) {
  const guard = await crmGuard("email", "edit");
  if (guard instanceof NextResponse) return guard;
  const parsed = emailSyncQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, parsed.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    const page = await syncHeaders(
      resolved.imap,
      resolved.account,
      parsed.data.folder,
      parsed.data.sinceUid,
      parsed.data.limit
    );
    await touchSynced(guard.supabase, guard.user.id, parsed.data.accountId).catch((error) => {
      console.error("email sync timestamp failed:", error);
    });
    return NextResponse.json(page);
  } catch (error) {
    return mailError("Email header sync", error);
  }
}
