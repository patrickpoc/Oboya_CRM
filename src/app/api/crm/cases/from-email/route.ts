import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/crm/setup/api.server";
import { caseConfig } from "@/lib/crm/objects/case";
import { create, update } from "@/lib/crm/repositories/object-repository";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";

/** Message metadata supplied by the browser's local mail cache. */
const schema = z.object({
  messageId: z.string().trim().min(1).max(320),
  subject: z.string().trim().min(1).max(300),
  from: z.string().trim().email().max(320),
  body: z.string().max(100_000).default(""),
  accountId: z.guid().optional(),
  contactId: z.guid().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  queue: z.enum(["support", "logistics", "quality", "billing", "escalation"]).default("support"),
});

/**
 * Create a case from an email, or update the existing case with the same
 * message id (thread replies must not create duplicates). All reads/writes
 * go through the user-scoped client so RLS decides visibility.
 */
export async function POST(request: Request) {
  const guard = await crmGuard("cases", "create");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");
  const input = parsed.data;

  try {
    // RLS-scoped lookup: a message id the caller cannot see returns nothing.
    const { data: existing, error: lookupError } = await guard.supabase
      .from(caseConfig.table)
      .select("id")
      .eq("source_message_id", input.messageId)
      .is("deleted_at", null)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
      const record = await update(guard.supabase, caseConfig, existing.id, {
        description: (input.body || input.subject).slice(0, 10_000),
        status: "working",
      });
      return NextResponse.json({ record, updated: true });
    }

    const record = await create(guard.supabase, caseConfig, {
      subject: input.subject,
      description: (input.body || input.subject).slice(0, 10_000),
      type: "question",
      priority: input.priority,
      queue: input.queue,
      status: "new",
      account_id: input.accountId,
      contact_id: input.contactId,
      source_email: input.from,
      source_message_id: input.messageId,
    });
    return NextResponse.json({ record, updated: false }, { status: 201 });
  } catch (error) {
    console.error("case from email failed:", error instanceof Error ? error.message : error);
    return jsonError(502, "offline", "Could not create the case");
  }
}
