import { NextResponse } from "next/server";
import { EMAIL_PRESETS } from "@/lib/crm/email/presets";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";

/** Provider settings come from the server so clients do not hard-code hosts. */
export async function GET() {
  const guard = await crmGuard("email", "view");
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ presets: EMAIL_PRESETS });
}
