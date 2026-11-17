import { NextResponse } from "next/server";
import { emailMatchQuerySchema } from "@/lib/crm/email/schemas";
import { matchAccounts, matchContacts } from "@/lib/crm/email/server";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Exact lower(email) lookups through deferred-join RPCs; no whole-table scans. */
export async function GET(request: Request) {
  const guard = await crmGuard("email", "view");
  if (guard instanceof NextResponse) return guard;
  const parsed = emailMatchQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid input");
  const emails = parsed.data.emails.split(",").filter(Boolean);

  try {
    const [contacts, accounts] = await Promise.all([
      matchContacts(guard.supabase, emails),
      matchAccounts(guard.supabase, emails),
    ]);
    const seen = new Set<string>();
    const matches = [...contacts, ...accounts].filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
    return NextResponse.json({ matches });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Email contact match");
  }
}
