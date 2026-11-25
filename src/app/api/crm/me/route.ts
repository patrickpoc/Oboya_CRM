import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePermissions } from "@/lib/crm/permissions/access-resolve";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { LOCALE_COOKIE, locales } from "@/i18n/routing";

export async function GET() {
  const guard = await crmGuard(undefined, "view", { allowPasswordChangePending: true });
  if (guard instanceof NextResponse) return guard;

  const { data: profile } = await guard.supabase
    .from("crm_users")
    .select("title, phone")
    .eq("id", guard.user.id)
    .maybeSingle<{ title: string | null; phone: string | null }>();
  return NextResponse.json({
    ok: true,
    user: guard.user,
    profile: { title: profile?.title ?? null, phone: profile?.phone ?? null },
    permissions: resolvePermissions(guard.user, guard.matrix),
  });
}

const patchSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(60).optional(),
    locale: z.enum(locales).optional(),
  })
  .strict()
  .refine(
    (v) => v.fullName !== undefined || v.title !== undefined || v.phone !== undefined || v.locale !== undefined,
    { message: "Nothing to update" }
  );

export async function PATCH(request: Request) {
  const guard = await crmGuard(undefined, "view", { allowPasswordChangePending: true });
  if (guard instanceof NextResponse) return guard;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { fullName, title, phone, locale } = parsed.data;

  // User-scoped client: RLS + crm_users_guard limit self-updates to these columns.
  const { error } = await guard.supabase
    .from("crm_users")
    .update({
      ...(fullName !== undefined ? { full_name: fullName } : {}),
      ...(title !== undefined ? { title: title || null } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
      ...(locale !== undefined ? { locale } : {}),
    })
    .eq("id", guard.user.id);
  if (error) {
    console.error("Profile update failed:", error.message);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  const user = {
    ...guard.user,
    ...(fullName !== undefined ? { fullName } : {}),
    ...(locale !== undefined ? { locale } : {}),
  };
  const response = NextResponse.json({
    ok: true,
    user,
    permissions: resolvePermissions(user, guard.matrix),
  });
  if (locale) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      secure: new URL(request.url).protocol === "https:",
    });
  }
  return response;
}
