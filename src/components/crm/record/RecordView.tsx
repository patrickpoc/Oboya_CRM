"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTimelineSlot } from "@/components/crm/activities/ActivityTimelineSlot";
import { useCrmDocumentTitle } from "@/components/crm/layout/CrmRouteDocumentTitle";
import { useCrm } from "@/contexts/CrmContext";
import { getField } from "@/lib/crm/objects/query";
import { recordAccess } from "@/lib/crm/objects/record-access";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import type { CrmObject, RecordLookups, RecordRow, RelatedListData } from "@/lib/crm/objects/types";
import { deleteRecord, updateRecord, useApiErrorMessage } from "./api";
import { FieldInput, useFieldOptions } from "./FieldInput";
import { FieldValue } from "./FieldValue";
import { RecordDetails } from "./RecordDetails";
import { RecordPath, type PathStep } from "./RecordPath";
import { RelatedLists } from "./RelatedLists";

export type RecordViewProps = {
  object: CrmObject;
  record: RecordRow;
  related: RelatedListData[];
  lookups: RecordLookups;
  /** Extra header buttons (e.g. Convert lead), rendered next to the built-in actions. */
  actionSlot?: React.ReactNode;
  /** Replaces the default path (e.g. opportunities with a Closed Lost dialog). */
  pathSlot?: React.ReactNode;
};

/** Client part of RecordPage: highlights, path, Details/Related tabs, timeline column. */
export function RecordView({ object, record: initialRecord, related, lookups, actionSlot, pathSlot }: RecordViewProps) {
  const config = getRecordConfig(object)!;
  const t = useTranslations();
  const tr = useTranslations("record");
  const router = useRouter();
  const { can } = useCrm();
  const errorMessage = useApiErrorMessage();
  const options = useFieldOptions(config, lookups);

  // Local copy for optimistic edits; reset when the server sends a new record.
  const [record, setRecord] = useState(initialRecord);
  const [source, setSource] = useState(initialRecord);
  if (source !== initialRecord) {
    setSource(initialRecord);
    setRecord(initialRecord);
  }

  const [tab, setTab] = useState("details");
  const [dialog, setDialog] = useState<"delete" | "owner" | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const name = record._display?._name || tr(`objects.${object}`);
  useCrmDocumentTitle(name);
  const { canEdit, actions } = recordAccess(config, record, can);

  const saveField = async (key: string, value: unknown, display?: string): Promise<boolean> => {
    const previous = record;
    const nextDisplay = { ...(record._display ?? {}) };
    if (display !== undefined) nextDisplay[key] = display;
    else delete nextDisplay[key];
    setRecord({ ...record, [key]: value, _display: nextDisplay });
    try {
      const { record: saved } = await updateRecord(object, record.id, { [key]: value });
      setRecord(saved);
      toast.success(tr("toast.saved"));
      // Path and owner changes show up in server-rendered parts (slots, related
      // lists, audit timeline): reload them.
      if (key === config.path?.field || key === "owner_id") router.refresh();
      return true;
    } catch (error) {
      setRecord(previous);
      toast.error(errorMessage(error));
      return false;
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteRecord(object, record.id);
      toast.success(tr("toast.deleted"));
      router.push(config.basePath);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };

  const changeOwner = async () => {
    if (!owner || owner === record.owner_id) return setDialog(null);
    setBusy(true);
    const label = lookups.users.find((u) => u.value === owner)?.label;
    const ok = await saveField("owner_id", owner, label);
    setBusy(false);
    if (ok) setDialog(null);
  };

  // Path: stages from lookups, or static values / the field's static picklist.
  let steps: PathStep[] = [];
  if (config.path?.source === "stages") {
    steps = lookups.stages.map((s) => ({ value: s.value, label: s.label, kind: s.kind }));
  } else if (config.path) {
    const field = getField(config, config.path.field);
    steps = config.path.values
      ? config.path.values.map((v) => ({ value: v.value, label: t(`${config.namespace}.${v.labelKey}`) }))
      : field
        ? options(field)
        : [];
  }

  const ownerField = getField(config, "owner_id");
  const Icon = config.icon;

  return (
    <div className="space-y-4">
      <Link href={config.basePath} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-oboya-blue-dark">
        <ChevronLeft className="size-3.5" />
        {t(`${config.namespace}.title`)}
      </Link>

      {/* Highlights panel */}
      <section className="rounded-xl border border-border/60 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-oboya-blue text-white">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">{tr(`objects.${object}`)}</p>
            <h1 className="font-display text-xl font-semibold break-words text-oboya-blue-dark sm:text-2xl">{name}</h1>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {actionSlot}
            {actions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <Button
                  key={action.key}
                  size="sm"
                  variant="outline"
                  className={action.kind === "delete" ? "rounded-full text-oboya-orange hover:text-oboya-orange" : "rounded-full"}
                  onClick={() => {
                    if (action.kind === "changeOwner") setOwner(record.owner_id ?? null);
                    setDialog(action.kind === "delete" ? "delete" : "owner");
                  }}
                >
                  {ActionIcon ? <ActionIcon /> : null}
                  {tr(`actions.${action.labelKey}`)}
                </Button>
              );
            })}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/50 pt-3 sm:grid-cols-3 lg:grid-cols-6">
          {config.highlights.map((key) => {
            const field = getField(config, key);
            if (!field) return null;
            return (
              <div key={key} className="min-w-0">
                <dt className="text-[11px] font-medium text-muted-foreground">{t(`${config.namespace}.${field.labelKey}`)}</dt>
                <dd className="mt-0.5 truncate text-sm text-oboya-blue-dark">
                  <FieldValue config={config} field={field} row={record} lookups={lookups} />
                </dd>
              </div>
            );
          })}
          <div className="min-w-0">
            <dt className="text-[11px] font-medium text-muted-foreground">{tr("owner")}</dt>
            <dd className="mt-0.5 truncate text-sm text-oboya-blue-dark">{record._display?.owner_id ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {pathSlot ??
        (config.path && steps.length > 0 ? (
          <RecordPath
            steps={steps}
            current={typeof record[config.path.field] === "string" ? (record[config.path.field] as string) : null}
            disabled={!canEdit}
            onStageChange={(value) => {
              const label = steps.find((s) => s.value === value)?.label;
              void saveField(config.path!.field, value, label);
            }}
          />
        ) : null)}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 rounded-xl border border-border/60 bg-white p-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="details">{tr("tabs.details")}</TabsTrigger>
              <TabsTrigger value="related">{tr("tabs.related")}</TabsTrigger>
            </TabsList>
            <TabsContent value="details">
              <RecordDetails config={config} record={record} lookups={lookups} canEdit={canEdit} onSave={saveField} />
            </TabsContent>
            <TabsContent value="related">
              <RelatedLists config={config} record={record} related={related} lookups={lookups} />
            </TabsContent>
          </Tabs>
        </section>
        {config.timeline ? (
          <aside className="min-w-0">
            <ActivityTimelineSlot object={object} recordId={record.id} refreshKey={String(record.updated_at ?? "")} />
          </aside>
        ) : null}
      </div>

      <Dialog open={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("deleteDialog.title")}</DialogTitle>
            <DialogDescription>{tr("deleteDialog.description", { name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setDialog(null)} disabled={busy}>
              {tr("actions.cancel")}
            </Button>
            <Button className="rounded-full bg-oboya-orange text-white hover:bg-oboya-orange/90" onClick={remove} disabled={busy}>
              {tr("deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "owner"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("ownerDialog.title")}</DialogTitle>
            <DialogDescription>{tr("ownerDialog.description", { name })}</DialogDescription>
          </DialogHeader>
          {ownerField ? (
            <FieldInput
              config={config}
              field={ownerField}
              id="change-owner"
              value={owner}
              lookups={lookups}
              displayLabel={record._display?.owner_id}
              onChange={(value) => setOwner(typeof value === "string" ? value : null)}
            />
          ) : null}
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setDialog(null)} disabled={busy}>
              {tr("actions.cancel")}
            </Button>
            <Button className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90" onClick={changeOwner} disabled={busy || !owner}>
              {tr("ownerDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
