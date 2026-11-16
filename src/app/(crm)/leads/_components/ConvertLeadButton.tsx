"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/components/crm/record/api";
import { LookupCombobox } from "@/components/crm/record/LookupCombobox";
import { useCrm } from "@/contexts/CrmContext";
import {
  CONVERT_CURRENCIES,
  convertLeadSchema,
  convertTarget,
  defaultOpportunityName,
  type ConvertLeadInput,
  type ConvertResult,
} from "@/lib/crm/leads/convert";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 w-full rounded-md border bg-white px-2 text-sm text-oboya-blue-dark outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

const KNOWN_ERRORS = [
  "already_converted",
  "account_not_found",
  "no_open_stage",
  "forbidden",
  "not_found",
  "duplicate",
  "invalid",
] as const;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 864e5).toISOString().slice(0, 10);
}

/**
 * Header action on a lead (hidden once converted). Creates or links an
 * Account, always creates the Contact, optionally an Opportunity, via
 * POST /api/crm/leads/:id/convert, then opens the new opportunity or account.
 */
export function ConvertLeadButton({
  leadId,
  leadName,
  company,
  defaultCurrency,
}: {
  leadId: string;
  leadName: string;
  company: string | null;
  defaultCurrency: string;
}) {
  const t = useTranslations("leads.convert");
  const router = useRouter();
  const { can } = useCrm();
  const canNewAccount = can("accounts", "create");
  const canOpportunity = can("opportunities", "create");

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">(canNewAccount ? "new" : "existing");
  const [account, setAccount] = useState<{ id: string | null; label?: string }>({ id: null });
  const [withOpp, setWithOpp] = useState(canOpportunity);
  const [oppName, setOppName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(
    (CONVERT_CURRENCIES as readonly string[]).includes(defaultCurrency) ? defaultCurrency : "USD"
  );
  const [closeDate, setCloseDate] = useState("");

  if (!can("leads", "convert")) return null;

  const start = () => {
    const now = new Date();
    setOppName(defaultOpportunityName(company, leadName, now));
    setCloseDate(addDays(now, 90));
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    const input: ConvertLeadInput = {
      account: mode === "existing" ? { mode, accountId: account.id ?? "" } : { mode: "new" },
      opportunity: withOpp ? { name: oppName, amount, currency: currency as never, closeDate: closeDate || null } : null,
    };
    const parsed = convertLeadSchema.safeParse(input);
    if (!parsed.success) {
      setError(t(mode === "existing" && !account.id ? "errors.accountRequired" : "errors.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { result } = await apiFetch<{ result: ConvertResult }>(`/api/crm/leads/${leadId}/convert`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      toast.success(t("success"));
      setOpen(false);
      router.push(convertTarget(result));
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "unavailable";
      setError(t(`errors.${(KNOWN_ERRORS as readonly string[]).includes(code) ? code : "unavailable"}`));
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90" onClick={start}>
        <ArrowRightLeft /> {t("action")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { name: leadName })}</DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-oboya-blue-dark">{t("account.heading")}</legend>
            <label className={cn("flex items-center gap-2 text-sm", !canNewAccount && "opacity-50")}>
              <input
                type="radio"
                name="convert-account"
                checked={mode === "new"}
                disabled={!canNewAccount}
                onChange={() => setMode("new")}
              />
              {t("account.new", { name: company?.trim() || leadName })}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="convert-account" checked={mode === "existing"} onChange={() => setMode("existing")} />
              {t("account.existing")}
            </label>
            {mode === "existing" ? (
              <LookupCombobox
                id="convert-account"
                object="account"
                value={account.id}
                label={account.label}
                onChange={(id, label) => setAccount({ id, label })}
              />
            ) : null}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold text-oboya-blue-dark">{t("contact.heading")}</legend>
            <p className="text-sm text-muted-foreground">{t("contact.note", { name: leadName })}</p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-oboya-blue-dark">{t("opportunity.heading")}</legend>
            <label className={cn("flex items-center gap-2 text-sm", !canOpportunity && "opacity-50")}>
              <Checkbox checked={withOpp} disabled={!canOpportunity} onCheckedChange={(v) => setWithOpp(Boolean(v))} />
              {t("opportunity.create")}
            </label>
            {withOpp ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="convert-opp-name">{t("opportunity.name")}</Label>
                  <Input id="convert-opp-name" value={oppName} maxLength={200} onChange={(e) => setOppName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="convert-amount">{t("opportunity.amount")}</Label>
                  <Input
                    id="convert-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="convert-currency">{t("opportunity.currency")}</Label>
                  <select
                    id="convert-currency"
                    className={selectClass}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CONVERT_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="convert-close">{t("opportunity.closeDate")}</Label>
                  <Input id="convert-close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
                </div>
              </div>
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm font-medium text-oboya-orange">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90" onClick={submit} disabled={busy}>
              {busy ? t("converting") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
