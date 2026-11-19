import { NextResponse } from "next/server";
import { z } from "zod";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";

/** Message metadata supplied by the browser's local mail cache. */
const schema = z.object({
  messageId: z.string().trim().min(1).max(320),
  inReplyTo: z.string().trim().max(320).optional(),
  references: z.array(z.string().trim().min(1).max(320)).max(50).default([]),
  subject: z.string().trim().min(1).max(300),
  from: z.string().trim().email().max(320),
  body: z.string().max(100_000).default(""),
  accountId: z.guid().optional(),
  contactId: z.guid().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  queue: z.enum(["support", "logistics", "quality", "billing", "escalation"]).default("support"),
});

/**
 * Follow Message-ID / In-Reply-To / References in one atomic, RLS-scoped RPC.
 */
export async function POST(request: Request) {
  const guard = await crmGuard("cases", "create");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");
  const input = parsed.data;

  try {
    const { data, error } = await guard.supabase.rpc("crm_case_from_email", {
      p_message_id: input.messageId,
      p_in_reply_to: input.inReplyTo ?? null,
      p_references: input.references,
      p_subject: input.subject,
      p_from: input.from,
      p_body: input.body,
      p_account_id: input.accountId ?? null,
      p_contact_id: input.contactId ?? null,
      p_priority: input.priority,
      p_queue: input.queue,
    });
    if (error) throw error;
    const result = data as { record: { id: string }; updated: boolean };
    return NextResponse.json(result, { status: result.updated ? 200 : 201 });
  } catch (error) {
    if ((error as { code?: string })?.code === "54000") {
      return jsonError(413, "too_large", "Case email history is full");
    }
    return dbErrorResponse(error as { code?: string; message?: string }, "Case from email");
  }
}
