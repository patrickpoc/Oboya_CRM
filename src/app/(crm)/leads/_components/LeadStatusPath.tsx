"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleSlash, PartyPopper } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, useApiErrorMessage } from "@/components/crm/record/api";
import { RecordPath } from "@/components/crm/record/RecordPath";
import { useCrm } from "@/contexts/CrmContext";
import { LEAD_PATH, type LeadStatusInput } from "@/lib/crm/leads/status";
import { cn } from "@/lib/utils";

type LinkRef = { id: string; name: string } | null;

/**
 * Lead path: New → Working → Qualified, with Unqualified as a terminal branch
 * (asks for a reason). Converted leads show a banner and a locked path.
 * Writes go through POST /api/crm/leads/:id/status; router.refresh() reloads
 * the record (its updated_at refreshes the activity timeline).
 */
export function LeadStatusPath({
  leadId,
  status,
  unqualifiedReason,
  convertedAt,
  account,
  contact,
  opportunity,
}: {
  leadId: string;
  status: string;
  unqualifiedReason: string | null;
  convertedAt: string | null;
  account: LinkRef;
  contact: LinkRef;
  opportunity: LinkRef;
}) {
  const t = useTranslations("leads");
  const router = useRouter();
  const { can } = useCrm();
  const errorMessage = useApiErrorMessage();
  const [busy, setBusy] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  const converted = Boolean(convertedAt);
  const locked = converted || !can("leads", "edit") || busy;
  const unqualified = status === "unqualified";

  const save = async (input: LeadStatusInput) => {
    setBusy(true);
    try {
      await apiFetch(`/api/crm/leads/${leadId}/status`, { method: "POST", body: JSON.stringify(input) });
      toast.success(t("path.saved"));
      router.refresh();
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const links = [
    { key: "account", href: account ? `/accounts/${account.id}` : null, label: account?.name, title: t("banner.account") },
    { key: "contact", href: contact ? `/contacts/${contact.id}` : null, label: contact?.name, title: t("banner.contact") },
    {
      key: "opportunity",
      href: opportunity ? `/opportunities/${opportunity.id}` : null,
      label: opportunity?.name,
      title: t("banner.opportunity"),
    },
  ].filter((l) => l.href);

  return (
    <div className="space-y-3">
      {converted ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-oboya-green/40 bg-oboya-green/10 p-3 text-sm text-oboya-blue-dark sm:flex-row sm:items-center"
        >
          <span className="flex items-center gap-2 font-semibold">
            <PartyPopper className="size-4 text-oboya-green" aria-hidden />
            {t("banner.title")}
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {links.map((l) => (
              <span key={l.key}>
                <span className="text-muted-foreground">{l.title}: </span>
                <Link href={l.href!} className="font-medium text-oboya-blue-light hover:underline">
                  {l.label || "—"}
                </Link>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <RecordPath
          className="min-w-0 flex-1"
          steps={LEAD_PATH.map((value) => ({
            value,
            label: t(`statuses.${value}`),
            kind: value === "qualified" ? "won" : "open",
          }))}
          current={unqualified ? null : status}
          disabled={locked}
          onStageChange={(value) => void save({ status: value as LeadStatusInput["status"] })}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={locked || unqualified}
          aria-pressed={unqualified}
          title={unqualified && unqualifiedReason ? unqualifiedReason : undefined}
          className={cn(
            "h-9 shrink-0 rounded-full",
            unqualified ? "border-oboya-orange bg-oboya-orange text-white disabled:opacity-100" : "text-oboya-orange"
          )}
          onClick={() => {
            setReason("");
            setReasonOpen(true);
          }}
        >
          <CircleSlash /> {t("statuses.unqualified")}
        </Button>
      </div>
      {unqualified && unqualifiedReason ? (
        <p className="text-xs text-muted-foreground">
          {t("fields.unqualifiedReason")}: <span className="text-oboya-blue-dark">{unqualifiedReason}</span>
        </p>
      ) : null}

      <Dialog open={reasonOpen} onOpenChange={(open) => !open && setReasonOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("unqualifyDialog.title")}</DialogTitle>
            <DialogDescription>{t("unqualifyDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="unqualified-reason">{t("fields.unqualifiedReason")}</Label>
            <Textarea
              id="unqualified-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setReasonOpen(false)} disabled={busy}>
              {t("unqualifyDialog.cancel")}
            </Button>
            <Button
              className="rounded-full bg-oboya-orange text-white hover:bg-oboya-orange/90"
              disabled={busy || reason.trim() === ""}
              onClick={async () => {
                if (await save({ status: "unqualified", unqualifiedReason: reason.trim() })) setReasonOpen(false);
              }}
            >
              {t("unqualifyDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
