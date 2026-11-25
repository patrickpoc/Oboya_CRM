"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { hardNavigate } from "@/app/(auth)/_components/AuthCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRM_LOCALE_OPTIONS } from "@/contexts/CrmLocaleContext";
import type { Locale } from "@/i18n/routing";

export type CasdoorLinkState = {
  approval: {
    status: "pending" | "rejected" | "revoked";
    createdAt: string;
    email: string;
    displayName: string;
  } | null;
  linked: boolean;
  sub: string | null;
  linkedAt: string | null;
  email: string | null;
  displayName: string | null;
  title: string | null;
  country: string | null;
  countryCode: string | null;
  location: string | null;
  phone: string | null;
  region: string | null;
  company: string | null;
  canUnlink: boolean;
};

const LINK_ERRORS: Record<string, string> = {
  conflict: "linkConflict",
  already_linked: "alreadyLinked",
  not_found: "loadFailed",
  unavailable: "loadFailed",
  casdoor: "linkFailed",
  oauth_state: "linkStateExpired",
  oauth_session: "linkSessionLost",
  oauth_token: "linkTokenFailed",
  oauth_profile: "linkProfileFailed",
  pending_approval: "linkPendingHint",
  access_rejected: "linkRejectedHint",
  domain_not_allowed: "linkDomainNotAllowed",
  account_type_not_allowed: "linkAccountTypeNotAllowed",
  organization_not_allowed: "linkOrganizationNotAllowed",
};

export function ProfileSettings({
  initialFullName,
  initialTitle,
  initialPhone,
  initialCountryCode,
  initialCompany,
  initialLocale,
  initialLink,
  notice,
}: {
  initialFullName: string;
  initialTitle: string | null;
  initialPhone: string | null;
  initialCountryCode: string | null;
  initialCompany: string | null;
  initialLocale: Locale;
  initialLink: CasdoorLinkState;
  notice: { linked?: boolean; linkPending?: boolean; error?: string };
}) {
  const t = useTranslations("profile");
  const [fullName, setFullName] = useState(initialFullName);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [company, setCompany] = useState(initialCompany);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [link, setLink] = useState(initialLink);
  const [savingProfile, setSavingProfile] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (notice.linked) toast.success(t("linkDone"));
    if (notice.linkPending) toast.info(t("linkPendingHint"));
    if (notice.error && LINK_ERRORS[notice.error]) {
      toast.error(t(LINK_ERRORS[notice.error]));
    }
  }, [notice.linked, notice.linkPending, notice.error, t]);

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const response = await fetch("/api/crm/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-crm-quiet": "1" },
        body: JSON.stringify({ fullName, title, phone, locale }),
      });
      if (!response.ok) throw new Error("save failed");
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSavingProfile(false);
    }
  };

  const syncCasdoor = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/crm/me/casdoor", { method: "PATCH" });
      if (!response.ok) throw new Error("sync failed");
      const data = (await response.json()) as {
        fullName: string;
        title: string | null;
        phone: string | null;
        countryCode: string | null;
        company: string | null;
      };
      setFullName(data.fullName);
      setTitle(data.title ?? "");
      setPhone(data.phone ?? "");
      setCountryCode(data.countryCode);
      setCompany(data.company);
      toast.success(t("syncDone"));
    } catch {
      toast.error(t("syncFailed"));
    } finally {
      setBusy(false);
    }
  };

  const unlinkCasdoor = async () => {
    if (!window.confirm(t("unlinkConfirm"))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/crm/me/casdoor", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (data.error === "no_password") toast.error(t("noPasswordHint"));
        else toast.error(t("unlinkFailed"));
        return;
      }
      setLink((current) => ({
        ...current,
        linked: false,
        sub: null,
        email: null,
        displayName: null,
        title: null,
        country: null,
        countryCode: null,
        location: null,
        phone: null,
        region: null,
        company: null,
        linkedAt: null,
      }));
      toast.success(t("unlinkDone"));
    } catch {
      toast.error(t("unlinkFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-oboya-blue-dark">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("profileTitle")}</CardTitle>
          <CardDescription>{t("profileDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">{t("fullName")}</Label>
              <Input
                id="profile-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-title">{t("jobTitle")}</Label>
                <Input
                  id="profile-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-phone">{t("phone")}</Label>
                <Input
                  id="profile-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={60}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-country-code">{t("importedCountry")}</Label>
                <Input id="profile-country-code" value={countryCode ?? ""} readOnly />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-company">{t("importedCompany")}</Label>
                <Input id="profile-company" value={company ?? ""} readOnly />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-locale">{t("language")}</Label>
              <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                <SelectTrigger id="profile-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRM_LOCALE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? t("saving") : t("save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t("casdoorTitle")}</CardTitle>
            <Badge variant={link.linked ? "default" : "secondary"}>
              {link.linked ? t("linked") : t("notLinked")}
            </Badge>
          </div>
          <CardDescription>{t("casdoorDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {link.approval?.status === "pending" ? (
            <p className="rounded-lg border border-oboya-orange/40 bg-oboya-orange/5 px-3 py-2 text-xs text-oboya-orange">
              {t("linkPendingHint")}
            </p>
          ) : null}
          {link.approval?.status === "rejected" ? (
            <p className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              {t("linkRejectedHint")}
            </p>
          ) : null}
          {link.approval?.status === "revoked" ? (
            <p className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              {t("linkRevokedHint")}
            </p>
          ) : null}
          {link.linked ? (
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("importedEmail")}</dt>
                <dd className="truncate font-medium">{link.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("importedName")}</dt>
                <dd className="font-medium">{link.displayName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("importedCountry")}</dt>
                <dd className="font-medium">
                  {[link.country, link.countryCode, link.location, link.region].filter(Boolean).join(" / ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("importedPhone")}</dt>
                <dd className="font-medium">{link.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("importedCompany")}</dt>
                <dd className="font-medium">{link.company ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("linkedAt")}</dt>
                <dd className="font-medium">
                  {link.linkedAt ? new Date(link.linkedAt).toLocaleString() : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t("notLinkedHint")}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {link.linked ? (
              <>
                <Button type="button" variant="outline" onClick={syncCasdoor} disabled={busy}>
                  {t("syncButton")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={unlinkCasdoor}
                  disabled={busy || !link.canUnlink}
                  title={link.canUnlink ? undefined : t("noPasswordHint")}
                >
                  {t("unlinkButton")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={link.approval?.status === "pending"}
                onClick={() => hardNavigate("/api/auth/casdoor/login?intent=link&next=%2Fprofile")}
              >
                {t("linkButton")}
              </Button>
            )}
          </div>
          {link.linked && !link.canUnlink ? (
            <p className="text-xs text-muted-foreground">{t("noPasswordHint")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
