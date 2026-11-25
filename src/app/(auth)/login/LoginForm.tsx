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
  casdoor: "casdoorFailed",
  oauth_state: "casdoorStateExpired",
  oauth_session: "casdoorSessionLost",
  oauth_token: "casdoorTokenFailed",
  oauth_profile: "casdoorProfileFailed",
  casdoor_link: "casdoorLinkConflict",
  pending_approval: "casdoorPendingApproval",
  access_rejected: "casdoorAccessRejected",
  domain_not_allowed: "casdoorDomainNotAllowed",
  account_type_not_allowed: "casdoorAccountTypeNotAllowed",
  organization_not_allowed: "casdoorOrganizationNotAllowed",
  signedout: "signedOut",
} as const;

export function LoginForm({
  casdoorEnabled,
  casdoorSignupUrl,
  signedOut = false,
}: {
  casdoorEnabled: boolean;
  casdoorSignupUrl: string;
  signedOut?: boolean;
}) {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error") as keyof typeof ERROR_KEYS | null;
  const initialError = errorParam && ERROR_KEYS[errorParam]
    ? t(ERROR_KEYS[errorParam])
    : signedOut
      ? t("signedOut")
      : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  // A session that the CRM rejected (disabled user) is dropped.
  useEffect(() => {
    if (configured && (errorParam === "inactive" || errorParam === "signedout")) {
      void createClient().auth.signOut();
    }
    if (signedOut) {
      document.cookie = "casdoor_signed_out=; Max-Age=0; path=/; SameSite=Lax";
    }
  }, [configured, errorParam, signedOut]);

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

    // A successful password sign-in proves the account can sign in without
    // Casdoor, so unlinking the Casdoor account may be allowed later.
    await supabase.auth.updateUser({ data: { has_password: true } });

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

      {casdoorEnabled ? (
        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("orContinueWith")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            onClick={() => hardNavigate(`/api/auth/casdoor/login?next=${encodeURIComponent(safeNext(searchParams.get("next")))}`)}
          >
            {t("signInWithCasdoor")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("noCasdoorAccount")}{" "}
            <a
              href={casdoorSignupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-oboya-green hover:underline"
            >
              {t("signUpCasdoor")}
            </a>
          </p>
        </div>
      ) : null}
    </AuthCard>
  );
}
