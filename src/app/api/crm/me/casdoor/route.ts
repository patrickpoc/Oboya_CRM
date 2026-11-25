import { NextResponse } from "next/server";
import {
  CasdoorLinkError,
  getCasdoorLink,
  syncCasdoorProfile,
  unlinkCasdoorAccount,
} from "@/lib/crm/server/admin-only/casdoor-session";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { createClient } from "@/lib/supabase/server";

function fail(error: unknown) {
  if (error instanceof CasdoorLinkError) {
    const status = error.code === "no_password" ? 409 : error.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: error.code, message: error.message }, { status });
  }
  console.error("Casdoor account action failed:", error);
  return NextResponse.json({ error: "update_failed" }, { status: 500 });
}

/** Current user's Casdoor link, imported profile fields and unlink eligibility. */
export async function GET() {
  const guard = await crmGuard(undefined, "view", { allowPasswordChangePending: true });
  if (guard instanceof NextResponse) return guard;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  let link: Awaited<ReturnType<typeof getCasdoorLink>> = null;
  try {
    link = await getCasdoorLink(guard.user.id);
  } catch (error) {
    return fail(error);
  }

  const text = (key: string): string | null =>
    typeof metadata[key] === "string" && (metadata[key] as string).trim()
      ? (metadata[key] as string)
      : null;

  return NextResponse.json({
    linked: Boolean(link),
    sub: link?.sub ?? null,
    linkedAt: text("casdoor_linked_at"),
    email: text("casdoor_email"),
    displayName: text("casdoor_display_name"),
    title: text("casdoor_title"),
    country: text("casdoor_country"),
    countryCode: text("casdoor_country_code"),
    location: text("casdoor_location"),
    canUnlink: metadata.has_password === true,
  });
}

/** Copy the imported Casdoor name/title into the editable CRM profile. */
export async function PATCH() {
  const guard = await crmGuard(undefined, "view");
  if (guard instanceof NextResponse) return guard;

  try {
    const updated = await syncCasdoorProfile(guard.user.id);
    if (!updated) return NextResponse.json({ error: "nothing_to_sync" }, { status: 409 });
    return NextResponse.json({ ok: true, ...updated });
  } catch (error) {
    return fail(error);
  }
}

/** Remove the Casdoor link. Requires a verified password sign-in first. */
export async function DELETE() {
  const guard = await crmGuard(undefined, "view");
  if (guard instanceof NextResponse) return guard;

  try {
    await unlinkCasdoorAccount(guard.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
