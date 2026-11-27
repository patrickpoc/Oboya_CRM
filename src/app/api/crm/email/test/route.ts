import { NextResponse } from "next/server";
import { accountForBridge, loadSecretAccount } from "@/lib/crm/email/account-repository";
import { classifyConnectionError } from "@/lib/crm/email/connection-error";
import { decryptSecret } from "@/lib/crm/email/credentials";
import { verifyImap } from "@/lib/crm/email/imap";
import { emailAccountInputSchema } from "@/lib/crm/email/schemas";
import { verifySmtp } from "@/lib/crm/email/smtp";
import type { EmailAccount } from "@/lib/crm/email/types";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
  const guard = await crmGuard("email", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, emailAccountInputSchema);
  if (body instanceof NextResponse) return body;

  try {
    const existing = body.data.id ? await loadSecretAccount(guard.supabase, guard.user.id, body.data.id) : null;
    if (body.data.id && !existing) return jsonError(404, "not_found", "Mailbox not found");
    const password = body.data.password || (existing ? decryptSecret(existing.password_encrypted) : "");
    if (!password) return jsonError(400, "invalid_input", "Password is required");

    const candidate: EmailAccount = {
      id: existing?.id ?? "draft",
      label: body.data.label,
      email: body.data.email,
      provider: body.data.provider,
      username: body.data.username,
      smtpHost: body.data.smtpHost,
      smtpPort: body.data.smtpPort,
      smtpSecure: body.data.smtpSecure,
      imapHost: body.data.imapHost,
      imapPort: body.data.imapPort,
      imapSecure: body.data.imapSecure,
      color: body.data.color,
      enabled: body.data.enabled,
      lastSyncAt: existing?.last_sync_at ?? null,
      updatedAt: existing?.updated_at ?? new Date(0).toISOString(),
    };
    const config = accountForBridge(candidate, password);
    const [imap, smtp] = await Promise.allSettled([verifyImap(config.imap), verifySmtp(config.smtp)]);
    if (imap.status === "rejected" || smtp.status === "rejected") {
      // Only a coarse per-channel code reaches the browser; raw provider text stays in the server log.
      const fields = {
        imap: imap.status === "rejected" ? classifyConnectionError(imap.reason) : "ok",
        smtp: smtp.status === "rejected" ? classifyConnectionError(smtp.reason) : "ok",
      };
      console.error("email connection test failed:", fields, imap.status === "rejected" ? imap.reason : "", smtp.status === "rejected" ? smtp.reason : "");
      return jsonError(400, "connection_failed", "Connection failed", { fields });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Email connection test");
  }
}
