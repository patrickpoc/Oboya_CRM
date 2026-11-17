import { NextResponse } from "next/server";
import { activityConfig } from "@/lib/crm/objects/activity";
import { create } from "@/lib/crm/repositories/object-repository";
import { mailError } from "@/lib/crm/email/api-response";
import { emailSendSchema } from "@/lib/crm/email/schemas";
import { resolveBridgeAccount } from "@/lib/crm/email/server";
import { sendMail } from "@/lib/crm/email/smtp";
import { jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await crmGuard("email", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, emailSendSchema);
  if (body instanceof NextResponse) return body;

  try {
    const resolved = await resolveBridgeAccount(guard.supabase, guard.user.id, body.data.accountId);
    if (!resolved) return jsonError(404, "not_found", "Mailbox not found");
    const result = await sendMail(resolved.smtp, body.data);

    if (body.data.logRecordId) {
      const recordType = body.data.logRecordType ?? "contact";
      try {
        await create(guard.supabase, activityConfig, {
          subject: `Email: ${body.data.subject || "(no subject)"}`,
          type: "email",
          status: "done",
          priority: "normal",
          what_object: recordType,
          what_id: body.data.logRecordId,
          body: body.data.text.slice(0, 2000),
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
