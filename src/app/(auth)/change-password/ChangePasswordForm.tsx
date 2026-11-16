"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_AFTER_LOGIN } from "@/lib/supabase/safe-next";
import { AuthCard, FormError, hardNavigate } from "../_components/AuthCard";

const API_ERRORS = {
  wrong_current_password: "wrongCurrentPassword",
  same_password: "samePassword",
  rate_limited: "rateLimited",
} as const;

export function ChangePasswordForm() {
  const t = useTranslations("auth");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t("passwordMinLength"));
    if (password !== confirm) return setError(t("passwordsDoNotMatch"));

    setLoading(true);
    try {
      const res = await fetch("/api/crm/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        // AAL2 required first (CRM_REQUIRE_MFA): verify, then come back here.
        if (data.code === "mfa") return hardNavigate("/mfa");
        const key = API_ERRORS[data.error as keyof typeof API_ERRORS];
        setError(t(key ?? "updatePasswordFailed"));
        setLoading(false);
        return;
      }
      // Pick up the cleared must_change_password flag before the proxy runs.
      await createClient().auth.refreshSession();
      hardNavigate(DEFAULT_AFTER_LOGIN);
    } catch {
      setError(t("updatePasswordFailed"));
      setLoading(false);
    }
  };

  return (
    <AuthCard brand={t("brand")} title={t("changeTitle")} subtitle={t("changeSubtitle")}>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="current">{t("currentPassword")}</Label>
          <Input
            id="current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
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
          {loading ? t("saving") : t("savePasswordContinue")}
        </Button>
      </form>
    </AuthCard>
  );
}
