import { NextResponse } from "next/server";
import { activityConfig } from "@/lib/crm/objects/activity";
import { create } from "@/lib/crm/repositories/object-repository";
import { mailError } from "@/lib/crm/email/api-response";
import { jsonError } from "@/lib/crm/setup/api.server";
import { emailSendSchema } from "@/lib/crm/email/schemas";
import { parseSendRequest } from "@/lib/crm/email/send-payload";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { sendMail } from "@/lib/crm/email/smtp";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await crmGuard("email", "edit");
  if (guard instanceof NextResponse) return guard;
  const parsed = await parseSendRequest(request, emailSendSchema);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, parsed.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    const result = await sendMail(resolved.smtp, parsed.data, parsed.attachments);

    if (parsed.data.logRecordId) {
      const recordType = parsed.data.logRecordType ?? "contact";
      try {
        await create(guard.supabase, activityConfig, {
          subject: `Email: ${parsed.data.subject || "(no subject)"}`,
          type: "email",
          status: "done",
          priority: "normal",
          what_object: recordType,
          what_id: parsed.data.logRecordId,
          body: parsed.data.text.slice(0, 2000),
        });
      } catch (error) {
        console.error("email activity log failed:", error);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return mailError("Email send", error);
  }
}
