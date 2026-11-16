"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RecordPath } from "@/components/crm/record/RecordPath";
import { useApiErrorMessage } from "@/components/crm/record/api";
import { useCrm } from "@/contexts/CrmContext";
import type { Option, StageOption } from "@/lib/crm/objects/types";
import { moveOpportunityStage } from "./api";
import { ClosedLostDialog } from "./ClosedLostDialog";

/**
 * Record path for opportunities (RecordPage `pathSlot`): stage moves go through
 * the stage route; lost stages open the Closed Lost dialog first. When the
 * current stage is lost, the loss reason and note are shown (and editable).
 */
export function OpportunityPath({
  id,
  name,
  stageId,
  lossReason,
  lossNote,
  stages,
  lossReasons,
}: {
  id: string;
  name: string;
  stageId: string;
  lossReason: string | null;
  lossNote: string | null;
  stages: StageOption[];
  lossReasons: Option[];
}) {
  const t = useTranslations("opportunities");
  const router = useRouter();
  const { can } = useCrm();
  const errorMessage = useApiErrorMessage();
  const [current, setCurrent] = useState(stageId);
  const [source, setSource] = useState(stageId);
  if (source !== stageId) {
    setSource(stageId);
    setCurrent(stageId);
  }
  const [lostTarget, setLostTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = stages.map((s) => ({ value: s.value, label: s.label, kind: s.kind }));
  if (!steps.some((s) => s.value === stageId)) {
    steps.push({ value: stageId, label: t("inactiveStage"), kind: "open" });
  }
  const currentStage = stages.find((s) => s.value === current);

  const commit = async (target: string, loss?: { reason: string; note: string | null }) => {
    const previous = current;
    setCurrent(target);
    setBusy(true);
    try {
      await moveOpportunityStage(id, { stageId: target, lossReason: loss?.reason, lossNote: loss?.note });
      toast.success(t("toast.moved", { stage: stages.find((s) => s.value === target)?.label ?? "" }));
      setLostTarget(null);
      router.refresh();
    } catch (error) {
      setCurrent(previous);
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onStageChange = (target: string) => {
    if (stages.find((s) => s.value === target)?.kind === "lost") setLostTarget(target);
    else void commit(target);
  };

  const reasonLabel = lossReasons.find((r) => r.value === lossReason)?.label ?? lossReason;
  const canEdit = can("opportunities", "edit");

  return (
    <div className="space-y-2">
      <RecordPath steps={steps} current={current} disabled={!canEdit || busy} onStageChange={onStageChange} />
      {currentStage?.kind === "lost" && current === stageId ? (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-1 rounded-lg border border-oboya-orange/40 bg-oboya-orange/5 px-3 py-2 text-sm">
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-muted-foreground">{t("fields.lossReason")}</span>
            <p className="text-oboya-blue-dark">{reasonLabel ?? "—"}</p>
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-medium text-muted-foreground">{t("fields.lossNote")}</span>
            <p className="break-words whitespace-pre-wrap text-oboya-blue-dark">{lossNote || "—"}</p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setLostTarget(current)}
              className="inline-flex items-center gap-1 self-center text-xs font-medium text-oboya-blue-light hover:underline"
            >
              <Pencil className="size-3.5" /> {t("editLoss")}
            </button>
          ) : null}
        </div>
      ) : null}
      {lostTarget ? (
        <ClosedLostDialog
          stageLabel={stages.find((s) => s.value === lostTarget)?.label ?? ""}
          name={name}
          reasons={lossReasons}
          initialReason={lostTarget === stageId ? lossReason : null}
          initialNote={lostTarget === stageId ? lossNote : null}
          onCancel={() => setLostTarget(null)}
          onConfirm={(reason, note) => commit(lostTarget, { reason, note })}
        />
      ) : null}
    </div>
  );
}
