"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AuthCard, FormError } from "../_components/AuthCard";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!isSupabaseConfigured()) {
      setError(t("unavailable"));
      return;
    }
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
    // The result is not shown, so the form does not reveal which emails exist.
    await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setLoading(false);
    setSent(true);
  };

  return (
    <AuthCard brand={t("brand")} title={t("forgotTitle")} subtitle={t("forgotSubtitle")}>
      {sent ? (
        <p className="mt-6 text-sm text-oboya-green" role="status">
          {t("forgotSent")}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full rounded-full" disabled={loading}>
            {loading ? t("sending") : t("sendResetLink")}
          </Button>
        </form>
      )}
      <Link
        href="/login"
        className="mt-4 block text-center text-sm text-oboya-green hover:underline"
      >
        {t("backToLogin")}
      </Link>
    </AuthCard>
  );
}
