"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_AFTER_LOGIN } from "@/lib/supabase/safe-next";
import { AuthCard, FormError, hardNavigate } from "../_components/AuthCard";

type Step =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "challenge"; factorId: string }
  | { kind: "error" };

/** Supabase returns the QR as an SVG string or an SVG data URL. */
function qrSrc(qr: string) {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`;
}

export function MfaForm() {
  const t = useTranslations("auth");
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mfa = createClient().auth.mfa;
      const { data: aal } = await mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") return hardNavigate(DEFAULT_AFTER_LOGIN);

      const { data: factors, error: listError } = await mfa.listFactors();
      if (listError) return !cancelled && setStep({ kind: "error" });
      const verified = factors.totp[0];
      if (verified) {
        return !cancelled && setStep({ kind: "challenge", factorId: verified.id });
      }
      // Drop half-finished enrollments so a fresh one can be created.
      for (const f of factors.all) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await mfa.unenroll({ factorId: f.id });
        }
      }
      const { data: enrolled, error: enrollError } = await mfa.enroll({
        factorType: "totp",
        friendlyName: "Oboya CRM",
      });
      if (cancelled) return;
      if (enrollError || !enrolled) return setStep({ kind: "error" });
      setStep({
        kind: "enroll",
        factorId: enrolled.id,
        qr: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      });
    })().catch(() => !cancelled && setStep({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step.kind !== "enroll" && step.kind !== "challenge") return;
    setError(null);
    setLoading(true);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: step.factorId,
      code: code.trim(),
    });
    if (verifyError) {
      setError(t("mfaInvalidCode"));
      setLoading(false);
      return;
    }
    hardNavigate(DEFAULT_AFTER_LOGIN);
  };

  const signOut = async () => {
    await createClient().auth.signOut();
    hardNavigate("/login");
  };

  const subtitle =
    step.kind === "enroll" ? t("mfaEnrollSubtitle") : step.kind === "challenge" ? t("mfaChallengeSubtitle") : undefined;

  return (
    <AuthCard brand={t("brand")} title={t("mfaTitle")} subtitle={subtitle}>
      {step.kind === "loading" ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("mfaLoading")}</p>
      ) : step.kind === "error" ? (
        <FormError message={t("mfaUnavailable")} />
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {step.kind === "enroll" ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img
                src={qrSrc(step.qr)}
                alt={t("mfaQrAlt")}
                width={176}
                height={176}
                className="mx-auto rounded-lg border border-border/60 bg-white p-2"
              />
              <p className="text-xs text-muted-foreground">{t("mfaSecretLabel")}</p>
              <code className="block break-all rounded-md bg-oboya-soft-white px-2 py-1 text-xs text-oboya-blue-dark">
                {step.secret}
              </code>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="code">{t("mfaCode")}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full rounded-full" disabled={loading}>
            {loading ? t("mfaVerifying") : t("mfaVerify")}
          </Button>
        </form>
      )}
      <button
        type="button"
        onClick={signOut}
        className="mt-4 block w-full text-center text-sm text-oboya-green hover:underline"
      >
        {t("signOut")}
      </button>
    </AuthCard>
  );
}
