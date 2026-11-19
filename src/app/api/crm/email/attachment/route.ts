import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { mailError } from "@/lib/crm/email/api-response";
import { fetchAttachment } from "@/lib/crm/email/imap";
import { emailAttachmentQuerySchema } from "@/lib/crm/email/schemas";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Streams one MIME part; the server never stores the bytes. */
export async function GET(request: Request) {
  const guard = await crmGuard("email", "view");
  if (guard instanceof NextResponse) return guard;
  const parsed = emailAttachmentQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, parsed.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    const attachment = await fetchAttachment(resolved.imap, parsed.data.folder, parsed.data.uid, parsed.data.part);
    if (!attachment) return jsonError(404, "not_found", "Attachment not found");

    const safeName = attachment.filename.replace(/[\r\n"]/g, "_");
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(Readable.toWeb(attachment.content) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return mailError("Email attachment stream", error);
  }
}
