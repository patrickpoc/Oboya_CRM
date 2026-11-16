"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AuthCard, FormError, hardNavigate } from "../_components/AuthCard";

/** Reached through /auth/callback, which exchanged the recovery code for a session. */
export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t("passwordMinLength"));
    if (password !== confirm) return setError(t("passwordsDoNotMatch"));
    if (!isSupabaseConfigured()) return setError(t("unavailable"));

    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return setError(t("resetLinkExpired"));
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      return setError(t("updatePasswordFailed"));
    }
    await supabase.auth.signOut();
    toast.success(t("passwordUpdated"));
    hardNavigate("/login");
  };

  return (
    <AuthCard brand={t("brand")} title={t("resetTitle")} subtitle={t("resetSubtitle")}>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("newPassword")}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t("confirmPassword")}</Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full rounded-full" disabled={loading}>
          {loading ? t("updating") : t("updatePassword")}
        </Button>
      </form>
      <Link
        href="/login"
        className="mt-4 block text-center text-sm text-oboya-green hover:underline"
      >
        {t("backToLogin")}
      </Link>
    </AuthCard>
  );
}
