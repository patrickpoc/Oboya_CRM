"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill, type PillTone } from "@/components/crm/common/StatusPill";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { updateRecord, useApiErrorMessage } from "@/components/crm/record/api";
import { useCrm } from "@/contexts/CrmContext";
import { DUE_BUCKETS, completedSince, groupByDue, type DueBucket } from "@/lib/crm/activities/due";
import type { RecordRow } from "@/lib/crm/objects/types";
import { CompleteCheckbox, DueDate, RelatedLink, createActivity, localInputToIso, useViewerClock } from "./activity-parts";

const PRIORITY_TONES: Record<string, PillTone> = { low: "muted", high: "warning", urgent: "danger" };

/**
 * My tasks body. "Today" is the viewer's calendar day in the browser timezone
 * (useViewerClock); until the clock is known (SSR/hydration) a skeleton shows.
 */
export function MyTasks({ open, done }: { open: RecordRow[] | null; done: RecordRow[] }) {
  const t = useTranslations("activities.myTasks");
  const ta = useTranslations("activities");
  const router = useRouter();
  const { can } = useCrm();
  const errorMessage = useApiErrorMessage();
  const clock = useViewerClock();
  // Optimistic status per task id until the server data catches up.
  const [overrides, setOverrides] = useState<Record<string, "open" | "done">>({});
  const [source, setSource] = useState({ open, done });
  if (source.open !== open || source.done !== done) {
    setSource({ open, done });
    setOverrides({});
  }
  const [showDone, setShowDone] = useState(false);
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const canEdit = can("activities", "edit");
  const canCreate = can("activities", "create");

  const toggle = async (row: RecordRow, next: "open" | "done") => {
    setOverrides((o) => ({ ...o, [row.id]: next }));
    try {
      await updateRecord("activity", row.id, { status: next });
      router.refresh();
    } catch (error) {
      setOverrides((o) => {
        const copy = { ...o };
        delete copy[row.id];
        return copy;
      });
      toast.error(errorMessage(error));
    }
  };

  const quickAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || busy) return;
    setBusy(true);
    try {
      await createActivity({
        type: "task",
        subject: subject.trim(),
        due_at: localInputToIso(due),
        status: "open",
        priority: "normal",
      });
      toast.success(ta("composer.created.task"));
      setSubject("");
      setDue("");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const status = (row: RecordRow) => overrides[row.id] ?? (row.status as "open" | "done");
  const all = [...(open ?? []), ...done];
  const openRows = all.filter((r) => status(r) === "open");
  const doneRows = all.filter((r) => status(r) === "done");

  const renderRow = (row: RecordRow, bucket?: DueBucket) => {
    const isDone = status(row) === "done";
    const priority = typeof row.priority === "string" ? row.priority : "normal";
    return (
      <li key={row.id} className="flex items-start gap-3 px-3 py-2.5">
        {canEdit ? (
          <CompleteCheckbox
            done={isDone}
            label={isDone ? ta("timeline.reopen") : ta("timeline.complete")}
            onToggle={() => void toggle(row, isDone ? "open" : "done")}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <Link
            href={`/activities/${row.id}`}
            className={`block break-words text-sm font-medium text-oboya-blue-dark hover:underline ${isDone ? "line-through decoration-muted-foreground/60" : ""}`}
          >
            {String(row.subject ?? "")}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {isDone ? (
              <DueDate value={row.completed_at} overdue={false} />
            ) : (
              <DueDate value={row.due_at} overdue={bucket === "overdue"} />
            )}
            <RelatedLink row={row} />
          </p>
        </div>
        {priority !== "normal" && !isDone ? (
          <StatusPill size="xs" tone={PRIORITY_TONES[priority] ?? "neutral"}>
            {ta(`priorities.${priority}`)}
          </StatusPill>
        ) : null}
      </li>
    );
  };

  let body: React.ReactNode;
  if (open === null) {
    body = <ErrorState message={t("failed")} onRetry={() => router.refresh()} />;
  } else if (!clock) {
    body = <ListSkeleton rows={5} />;
  } else {
    const groups = groupByDue(openRows, clock.now, clock.timeZone);
    const recent = completedSince(doneRows, clock.now);
    body = (
      <div className="space-y-4">
        {openRows.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("empty")} />
        ) : (
          DUE_BUCKETS.filter((b) => groups[b].length > 0).map((bucket) => (
            <section key={bucket} aria-labelledby={`tasks-${bucket}`} className="rounded-xl border border-border/60 bg-white">
              <h2
                id={`tasks-${bucket}`}
                className={`flex items-center gap-2 border-b border-border/50 px-3 py-2 text-xs font-semibold tracking-wide uppercase ${bucket === "overdue" ? "text-oboya-orange" : "text-oboya-blue-dark"}`}
              >
                {t(`sections.${bucket}`)}
                <span className="rounded-full bg-oboya-soft-white px-1.5 text-[11px] text-muted-foreground">{groups[bucket].length}</span>
              </h2>
              <ul className="divide-y divide-border/50">{groups[bucket].map((row) => renderRow(row, bucket))}</ul>
            </section>
          ))
        )}
        <div>
          <Button variant="ghost" size="sm" className="rounded-full" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            {showDone ? t("hideCompleted") : t("showCompleted", { count: recent.length })}
          </Button>
          {showDone ? (
            recent.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{t("noCompleted")}</p>
            ) : (
              <section aria-label={t("sections.completed")} className="mt-2 rounded-xl border border-border/60 bg-white">
                <ul className="divide-y divide-border/50">{recent.map((row) => renderRow(row))}</ul>
              </section>
            )
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <CrmPageHeader title={t("title")} description={t("description")} />
      {canCreate ? (
        <form onSubmit={quickAdd} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-border/60 bg-white p-3">
          <div className="min-w-48 flex-[2] space-y-1">
            <Label htmlFor="quick-task-subject" className="text-xs text-muted-foreground">
              {t("quickAdd.subject")}
            </Label>
            <Input
              id="quick-task-subject"
              value={subject}
              maxLength={300}
              placeholder={t("quickAdd.placeholder")}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="min-w-44 flex-1 space-y-1">
            <Label htmlFor="quick-task-due" className="text-xs text-muted-foreground">
              {t("quickAdd.due")}
            </Label>
            <Input id="quick-task-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button type="submit" disabled={!subject.trim() || busy} className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90">
            <Plus /> {t("quickAdd.submit")}
          </Button>
        </form>
      ) : null}
      {body}
    </>
  );
}
