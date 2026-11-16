"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import type { Option } from "@/lib/crm/objects/types";

/**
 * Asks for a loss reason (picklist `loss_reason`) and an optional note before
 * moving an opportunity to a lost stage. Used by the record path and the kanban.
 * Mount it only while open (state resets on each open).
 */
export function ClosedLostDialog({
  stageLabel,
  name,
  reasons,
  initialReason,
  initialNote,
  onCancel,
  onConfirm,
}: {
  stageLabel: string;
  name: string;
  reasons: Option[];
  initialReason?: string | null;
  initialNote?: string | null;
  onCancel: () => void;
  /** Resolves when done; the dialog stays open (busy) until then. */
  onConfirm: (reason: string, note: string | null) => Promise<void> | void;
}) {
  const t = useTranslations("opportunities.lostDialog");
  const tr = useTranslations("record.actions");
  const [reason, setReason] = useState(initialReason ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!reason) return;
    setBusy(true);
    try {
      await onConfirm(reason, note.trim() || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("title", { stage: stageLabel })}</DialogTitle>
            <DialogDescription>{t("description", { name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="loss-reason">
              {t("reason")} <span className="text-oboya-orange">*</span>
            </Label>
            <select
              id="loss-reason"
              required
              value={reason}
              aria-invalid={touched && !reason ? true : undefined}
              onChange={(e) => setReason(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm text-oboya-blue-dark aria-invalid:border-oboya-orange"
            >
              <option value="">{t("reasonPlaceholder")}</option>
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {touched && !reason ? <p className="text-xs text-oboya-orange">{t("reasonRequired")}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loss-note">{t("note")}</Label>
            <Textarea id="loss-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-full" onClick={onCancel} disabled={busy}>
              {tr("cancel")}
            </Button>
            <Button type="submit" className="rounded-full bg-oboya-orange text-white hover:bg-oboya-orange/90" disabled={busy}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
