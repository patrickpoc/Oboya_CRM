"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { safeNext } from "@/lib/supabase/safe-next";
import { AuthCard, FormError, hardNavigate } from "../_components/AuthCard";

const ERROR_KEYS = {
  auth: "authFailed",
  inactive: "errorInactive",
  unavailable: "unavailable",
} as const;

export function LoginForm() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error") as keyof typeof ERROR_KEYS | null;
  const initialError = errorParam && ERROR_KEYS[errorParam] ? t(ERROR_KEYS[errorParam]) : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  // A session that the CRM rejected (disabled user) is dropped.
  useEffect(() => {
    if (configured && errorParam === "inactive") {
      void createClient().auth.signOut();
    }
  }, [configured, errorParam]);

  if (!configured) {
    return (
      <AuthCard brand={t("brand")} title={t("signInTitle")}>
        <p className="mt-6 text-sm text-muted-foreground">{t("unavailable")}</p>
      </AuthCard>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    // Drop any previous session before signing in as this account.
    await supabase.auth.signOut();

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError || !data.user) {
      setError(t("invalidCredentials"));
      setLoading(false);
      return;
    }

    if (data.user.app_metadata?.must_change_password === true) {
      hardNavigate("/change-password");
      return;
    }
    hardNavigate(safeNext(searchParams.get("next")));
  };

  return (
    <AuthCard brand={t("brand")} title={t("signInTitle")} subtitle={t("signInSubtitle")}>
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link href="/forgot-password" className="text-xs text-oboya-green hover:underline">
              {t("forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full rounded-full" disabled={loading}>
          {loading ? t("signingIn") : t("signIn")}
        </Button>
      </form>
    </AuthCard>
  );
}
