"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
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
import { ApiError, apiFetch } from "@/components/crm/record/api";
import { LEAD_ASSIGN_PATH, type LeadAssignPreviewResponse, type LeadAssignResponse } from "@/lib/crm/automation/api-contract";
import { lostAccessAfterAssign } from "@/components/crm/record/lead-assign";
import { useCrm } from "@/contexts/CrmContext";
import type { UserOption } from "@/lib/crm/objects/types";

type Preview = { state: "loading" } | { state: "failed" } | { state: "ready"; ownerId: string | null; via: string };

/** Header action on an unconverted lead: previews who the rules pick, then reassigns. */
export function ReassignLeadButton({ leadId, leadName, users }: { leadId: string; leadName: string; users: UserOption[] }) {
  const t = useTranslations("leads.assignment");
  const router = useRouter();
  const { user } = useCrm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>({ state: "loading" });

  const show = () => {
    setPreview({ state: "loading" });
    setOpen(true);
    apiFetch<LeadAssignPreviewResponse>(`${LEAD_ASSIGN_PATH(leadId)}?preview=1`)
      .then(({ result }) => setPreview({ state: "ready", ownerId: result.ownerId, via: result.via }))
      .catch(() => setPreview({ state: "failed" }));
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<LeadAssignResponse>(LEAD_ASSIGN_PATH(leadId), { method: "POST" });
      toast.success(t("success"));
      setOpen(false);
      const name = users.find((u) => u.value === res.ownerId)?.label;
      const lost = await lostAccessAfterAssign(leadId, res.ownerId, user.id, name, (n) =>
        n ? t("ownedBy", { name: n }) : t("ownedByUnknown")
      );
      if (lost) router.push("/leads");
      else router.refresh();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "";
      const key = code === "lead_converted" ? "converted" : code === "rate_limited" || code === "forbidden" || code === "no_assignee" ? code : "failed";
      toast.error(t(`errors.${key}`));
    } finally {
      setBusy(false);
    }
  };

  const ownerName = preview.state === "ready" && preview.ownerId ? users.find((u) => u.value === preview.ownerId)?.label : undefined;
  const viaRule = preview.state === "ready" && (preview.via === "rule" || preview.via === "round_robin");
  return (
    <>
      <Button size="sm" variant="outline" className="rounded-full" onClick={show}>
        <Shuffle />
        {t("reassign")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmDescription", { name: leadName })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-oboya-blue-dark" aria-live="polite">
            {preview.state === "loading"
              ? t("previewLoading")
              : preview.state === "failed"
                ? t("previewFailed")
                : ownerName
                  ? viaRule
                    ? t("previewOwner", { name: ownerName })
                    : t("previewFallback", { name: ownerName })
                  : t("previewFallbackUnknown")}
          </p>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90" onClick={() => void confirm()} disabled={busy}>
              {busy ? t("assigning") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
