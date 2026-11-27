"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Check, CheckCircle2, Plus, Trash2, X } from "lucide-react";
import { ApiError, apiFetch } from "@/components/crm/common/api";
import { selectClass } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { EmailAccount, EmailPreset, EmailProviderId } from "@/lib/crm/email/types";
import { EMAIL_ACCOUNT_COLORS as COLORS, EMAIL_ACCOUNT_COLOR_NAMES, emailAccountColor } from "@/lib/crm/email/colors";

type FormState = {
  id?: string;
  label: string;
  email: string;
  provider: EmailProviderId;
  username: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  smtpSecure: boolean;
  imapSecure: boolean;
  color: string;
  enabled: boolean;
};

type Channel = "imap" | "smtp";
type ChannelStatus = "ok" | "auth" | "host" | "refused" | "timeout" | "tls" | "unknown";
type TestResult = { ok: true } | { ok: false; imap: ChannelStatus; smtp: ChannelStatus };

const CHANNEL_STATUSES: readonly ChannelStatus[] = ["ok", "auth", "host", "refused", "timeout", "tls", "unknown"];

function channelStatus(value: unknown): ChannelStatus {
  return CHANNEL_STATUSES.find((status) => status === value) ?? "unknown";
}

function blank(presets: readonly EmailPreset[]): FormState {
  const preset = presets[0];
  return {
    label: "",
    email: "",
    provider: preset?.id ?? "custom",
    username: "",
    password: "",
    smtpHost: preset?.smtpHost ?? "",
    smtpPort: preset?.smtpPort ?? 465,
    imapHost: preset?.imapHost ?? "",
    imapPort: preset?.imapPort ?? 993,
    smtpSecure: preset?.secure ?? true,
    imapSecure: preset?.secure ?? true,
    color: COLORS[0],
    enabled: true,
  };
}

function formFromAccount(account: EmailAccount): FormState {
  return {
    id: account.id,
    label: account.label,
    email: account.email,
    provider: account.provider,
    username: account.username,
    password: "",
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    smtpSecure: account.smtpSecure,
    imapSecure: account.imapSecure,
    color: emailAccountColor(account.color),
    enabled: account.enabled,
  };
}

function completeEmail(form: FormState, presets: readonly EmailPreset[]): string {
  const value = form.email.trim();
  if (value.includes("@")) return value;
  const suffix = presets.find((preset) => preset.id === form.provider)?.emailSuffix;
  return suffix ? `${value}${suffix}` : value;
}

export function EmailAccountEditor({
  presets,
  accounts,
  canEdit,
  onChanged,
}: {
  presets: readonly EmailPreset[];
  accounts: EmailAccount[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("email");
  const [form, setForm] = useState<FormState>(() => blank(presets));
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- presets load after mount; seed the blank form once
    setForm((current) => (current.id ? current : blank(presets)));
  }, [presets]);

  const disabled = !canEdit || busy;
  const preset = presets.find((entry) => entry.id === form.provider);
  const emailPlaceholder = preset ? `sales${preset.emailSuffix}` : t("account.emailPlaceholder");
  const completed = completeEmail(form, presets);
  const usernamePlaceholder = completed.includes("@") ? completed : emailPlaceholder;

  const patch = (next: Partial<FormState>) => {
    setTestResult(null);
    setForm((current) => ({ ...current, ...next }));
  };

  const reset = () => {
    setForm(blank(presets));
    setAdvanced(false);
    setTestResult(null);
  };

  const applyPreset = (id: EmailProviderId) => {
    const next = presets.find((entry) => entry.id === id);
    if (!next) {
      patch({ provider: "custom" });
      setAdvanced(true);
      return;
    }
    patch({
      provider: next.id,
      smtpHost: next.smtpHost,
      smtpPort: next.smtpPort,
      imapHost: next.imapHost,
      imapPort: next.imapPort,
      smtpSecure: next.secure,
      imapSecure: next.secure,
    });
    setAdvanced(false);
  };

  const payload = () => {
    const email = completeEmail(form, presets);
    return {
      ...form,
      id: form.id,
      label: form.label.trim() || email.split("@")[0] || "Mailbox",
      email,
      username: form.username.trim() || email,
      password: form.password || undefined,
    };
  };

  const saveErrorMessage = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.code === "duplicate") return t("account.duplicate");
      if (error.code === "invalid_input") return error.fields?.password ? t("account.passwordRequired") : t("errors.invalid");
      if (error.code === "not_found") return t("errors.notFound");
      return error.message || t("errors.failed");
    }
    return t("errors.failed");
  };

  const run = async (url: string, method: "PUT" | "DELETE") => {
    setBusy(true);
    try {
      await apiFetch(url, { method, body: method === "PUT" ? JSON.stringify(payload()) : undefined });
      toast.success(method === "DELETE" ? t("account.remove") : t("account.saved"));
      reset();
      await onChanged();
      return true;
    } catch (error) {
      toast.error(saveErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      await apiFetch("/api/crm/email/test", { method: "PUT", body: JSON.stringify(payload()) });
      setTestResult({ ok: true });
      toast.success(t("account.tested"));
    } catch (error) {
      if (error instanceof ApiError && error.code === "connection_failed") {
        setTestResult({ ok: false, imap: channelStatus(error.fields?.imap), smtp: channelStatus(error.fields?.smtp) });
      } else if (error instanceof ApiError && error.code === "invalid_input") {
        toast.error(error.fields?.password ? t("account.passwordRequired") : t("errors.invalid"));
      } else {
        toast.error(t("account.testFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const channelRow = (channel: Channel, status: ChannelStatus) => (
    <li key={channel} className="flex items-start gap-2 text-sm">
      {status === "ok" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-oboya-green" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-oboya-orange" />
      )}
      <span>
        <span className="font-medium text-oboya-blue-dark">{t(`account.channel.${channel}`)}: </span>
        <span className={status === "ok" ? "text-oboya-green" : "text-foreground"}>{t(`account.testErrors.${status}`)}</span>
      </span>
    </li>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="rounded-xl border-border/60 bg-white">
        <CardHeader>
          <CardTitle className="text-base text-oboya-blue-dark">
            {form.id ? t("account.editing", { email: form.email }) : t("account.title")}
          </CardTitle>
          <CardDescription>{t("account.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-provider">{t("account.provider")}</Label>
            <select
              id="email-provider"
              className={selectClass}
              value={form.provider}
              disabled={disabled}
              onChange={(event) => applyPreset(event.target.value as EmailProviderId)}
            >
              {presets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.labelKey)}
                </option>
              ))}
              <option value="custom">{t("account.custom")}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {form.provider === "custom" ? t("account.customHint") : t(`account.providerHint.${form.provider}`)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-address">{t("account.email")}</Label>
              <Input
                id="email-address"
                type="email"
                autoComplete="off"
                value={form.email}
                disabled={disabled}
                onChange={(event) => patch({ email: event.target.value })}
                placeholder={emailPlaceholder}
              />
              {preset ? <p className="text-xs text-muted-foreground">{t("account.emailHint", { suffix: preset.emailSuffix })}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-label">{t("account.label")}</Label>
              <Input
                id="email-label"
                value={form.label}
                disabled={disabled}
                onChange={(event) => patch({ label: event.target.value })}
                placeholder={t("account.labelPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("account.labelHint")}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-password">{t("account.password")}</Label>
              <Input
                id="email-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                disabled={disabled}
                onChange={(event) => patch({ password: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{form.id ? t("account.passwordHint") : t("account.passwordHintNew")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-username">{t("account.username")}</Label>
              <Input
                id="email-username"
                autoComplete="off"
                value={form.username}
                disabled={disabled}
                onChange={(event) => patch({ username: event.target.value })}
                placeholder={usernamePlaceholder}
              />
              <p className="text-xs text-muted-foreground">{t("account.usernameHint")}</p>
            </div>
          </div>

          <details
            open={advanced}
            onToggle={(event) => setAdvanced(event.currentTarget.open)}
            className="rounded-lg border border-border/60 bg-oboya-soft-white/60 px-3 py-2"
          >
            <summary className="cursor-pointer text-sm font-medium text-oboya-blue-dark">
              {t("account.advanced")}
              <span className="ml-2 font-normal text-muted-foreground">
                {form.imapHost || "—"}:{form.imapPort} · {form.smtpHost || "—"}:{form.smtpPort}
              </span>
            </summary>
            <div className="mt-3 space-y-4">
              <p className="text-xs text-muted-foreground">{t("account.advancedHint")}</p>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("account.channel.imap")}</legend>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor="imap-host">{t("account.imapHost")}</Label>
                    <Input id="imap-host" value={form.imapHost} disabled={disabled} placeholder="mail.example.com" onChange={(event) => patch({ imapHost: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="imap-port">{t("account.imapPort")}</Label>
                    <Input id="imap-port" type="number" inputMode="numeric" value={form.imapPort} disabled={disabled} onChange={(event) => patch({ imapPort: Number(event.target.value) })} />
                  </div>
                </div>
                <label className={cn("flex items-center gap-2 text-sm", disabled && "pointer-events-none opacity-50")}>
                  <Switch checked={form.imapSecure} onCheckedChange={(value) => patch({ imapSecure: value, imapPort: value ? 993 : 143 })} />
                  {t("account.secure")}
                </label>
                <p className="text-xs text-muted-foreground">{t("account.secureHint", { on: 993, off: 143 })}</p>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("account.channel.smtp")}</legend>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-host">{t("account.smtpHost")}</Label>
                    <Input id="smtp-host" value={form.smtpHost} disabled={disabled} placeholder="smtp.example.com" onChange={(event) => patch({ smtpHost: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-port">{t("account.smtpPort")}</Label>
                    <Input id="smtp-port" type="number" inputMode="numeric" value={form.smtpPort} disabled={disabled} onChange={(event) => patch({ smtpPort: Number(event.target.value) })} />
                  </div>
                </div>
                <label className={cn("flex items-center gap-2 text-sm", disabled && "pointer-events-none opacity-50")}>
                  <Switch checked={form.smtpSecure} onCheckedChange={(value) => patch({ smtpSecure: value, smtpPort: value ? 465 : 587 })} />
                  {t("account.secure")}
                </label>
                <p className="text-xs text-muted-foreground">{t("account.secureHint", { on: 465, off: 587 })}</p>
              </fieldset>
            </div>
          </details>

          <div className="space-y-1.5">
            <Label>{t("account.color")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((color) => {
                const name = t(`account.colors.${EMAIL_ACCOUNT_COLOR_NAMES[color]}`);
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={name}
                    title={name}
                    aria-pressed={form.color === color}
                    disabled={disabled}
                    className={cn("size-6 rounded-full border-2 ring-1 ring-border/60", form.color === color ? "border-oboya-blue-dark" : "border-transparent")}
                    style={{ backgroundColor: color }}
                    onClick={() => patch({ color })}
                  />
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("account.colorHint")}</p>
          </div>

          {testResult ? (
            <div
              role="status"
              className={cn(
                "rounded-lg border px-3 py-2",
                testResult.ok ? "border-oboya-green/40 bg-oboya-green/10" : "border-oboya-orange/40 bg-oboya-orange/10"
              )}
            >
              {testResult.ok ? (
                <p className="flex items-center gap-2 text-sm text-oboya-green">
                  <CheckCircle2 className="size-4" /> {t("account.tested")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {channelRow("imap", testResult.imap)}
                  {channelRow("smtp", testResult.smtp)}
                </ul>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="rounded-full" disabled={disabled} onClick={() => void test()}>
              <Check className="size-4" /> {t("actions.test")}
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={disabled}
              onClick={() => void run("/api/crm/email/accounts", "PUT")}
            >
              <Plus className="size-4" /> {form.id ? t("account.save") : t("actions.addAccount")}
            </Button>
            {form.id ? (
              <Button size="sm" variant="ghost" className="rounded-full" disabled={busy} onClick={reset}>
                <X className="size-4" /> {t("account.cancelEdit")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("account.afterSave")}</p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {accounts.map((account) => (
          <Card key={account.id} className="rounded-xl border-border/60 bg-white">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: account.color }} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-oboya-blue-dark">{account.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={disabled}
                  onClick={() => {
                    setTestResult(null);
                    setAdvanced(account.provider === "custom");
                    setForm(formFromAccount(account));
                  }}
                >
                  {t("actions.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-destructive"
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm(t("account.removeConfirm"))) void run(`/api/crm/email/accounts/${account.id}`, "DELETE");
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
