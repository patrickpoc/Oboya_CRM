"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  STAGE_COLOR_TOKENS,
  checkStageUpdate,
  planStageDelete,
  type SetupStage,
  type StageColorToken,
} from "@/lib/crm/setup/stages";
import { cn } from "@/lib/utils";
import { ApiError, Field, SortableList, apiFetch, selectClass, useErrorMessage, useSetupData } from "./shared";

type StagesPayload = { pipeline: { id: string; name: string }; stages: SetupStage[] };

type Draft = {
  id?: string;
  label: string;
  probability: string;
  colorToken: StageColorToken | null;
  active: boolean;
  kind: SetupStage["kind"];
};

function Swatch({ token, className }: { token: StageColorToken | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3.5 shrink-0 rounded-full ring-1 ring-border", className)}
      style={{ backgroundColor: token ? `var(--${token})` : "transparent" }}
    />
  );
}

/** Setup -> Pipeline (D6): stages of the default pipeline. */
export function PipelineSetup() {
  const t = useTranslations("setup.pipeline");
  const tc = useTranslations("setup.common");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const { data, setData, error, loading, reload } = useSetupData<StagesPayload>("/api/crm/stages");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [invariant, setInvariant] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SetupStage | null>(null);
  const [target, setTarget] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const stages = data?.stages ?? [];
  const canEdit = can("setup_pipeline", "edit");

  /** DB invariant errors stay visible in a banner; others are toasts. */
  const report = (e: unknown) => {
    const message = errorMessage(e);
    if (e instanceof ApiError && (e.code.startsWith("stage_") || e.status === 409)) setInvariant(message);
    else toast.error(message);
    return message;
  };

  const reorder = async (ids: string[]) => {
    if (!data) return;
    const byId = new Map(stages.map((s) => [s.id, s]));
    setData({ ...data, stages: ids.map((id) => byId.get(id)!).filter(Boolean) });
    try {
      setData(await apiFetch<StagesPayload>("/api/crm/stages/reorder", { method: "POST", body: JSON.stringify({ ids }) }));
      setInvariant(null);
    } catch (e) {
      report(e);
      await reload();
    }
  };

  const save = async () => {
    if (!draft) return;
    const probability = Number(draft.probability);
    setSaving(true);
    try {
      const next = await apiFetch<StagesPayload>(draft.id ? `/api/crm/stages/${draft.id}` : "/api/crm/stages", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify({
          label: draft.label.trim(),
          probability,
          colorToken: draft.colorToken,
          ...(draft.id && draft.kind === "open" ? { active: draft.active } : {}),
        }),
      });
      setData({ pipeline: next.pipeline, stages: next.stages });
      toast.success(draft.id ? t("updated") : t("created"));
      setInvariant(null);
      setDraft(null);
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (stage: SetupStage) => {
    try {
      setData(
        await apiFetch<StagesPayload>(`/api/crm/stages/${stage.id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !stage.active }),
        })
      );
      setInvariant(null);
    } catch (e) {
      report(e);
    }
  };

  const plan = deleting ? planStageDelete(stages, deleting.id) : null;

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const query = target ? `?target=${encodeURIComponent(target)}` : "";
      const res = await apiFetch<StagesPayload & { moved: number }>(`/api/crm/stages/${deleting.id}${query}`, {
        method: "DELETE",
      });
      setData({ pipeline: res.pipeline, stages: res.stages });
      toast.success(res.moved > 0 ? t("deletedMoved", { count: res.moved }) : t("deleted"));
      setInvariant(null);
      setDeleting(null);
    } catch (e) {
      setDeleteError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const draftRule = draft?.id ? checkStageUpdate(stages, draft.id, { active: draft.active }) : null;
  const probabilityValid = draft ? /^\d{1,3}$/.test(draft.probability) && Number(draft.probability) <= 100 : false;

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("setup_pipeline", "create") ? (
            <Button
              className="gap-1.5 rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              onClick={() => setDraft({ label: "", probability: "50", colorToken: "oboya-blue", active: true, kind: "open" })}
            >
              <Plus className="size-4" />
              {t("add")}
            </Button>
          ) : null
        }
      />

      {invariant ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-xl border border-oboya-orange/40 bg-oboya-orange/5 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-oboya-orange" />
          <div className="flex-1 text-sm text-oboya-blue-dark">
            <p className="font-semibold">{t("invariantTitle")}</p>
            <p>{invariant}</p>
          </div>
          <button type="button" aria-label={tc("dismiss")} onClick={() => setInvariant(null)} className="rounded p-1 hover:bg-muted">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      <p className="mb-3 text-xs text-muted-foreground">{t("rulesHint")}</p>

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <ListSkeleton rows={7} />
      ) : (
        <SortableList
          items={stages}
          disabled={!canEdit}
          onReorder={(ids) => void reorder(ids)}
          itemLabel={(s) => s.label}
          renderItem={(s) => (
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", !s.active && "opacity-60")}>
              <Swatch token={s.colorToken} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-oboya-blue-dark">{s.label}</span>
              <StatusPill tone={s.kind === "won" ? "success" : s.kind === "lost" ? "danger" : "neutral"} size="xs">
                {t(`kinds.${s.kind}`)}
              </StatusPill>
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{s.probability}%</span>
              <span className="w-24 text-xs text-muted-foreground">{t("opportunities", { count: s.opportunityCount })}</span>
              {canEdit && s.kind === "open" ? (
                <label className="inline-flex shrink-0 items-center">
                  <span className="sr-only">{t("activeNamed", { label: s.label })}</span>
                  <Switch checked={s.active} onCheckedChange={() => void toggleActive(s)} />
                </label>
              ) : (
                <span className="w-9" />
              )}
              <span className="inline-flex shrink-0 gap-1">
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={t("editNamed", { label: s.label })}
                    className="rounded p-1.5 hover:bg-muted"
                    onClick={() =>
                      setDraft({
                        id: s.id,
                        label: s.label,
                        probability: String(s.probability),
                        colorToken: s.colorToken,
                        active: s.active,
                        kind: s.kind,
                      })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </button>
                ) : null}
                {can("setup_pipeline", "delete") && s.kind === "open" ? (
                  <button
                    type="button"
                    aria-label={t("deleteNamed", { label: s.label })}
                    className="rounded p-1.5 text-oboya-orange hover:bg-muted"
                    onClick={() => {
                      setDeleting(s);
                      setTarget("");
                      setDeleteError(null);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : (
                  <span className="w-7" />
                )}
              </span>
            </div>
          )}
        />
      )}
      {canEdit ? <p className="mt-2 text-xs text-muted-foreground">{t("reorderHint")}</p> : null}

      <FormDrawer
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? draft.label || t("edit") : t("new")}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {draftRule ? <p className="mr-auto text-xs text-oboya-orange">{t(`rules.${draftRule}`)}</p> : null}
            <Button variant="ghost" className="rounded-full" onClick={() => setDraft(null)}>
              {tc("cancel")}
            </Button>
            <Button
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={saving || !draft?.label.trim() || !probabilityValid || Boolean(draftRule)}
              onClick={() => void save()}
            >
              {saving ? tc("saving") : tc("save")}
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <Field label={t("label")} htmlFor="stage-label">
              <Input id="stage-label" value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </Field>
            <Field label={t("probability")} htmlFor="stage-probability" hint={t("probabilityHint")}>
              <Input
                id="stage-probability"
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={draft.probability}
                aria-invalid={!probabilityValid}
                onChange={(e) => setDraft({ ...draft, probability: e.target.value })}
              />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("color")}</legend>
              <div role="radiogroup" aria-label={t("color")} className="flex flex-wrap gap-2">
                {STAGE_COLOR_TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    role="radio"
                    aria-checked={draft.colorToken === token}
                    aria-label={t(`colors.${token}`)}
                    title={t(`colors.${token}`)}
                    onClick={() => setDraft({ ...draft, colorToken: token })}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full ring-1 ring-border transition-all",
                      draft.colorToken === token && "ring-2 ring-oboya-blue-dark ring-offset-2"
                    )}
                    style={{ backgroundColor: `var(--${token})` }}
                  />
                ))}
              </div>
            </fieldset>
            <Field label={t("kind")} htmlFor="stage-kind" hint={t("kindHint")}>
              <select id="stage-kind" className={selectClass} value={draft.kind} disabled>
                <option value={draft.kind}>{t(`kinds.${draft.kind}`)}</option>
              </select>
            </Field>
            {draft.id ? (
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-oboya-blue-dark">{t("active")}</span>
                  {draft.kind !== "open" ? (
                    <span className="block text-xs text-muted-foreground">{t("rules.won_lost_active")}</span>
                  ) : null}
                </span>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(active) => (draft.kind === "open" ? setDraft({ ...draft, active }) : undefined)}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </FormDrawer>

      <Dialog open={deleting !== null} onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle", { label: deleting?.label ?? "" })}</DialogTitle>
            <DialogDescription>
              {plan && plan.ok && plan.needsTarget
                ? t("deleteMoveDescription", { count: deleting?.opportunityCount ?? 0 })
                : plan && !plan.ok
                  ? t(`deleteBlocked.${plan.reason}`)
                  : t("deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {plan && plan.ok && plan.needsTarget ? (
            <Field label={t("targetStage")} htmlFor="stage-target">
              <select id="stage-target" className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t("chooseTarget")}</option>
                {plan.targets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {deleteError ? (
            <p role="alert" className="rounded-lg bg-oboya-orange/10 px-3 py-2 text-sm text-oboya-blue-dark">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={saving || !plan?.ok || (plan.needsTarget && !target)}
              onClick={() => void confirmDelete()}
            >
              {saving ? tc("saving") : t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
