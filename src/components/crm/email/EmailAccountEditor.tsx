"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/components/crm/common/api";
import { selectClass } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { EmailAccount, EmailPreset, EmailProviderId } from "@/lib/crm/email/types";
import { EMAIL_ACCOUNT_COLORS as COLORS, emailAccountColor } from "@/lib/crm/email/colors";

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- presets load after mount; seed the blank form once
    setForm((current) => (current.id ? current : blank(presets)));
  }, [presets]);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));

  const applyPreset = (id: EmailProviderId) => {
    const preset = presets.find((entry) => entry.id === id);
    if (!preset) {
      patch({ provider: "custom" });
      return;
    }
    patch({
      provider: preset.id,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      smtpSecure: preset.secure,
      imapSecure: preset.secure,
    });
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

  const run = async (url: string, method: "PUT" | "DELETE") => {
    setBusy(true);
    try {
      await apiFetch(url, { method, body: method === "PUT" ? JSON.stringify(payload()) : undefined });
      toast.success(method === "DELETE" ? t("account.remove") : t("account.saved"));
      setForm(blank(presets));
      await onChanged();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/crm/email/test", { method: "PUT", body: JSON.stringify(payload()) });
      toast.success(t("account.tested"));
    } catch {
      toast.error(t("account.testFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="rounded-xl border-border/60 bg-white">
        <CardHeader>
          <CardTitle className="text-base text-oboya-blue-dark">{t("account.title")}</CardTitle>
          <CardDescription>{t("account.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("account.provider")}</Label>
            <select
              className={selectClass}
              value={form.provider}
              disabled={!canEdit || busy}
              onChange={(event) => applyPreset(event.target.value as EmailProviderId)}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t(preset.labelKey)}
                </option>
              ))}
              <option value="custom">{t("account.custom")}</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("account.label")}</Label>
              <Input value={form.label} disabled={!canEdit || busy} onChange={(event) => patch({ label: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("account.email")}</Label>
              <Input value={form.email} disabled={!canEdit || busy} onChange={(event) => patch({ email: event.target.value })} placeholder="sales@oboya.cc" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("account.username")}</Label>
              <Input value={form.username} disabled={!canEdit || busy} onChange={(event) => patch({ username: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("account.password")}</Label>
              <Input type="password" value={form.password} disabled={!canEdit || busy} onChange={(event) => patch({ password: event.target.value })} />
              <p className="text-xs text-muted-foreground">{t("account.passwordHint")}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("account.smtpHost")}</Label>
              <Input value={form.smtpHost} disabled={!canEdit || busy} onChange={(event) => patch({ smtpHost: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("account.smtpPort")}</Label>
              <Input type="number" value={form.smtpPort} disabled={!canEdit || busy} onChange={(event) => patch({ smtpPort: Number(event.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("account.imapHost")}</Label>
              <Input value={form.imapHost} disabled={!canEdit || busy} onChange={(event) => patch({ imapHost: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("account.imapPort")}</Label>
              <Input type="number" value={form.imapPort} disabled={!canEdit || busy} onChange={(event) => patch({ imapPort: Number(event.target.value) })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className={cn("flex items-center gap-2 text-sm", (!canEdit || busy) && "pointer-events-none opacity-50")}>
              <Switch checked={form.smtpSecure} onCheckedChange={(value) => patch({ smtpSecure: value })} />
              {t("account.useTls")} · SMTP
            </label>
            <label className={cn("flex items-center gap-2 text-sm", (!canEdit || busy) && "pointer-events-none opacity-50")}>
              <Switch checked={form.imapSecure} onCheckedChange={(value) => patch({ imapSecure: value })} />
              {t("account.useTls")} · IMAP
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                disabled={!canEdit || busy}
                className={cn("size-6 rounded-full border-2", form.color === color ? "border-oboya-blue-dark" : "border-transparent")}
                style={{ backgroundColor: color }}
                onClick={() => patch({ color })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!canEdit || busy}
              onClick={() => void test()}
            >
              <Check className="size-4" /> {t("actions.test")}
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={!canEdit || busy}
              onClick={() => void run("/api/crm/email/accounts", "PUT")}
            >
              <Plus className="size-4" /> {form.id ? t("account.save") : t("actions.addAccount")}
            </Button>
          </div>
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
                <Button size="sm" variant="outline" className="rounded-full" disabled={!canEdit || busy} onClick={() => setForm(formFromAccount(account))}>
                  {t("actions.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-destructive"
                  disabled={!canEdit || busy}
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
