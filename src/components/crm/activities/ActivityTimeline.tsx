"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, CalendarClock, History, Sparkles, UserRoundCog } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch, updateRecord, useApiErrorMessage } from "@/components/crm/record/api";
import { useCrm } from "@/contexts/CrmContext";
import { isOverdue, splitTimeline } from "@/lib/crm/activities/due";
import type { TimelineAuditEvent, TimelineResponse } from "@/lib/crm/activities/types";
import type { CrmObject, RecordRow } from "@/lib/crm/objects/types";
import { ActivityComposer } from "./ActivityComposer";
import { ActivityTypeIcon, AutomatedBadge, CompleteCheckbox, DueDate, isAutomated, useViewerClock } from "./activity-parts";

type Load = { key: string; data: TimelineResponse | null; failed: boolean };

/**
 * Record timeline: composer, "Upcoming & overdue" (open tasks and meetings)
 * and "Past activity" (other activities + audit events, newest first).
 */
export function ActivityTimeline({
  object,
  recordId,
  refreshKey = "",
}: {
  object: CrmObject;
  recordId: string;
  /** Changes when the record is saved (its updated_at): refetches path/stage/owner events. */
  refreshKey?: string;
}) {
  const t = useTranslations("activities.timeline");
  const tr = useTranslations("record.timeline");
  const { can } = useCrm();
  const errorMessage = useApiErrorMessage();
  const clock = useViewerClock();
  const [reload, setReload] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const key = `${object}:${recordId}:${refreshKey}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TimelineResponse>(
      `/api/crm/activities/timeline?object=${object}&id=${encodeURIComponent(recordId)}`,
      { signal: controller.signal }
    )
      .then((data) => setLoad({ key, data, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) setLoad((prev) => ({ key, data: prev?.data ?? null, failed: true }));
      });
    return () => controller.abort();
  }, [key, object, recordId]);

  const refresh = () => setReload((n) => n + 1);
  const canEdit = can("activities", "edit");
  const data = load?.data ?? null;
  const loading = load?.key !== key && !data;

  const toggle = async (row: RecordRow) => {
    setPending(row.id);
    try {
      await updateRecord("activity", row.id, { status: row.status === "done" ? "open" : "done" });
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const groups = data ? splitTimeline(data.activities, data.events) : null;
  const empty = groups && groups.upcoming.length === 0 && groups.past.length === 0;

  const renderActivity = (row: RecordRow) => {
    const overdue = clock ? isOverdue(row, clock.now, clock.timeZone) : false;
    const done = row.status === "done";
    return (
      <li key={row.id} className="flex gap-2.5">
        <ActivityTypeIcon type={row.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <Link
              href={`/activities/${row.id}`}
              className={`min-w-0 flex-1 break-words text-sm font-medium text-oboya-blue-dark hover:underline ${done && row.type === "task" ? "line-through decoration-muted-foreground/60" : ""}`}
            >
              {String(row.subject ?? "")}
            </Link>
            {row.type === "task" && canEdit ? (
              <CompleteCheckbox
                done={done}
                disabled={pending === row.id}
                label={done ? t("reopen") : t("complete")}
                onToggle={() => void toggle(row)}
              />
            ) : null}
          </div>
          {typeof row.body === "string" && row.body ? (
            <p className="mt-0.5 line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{row.body}</p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {row.due_at ? (
              <span className="inline-flex items-center gap-1">
                {overdue ? <span className="font-medium text-oboya-orange">{t("overdue")}</span> : null}
                <DueDate value={row.due_at} overdue={overdue} />
              </span>
            ) : (
              <DueDate value={row.completed_at ?? row.created_at} overdue={false} />
            )}
            {row._display?.owner_id ? <span>· {row._display.owner_id}</span> : null}
            {isAutomated(row) ? <AutomatedBadge /> : null}
          </p>
        </div>
      </li>
    );
  };

  return (
    <section
      aria-labelledby={`timeline-${object}-${recordId}`}
      className="space-y-4 rounded-xl border border-border/60 bg-white p-4"
    >
      <h2 id={`timeline-${object}-${recordId}`} className="text-sm font-semibold text-oboya-blue-dark">
        {tr("title")}
      </h2>

      {can("activities", "create") ? <ActivityComposer object={object} recordId={recordId} onCreated={refresh} /> : null}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-oboya-soft-white" />
          ))}
        </div>
      ) : load?.failed && !data ? (
        <div className="space-y-2 text-center text-sm text-muted-foreground">
          <p>{t("failed")}</p>
          <Button size="sm" variant="outline" className="rounded-full" onClick={refresh}>
            {t("retry")}
          </Button>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-oboya-soft-white text-oboya-blue">
            <CalendarClock className="size-5" />
          </span>
          <p className="text-sm font-medium text-oboya-blue-dark">{tr("empty")}</p>
          <p className="max-w-60 text-xs text-muted-foreground">{tr("emptyHint")}</p>
        </div>
      ) : groups ? (
        <>
          {groups.upcoming.length > 0 ? (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("upcoming")}</h3>
              <ol className="space-y-3">{groups.upcoming.map(renderActivity)}</ol>
            </div>
          ) : null}
          {groups.past.length > 0 ? (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("past")}</h3>
              <ol className="space-y-3">
                {groups.past.map((entry) =>
                  entry.kind === "activity" ? renderActivity(entry.item) : <AuditItem key={entry.item.id} event={entry.item} />
                )}
              </ol>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const AUDIT_ICONS = { create: Sparkles, stage_change: ArrowRightLeft, owner_change: UserRoundCog, convert: History };

function AuditItem({ event }: { event: TimelineAuditEvent }) {
  const t = useTranslations("activities.timeline.audit");
  const tLeads = useTranslations("leads.statuses");
  const tAuto = useTranslations("activities");
  const format = useFormatter();
  const actor = event.actor === "Automation" ? tAuto("automationActor") : event.actor;
  const Icon = AUDIT_ICONS[event.action] ?? History;
  const value = (v: string | null) => (v && event.values === "lead_status" && tLeads.has(v) ? tLeads(v) : v);
  const from = value(event.from);
  const to = value(event.to);
  const change = from || to ? `${from ?? "—"} → ${to ?? "—"}` : null;
  return (
    <li className="flex gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 text-xs">
        <p className="text-oboya-blue-dark">
          {t(event.action, { actor })}
          {change ? <span className="text-muted-foreground"> · {change}</span> : null}
        </p>
        <time dateTime={event.created_at} className="text-[11px] text-muted-foreground">
          {format.dateTime(new Date(event.created_at), { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </div>
    </li>
  );
}
