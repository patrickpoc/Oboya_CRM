import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RECOVERY_COOKIE } from "@/lib/supabase/recovery";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("resetTitle") };
}

/**
 * Only for recovery sessions (marker set by /auth/callback for this user).
 * A normal session changes its password on /change-password (current password required).
 */
export default async function ResetPasswordPage() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login?error=auth");
    const marker = (await cookies()).get(RECOVERY_COOKIE)?.value;
    if (marker !== user.id) redirect("/change-password");
  }
  return <ResetPasswordForm />;
}
