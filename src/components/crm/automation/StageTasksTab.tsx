"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { Field, SortableList, apiFetch, selectClass, useErrorMessage, useSetupData } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/contexts/CrmContext";
import { AUTOMATION_API, type StageTasksResponse } from "@/lib/crm/automation/api-contract";
import {
  STAGE_TASK_ASSIGNEE_TYPES,
  TASK_PRIORITIES,
  type StageTaskTemplate,
  type StageTaskTemplateInput,
} from "@/lib/crm/automation/types";
import { SwitchRow, type AutomationLookups, type PipelineOption } from "./shared";

export function StageTasksTab({ lookups }: { lookups: AutomationLookups }) {
  const t = useTranslations("automation");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const canEdit = can("automation", "edit");
  const canCreate = can("automation", "create");
  const canDelete = can("automation", "delete");
  const [pipelineId, setPipelineId] = useState(
    () => (lookups.pipelines.find((p) => p.isDefault) ?? lookups.pipelines[0])?.id ?? ""
  );
  const pipeline = lookups.pipelines.find((p) => p.id === pipelineId);
  const { data, setData, error, loading, reload } = useSetupData<StageTasksResponse>(
    `${AUTOMATION_API.stageTasks}?pipelineId=${encodeURIComponent(pipelineId)}`
  );
  const [editing, setEditing] = useState<{ template: StageTaskTemplate | null; stageId: string } | null>(null);
  const userName = useMemo(() => new Map(lookups.users.map((u) => [u.value, u.label])), [lookups.users]);

  const templates = data?.templates;
  const byStage = (stageId: string) =>
    (templates ?? []).filter((x) => x.stageId === stageId).sort((a, b) => a.sortOrder - b.sortOrder);

  const reorder = async (stageId: string, ids: string[]) => {
    if (!data) return;
    const previous = data;
    const order = new Map(ids.map((id, i) => [id, i]));
    setData({
      templates: data.templates.map((x) => (x.stageId === stageId && order.has(x.id) ? { ...x, sortOrder: order.get(x.id)! } : x)),
    });
    try {
      await apiFetch(AUTOMATION_API.stageTasksReorder, { method: "POST", body: JSON.stringify({ ids }) });
    } catch (e) {
      setData(previous);
      toast.error(errorMessage(e));
    }
  };

  const remove = async (tpl: StageTaskTemplate) => {
    if (!window.confirm(t("common.confirmDelete", { name: tpl.subject }))) return;
    try {
      await apiFetch(AUTOMATION_API.stageTask(tpl.id), { method: "DELETE" });
      toast.success(t("common.deleted"));
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toggle = async (tpl: StageTaskTemplate, active: boolean) => {
    if (!data) return;
    setData({ templates: data.templates.map((x) => (x.id === tpl.id ? { ...x, active } : x)) });
    try {
      await apiFetch(AUTOMATION_API.stageTask(tpl.id), { method: "PATCH", body: JSON.stringify({ active }) });
    } catch (e) {
      toast.error(errorMessage(e));
      void reload();
    }
  };

  const assigneeLabel = (x: StageTaskTemplate) =>
    x.assigneeType === "user"
      ? t("stageTasks.assignee.user", { name: (x.assigneeUserId && userName.get(x.assigneeUserId)) || t("common.unknownUser") })
      : t(`stageTasks.assignee.${x.assigneeType}`);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-oboya-blue-dark">{t("stageTasks.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("stageTasks.description")}</p>
      </div>
      {!canEdit ? <p className="text-xs text-muted-foreground">{t("common.readOnly")}</p> : null}

      {lookups.pipelines.length === 0 ? (
        <EmptyState title={t("stageTasks.emptyPipelines")} />
      ) : (
        <>
          {lookups.pipelines.length > 1 ? (
            <div className="max-w-xs">
              <Field label={t("stageTasks.pipeline")} htmlFor="stage-pipeline">
                <select id="stage-pipeline" className={selectClass} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                  {lookups.pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          {error && !data ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />
          ) : loading && !data ? (
            <ListSkeleton rows={4} />
          ) : !pipeline || pipeline.stages.length === 0 ? (
            <EmptyState title={t("stageTasks.noStages")} />
          ) : (
            <ol className="space-y-4">
              {pipeline.stages.map((stage) => {
                const items = byStage(stage.id);
                return (
                  <li key={stage.id}>
                    <section aria-labelledby={`stage-${stage.id}`} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 id={`stage-${stage.id}`} className="flex items-center gap-2 text-sm font-semibold text-oboya-blue-dark">
                          {stage.label}
                          {!stage.active ? <StatusPill tone="muted" size="xs">{t("stageTasks.inactiveStage")}</StatusPill> : null}
                        </h3>
                        {canCreate ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11 md:min-h-7"
                            onClick={() => setEditing({ template: null, stageId: stage.id })}
                          >
                            <Plus className="size-3.5" aria-hidden /> {t("stageTasks.add")}
                            <span className="sr-only"> {stage.label}</span>
                          </Button>
                        ) : null}
                      </div>
                      {items.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border/70 bg-white px-3 py-2 text-xs text-muted-foreground">
                          {t("stageTasks.noTemplates")}
                        </p>
                      ) : (
                        <SortableList
                          items={items}
                          disabled={!canEdit}
                          itemLabel={(x) => x.subject}
                          onReorder={(ids) => void reorder(stage.id, ids)}
                          renderItem={(x) => (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm font-medium ${x.active ? "text-oboya-blue-dark" : "text-muted-foreground"}`}>
                                  {x.subject}
                                </p>
                                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <span>{t("stageTasks.dueIn", { days: x.dueInDays })}</span>
                                  <span aria-hidden>·</span>
                                  <span>{assigneeLabel(x)}</span>
                                  <StatusPill tone={x.priority === "urgent" ? "danger" : x.priority === "high" ? "warning" : "neutral"} size="xs">
                                    {t(`stageTasks.priority.${x.priority}`)}
                                  </StatusPill>
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Switch
                                  id={`tpl-active-${x.id}`}
                                  checked={x.active}
                                  onCheckedChange={(v) => void toggle(x, v)}
                                  disabled={!canEdit}
                                  aria-label={x.subject}
                                />
                                {canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => setEditing({ template: x, stageId: x.stageId })}
                                    aria-label={`${t("common.edit")}: ${x.subject}`}
                                    className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:min-h-8 md:min-w-8"
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                ) : null}
                                {canDelete ? (
                                  <button
                                    type="button"
                                    onClick={() => void remove(x)}
                                    aria-label={`${t("common.delete")}: ${x.subject}`}
                                    className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-oboya-orange hover:bg-oboya-orange/10 md:min-h-8 md:min-w-8"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )}
                        />
                      )}
                    </section>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {editing && pipeline ? (
        <StageTaskEditor
          key={editing.template?.id ?? `new-${editing.stageId}`}
          template={editing.template}
          stageId={editing.stageId}
          pipeline={pipeline}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </div>
  );
}

function StageTaskEditor({
  template,
  stageId,
  pipeline,
  lookups,
  onClose,
  onSaved,
}: {
  template: StageTaskTemplate | null;
  stageId: string;
  pipeline: PipelineOption;
  lookups: AutomationLookups;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("automation");
  const tf = useTranslations("automation.stageTasks.fields");
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState<StageTaskTemplateInput>(() => ({
    stageId,
    pipelineId: pipeline.id,
    subject: template?.subject ?? "",
    description: template?.description ?? null,
    dueInDays: template?.dueInDays ?? 1,
    priority: template?.priority ?? "normal",
    assigneeType: template?.assigneeType ?? "owner",
    assigneeUserId: template?.assigneeUserId ?? null,
    active: template?.active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<StageTaskTemplateInput>) => setDraft((d) => ({ ...d, ...p }));
  const stageLabel = pipeline.stages.find((s) => s.id === stageId)?.label ?? "";
  const valid =
    draft.subject.trim().length > 0 &&
    Number.isInteger(draft.dueInDays) &&
    draft.dueInDays >= 0 &&
    draft.dueInDays <= 365 &&
    (draft.assigneeType !== "user" || draft.assigneeUserId !== null);
  const users = lookups.users.filter((u) => u.active || u.value === draft.assigneeUserId);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        ...draft,
        subject: draft.subject.trim(),
        description: draft.description?.trim() || null,
        assigneeUserId: draft.assigneeType === "user" ? draft.assigneeUserId : null,
      };
      await apiFetch(template ? AUTOMATION_API.stageTask(template.id) : AUTOMATION_API.stageTasks, {
        method: template ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      toast.success(t("common.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={template ? t("stageTasks.editTitle") : t("stageTasks.newTitle")}
      description={stageLabel}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="min-h-11 md:min-h-8">
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={!valid || saving} className="min-h-11 md:min-h-8">
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={tf("subject")} htmlFor="tpl-subject">
          <Input id="tpl-subject" className="h-9" maxLength={300} value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} />
        </Field>
        <Field label={tf("description")} htmlFor="tpl-description">
          <Textarea id="tpl-description" rows={3} maxLength={5000} value={draft.description ?? ""} onChange={(e) => patch({ description: e.target.value || null })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tf("dueInDays")} htmlFor="tpl-due" hint={tf("dueInDaysHint")}>
            <Input
              id="tpl-due"
              className="h-9"
              type="number"
              min={0}
              max={365}
              step={1}
              value={Number.isNaN(draft.dueInDays) ? "" : draft.dueInDays}
              onChange={(e) => patch({ dueInDays: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
            />
          </Field>
          <Field label={tf("priority")} htmlFor="tpl-priority">
            <select id="tpl-priority" className={selectClass} value={draft.priority} onChange={(e) => patch({ priority: e.target.value as StageTaskTemplateInput["priority"] })}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`stageTasks.priority.${p}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={tf("assigneeType")} htmlFor="tpl-assignee-type">
          <select
            id="tpl-assignee-type"
            className={selectClass}
            value={draft.assigneeType}
            onChange={(e) => patch({ assigneeType: e.target.value as StageTaskTemplateInput["assigneeType"] })}
          >
            {STAGE_TASK_ASSIGNEE_TYPES.map((a) => (
              <option key={a} value={a}>
                {t(`stageTasks.assigneeTypes.${a}`)}
              </option>
            ))}
          </select>
        </Field>
        {draft.assigneeType === "user" ? (
          <Field label={tf("assigneeUser")} htmlFor="tpl-assignee-user">
            <select id="tpl-assignee-user" className={selectClass} value={draft.assigneeUserId ?? ""} onChange={(e) => patch({ assigneeUserId: e.target.value || null })}>
              <option value="">{t("assignment.fields.selectUser")}</option>
              {users.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <SwitchRow id="tpl-active" label={tf("active")}>
          <Switch id="tpl-active" checked={draft.active} onCheckedChange={(active) => patch({ active })} />
        </SwitchRow>
      </div>
    </FormDrawer>
  );
}
