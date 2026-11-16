"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { EntityAvatar } from "@/components/crm/common/EntityAvatar";
import { FilterBar, FilterSelect, FilterTabs } from "@/components/crm/common/FilterBar";
import { ErrorState } from "@/components/crm/common/states";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DateRangeFilter } from "@/components/crm/common/DateRangeFilter";
import { apiFetch, useApiErrorMessage } from "@/components/crm/record/api";
import { useCrm } from "@/contexts/CrmContext";
import type { RecordLookups, RecordRow, StageOption } from "@/lib/crm/objects/types";
import { isOverdue, pipelineKey, summarizeColumn, PIPELINE_LIMIT } from "@/lib/crm/opportunities/pipeline";
import { planStageChange } from "@/lib/crm/opportunities/stages";
import { cn } from "@/lib/utils";
import { moveOpportunityStage } from "./api";
import { ClosedLostDialog } from "./ClosedLostDialog";
import { OpportunityViewToggle } from "./OpportunityViewToggle";

type BoardData = { key: string; rows: RecordRow[]; total: number };

const DEFAULTS = { view: "", entity_id: "", close_date: "" };
const LONG_PRESS_MS = 350;

/** Stage color_token -> classes (literal for Tailwind). */
const STAGE_DOT: Record<string, string> = {
  "oboya-orange": "bg-oboya-orange",
  "oboya-blue": "bg-oboya-blue",
  "oboya-blue-light": "bg-oboya-blue-light",
  "oboya-green": "bg-oboya-green",
  "oboya-green-light": "bg-oboya-green-light",
  "oboya-blue-dark": "bg-oboya-blue-dark",
  "oboya-yellow-light": "bg-oboya-yellow-light",
  "oboya-yellow-dark": "bg-oboya-yellow-dark",
  "oboya-soft-white": "bg-oboya-soft-white ring-1 ring-border",
};

function stageDot(stage: StageOption) {
  if (stage.color && STAGE_DOT[stage.color]) return STAGE_DOT[stage.color];
  return stage.kind === "won" ? "bg-oboya-green" : stage.kind === "lost" ? "bg-oboya-orange" : "bg-oboya-blue";
}

type TouchDrag = { id: string; x: number; y: number; over: string | null };

/**
 * Opportunities kanban: one column per active stage with count, totals and
 * weighted totals per currency. Moves: native HTML5 drag and drop (mouse),
 * long-press drag via pointer events (touch), or the "Move to…" select on each
 * card (keyboard / mobile). Moves are optimistic and roll back on error.
 */
export function OpportunityKanban({
  lookups,
  initial,
  today,
}: {
  lookups: RecordLookups;
  initial?: BoardData;
  /** YYYY-MM-DD, for overdue close dates. */
  today: string;
}) {
  const t = useTranslations("opportunities");
  const tl = useTranslations("listViews");
  const ts = useTranslations("shell");
  const format = useFormatter();
  const { can } = useCrm();
  const errorMessage = useApiErrorMessage();
  const canEdit = can("opportunities", "edit");
  const stages = lookups.stages;

  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const key = pipelineKey(filters);
  const [data, setData] = useState<BoardData | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (data?.key === key && retry === 0) return;
    const controller = new AbortController();
    apiFetch<{ rows: RecordRow[]; total: number }>(`/api/crm/opportunities/pipeline?${key}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData({ key, ...result });
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(key);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when filters (or retry) change
  }, [key, retry]);

  const rows = useMemo(() => (data?.key === key ? data.rows : []), [data, key]);
  const loading = data?.key !== key && error !== key;

  const setRow = (id: string, row: RecordRow) =>
    setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === id ? row : r)) } : d));

  // --- moves --------------------------------------------------------------
  const [lostMove, setLostMove] = useState<{ row: RecordRow; stage: StageOption } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const commit = async (row: RecordRow, stage: StageOption, loss?: { reason: string; note: string | null }) => {
    const currentStage = stages.find((s) => s.value === row.stage_id);
    const plan = planStageChange(
      {
        stageId: String(row.stage_id),
        probability: typeof row.probability === "number" ? row.probability : null,
        lossReason: (row.loss_reason as string | null) ?? null,
        lossNote: (row.loss_note as string | null) ?? null,
      },
      currentStage ? { id: currentStage.value, kind: currentStage.kind, probability: currentStage.probability } : null,
      { id: stage.value, kind: stage.kind, probability: stage.probability },
      { stageId: stage.value, lossReason: loss?.reason, lossNote: loss?.note }
    );
    const optimistic: RecordRow = {
      ...row,
      stage_id: stage.value,
      stage_kind: stage.kind,
      ...(plan.ok ? plan.patch : {}),
      _display: { ...(row._display ?? {}), stage_id: stage.label },
    };
    setRow(row.id, optimistic);
    try {
      const { record } = await moveOpportunityStage(row.id, {
        stageId: stage.value,
        lossReason: loss?.reason,
        lossNote: loss?.note,
      });
      setRow(row.id, { ...record, stage_kind: stage.kind });
      toast.success(t("toast.moved", { stage: stage.label }));
      setAnnouncement(t("kanban.moved", { name: row._display?._name ?? "", stage: stage.label }));
      setLostMove(null);
    } catch (err) {
      setRow(row.id, row);
      toast.error(errorMessage(err));
    }
  };

  const requestMove = (id: string, stageId: string) => {
    const row = rows.find((r) => r.id === id);
    const stage = stages.find((s) => s.value === stageId);
    if (!row || !stage || row.stage_id === stageId || !canEdit) return;
    if (stage.kind === "lost") setLostMove({ row, stage });
    else void commit(row, stage);
  };

  // --- HTML5 drag and drop (mouse) ----------------------------------------
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  // --- touch: long press then drag with pointer events ----------------------
  const [touch, setTouch] = useState<TouchDrag | null>(null);
  const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    if (!touch) return;
    // Block page scrolling while a card is being dragged by touch.
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [touch]);

  const stageAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-stage-id]") as HTMLElement | null)?.dataset.stageId ?? null;

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.pointerType === "mouse" || !canEdit) return;
    if ((e.target as HTMLElement).closest("a,select,button")) return;
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const { clientX: x, clientY: y } = e;
    press.current = {
      id,
      x,
      y,
      timer: setTimeout(() => {
        try {
          target.setPointerCapture(pointerId);
        } catch {
          /* pointer already released */
        }
        setTouch({ id, x, y, over: stageAt(x, y) });
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS),
    };
  };
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (touch) {
      setTouch({ ...touch, x: e.clientX, y: e.clientY, over: stageAt(e.clientX, e.clientY) });
    } else if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) {
      cancelPress(); // the user is scrolling
    }
  };
  const onPointerUp = () => {
    cancelPress();
    if (touch) {
      if (touch.over) requestMove(touch.id, touch.over);
      setTouch(null);
    }
  };

  // --- render ---------------------------------------------------------------
  const byStage = useMemo(() => {
    const map = new Map<string, RecordRow[]>(stages.map((s) => [s.value, []]));
    for (const row of rows) map.get(String(row.stage_id))?.push(row);
    return map;
  }, [rows, stages]);

  const money = (amount: number, currency: string) =>
    format.number(amount, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  const moneyList = (values: Record<string, number>) =>
    Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, v]) => money(v, c))
      .join(" · ") || "—";

  const view = filters.view || "mine";
  const activeFilters = Boolean(filters.entity_id || filters.close_date || filters.view);
  const draggingId = dragId ?? touch?.id ?? null;
  const hoverStage = touch ? touch.over : overStage;
  const touchRow = touch ? rows.find((r) => r.id === touch.id) : null;

  return (
    <>
      <CrmPageHeader title={t("pipelineTitle")} actions={<OpportunityViewToggle current="kanban" />} />

      <div className="space-y-3">
        <FilterBar
          showReset={activeFilters}
          onReset={reset}
          actions={
            data && data.total > PIPELINE_LIMIT && data.key === key ? (
              <p className="text-xs text-muted-foreground">{t("pipelineLimit", { limit: PIPELINE_LIMIT })}</p>
            ) : null
          }
        >
          <FilterTabs
            value={view}
            onChange={(next) => setFilters({ view: next === "mine" ? "" : next })}
            options={[
              { value: "mine", label: t("owner.mine") },
              { value: "all", label: t("owner.all") },
            ]}
          />
          <FilterSelect
            label={t("fields.entity")}
            value={filters.entity_id}
            options={lookups.entities}
            allLabel={tl("filterAll")}
            onChange={(value) => setFilters({ entity_id: value })}
          />
          <DateRangeFilter
            label={t("fields.closeDate")}
            value={filters.close_date}
            onChange={(value) => setFilters({ close_date: value })}
          />
        </FilterBar>

        {error === key ? (
          <ErrorState message={ts("failedToLoad")} onRetry={() => setRetry((n) => n + 1)} />
        ) : (
          <div
            className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0"
            aria-busy={loading || undefined}
          >
            {stages.map((stage) => {
              const columnRows = byStage.get(stage.value) ?? [];
              const summary = summarizeColumn(columnRows);
              const isOver = draggingId !== null && hoverStage === stage.value;
              return (
                <section
                  key={stage.value}
                  data-stage-id={stage.value}
                  aria-label={stage.label}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overStage !== stage.value) setOverStage(stage.value);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverStage(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragId;
                    setDragId(null);
                    setOverStage(null);
                    if (id) requestMove(id, stage.value);
                  }}
                  className={cn(
                    "flex w-[82vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-xl border bg-oboya-soft-white/60 sm:w-72",
                    isOver ? "border-oboya-blue-light ring-2 ring-oboya-blue-light/40" : "border-border/60"
                  )}
                >
                  <header className="space-y-1 border-b border-border/50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", stageDot(stage))} />
                      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-oboya-blue-dark">{stage.label}</h2>
                      <span className="rounded-full bg-white px-2 text-[11px] font-medium text-oboya-blue-dark ring-1 ring-border/60">
                        {loading ? "…" : summary.count}
                      </span>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px] text-muted-foreground">
                      <dt>{t("kanban.total")}</dt>
                      <dd className="truncate text-right tabular-nums text-oboya-blue-dark">{moneyList(summary.totals)}</dd>
                      <dt>{t("kanban.weighted")}</dt>
                      <dd className="truncate text-right tabular-nums text-oboya-blue-dark">{moneyList(summary.weighted)}</dd>
                    </dl>
                  </header>
                  <ol className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                    {columnRows.map((row) => (
                      <KanbanCard
                        key={row.id}
                        row={row}
                        stages={stages}
                        today={today}
                        canEdit={canEdit}
                        dragging={draggingId === row.id}
                        onMove={(stageId) => requestMove(row.id, stageId)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", row.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(row.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStage(null);
                        }}
                        onPointerDown={(e) => onPointerDown(e, row.id)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => {
                          cancelPress();
                          setTouch(null);
                        }}
                      />
                    ))}
                    {!loading && columnRows.length === 0 ? (
                      <li className="rounded-lg border border-dashed border-border/80 px-3 py-6 text-center text-xs text-muted-foreground">
                        {t("kanban.empty")}
                      </li>
                    ) : null}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {touch && touchRow ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 w-56 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-oboya-blue-light bg-white px-3 py-2 text-sm font-medium text-oboya-blue-dark shadow-lg"
          style={{ left: touch.x, top: touch.y }}
        >
          <span className="line-clamp-2">{touchRow._display?._name}</span>
        </div>
      ) : null}

      {lostMove ? (
        <ClosedLostDialog
          stageLabel={lostMove.stage.label}
          name={lostMove.row._display?._name ?? ""}
          reasons={lookups.picklists.loss_reason ?? []}
          onCancel={() => setLostMove(null)}
          onConfirm={(reason, note) => commit(lostMove.row, lostMove.stage, { reason, note })}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

function KanbanCard({
  row,
  stages,
  today,
  canEdit,
  dragging,
  onMove,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  row: RecordRow;
  stages: StageOption[];
  today: string;
  canEdit: boolean;
  dragging: boolean;
  onMove: (stageId: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const t = useTranslations("opportunities");
  const format = useFormatter();
  const name = row._display?._name || "—";
  const owner = row._display?.owner_id ?? "";
  const kind = stages.find((s) => s.value === row.stage_id)?.kind;
  const overdue = isOverdue(row.close_date, kind, today);
  const amount = typeof row.amount === "number" ? row.amount : row.amount != null ? Number(row.amount) : null;
  const currency = typeof row.currency === "string" ? row.currency : "USD";

  return (
    <li
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        "space-y-1.5 rounded-lg border border-border/60 bg-white p-2.5 shadow-sm select-none [-webkit-touch-callout:none]",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50"
      )}
    >
      <div className="flex items-start gap-2">
        <Link
          href={`/opportunities/${row.id}`}
          draggable={false}
          className="min-w-0 flex-1 text-sm font-medium break-words text-oboya-blue-light hover:underline"
        >
          {name}
        </Link>
        {owner ? (
          <span title={owner}>
            <EntityAvatar name={owner} size="sm" />
            <span className="sr-only">{t("kanban.owner", { name: owner })}</span>
          </span>
        ) : null}
      </div>
      {row._display?.account_id ? <p className="truncate text-xs text-muted-foreground">{row._display.account_id}</p> : null}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold tabular-nums text-oboya-blue-dark">
          {amount !== null && Number.isFinite(amount) ? format.number(amount, { style: "currency", currency }) : "—"}
        </span>
        {typeof row.close_date === "string" ? (
          <span className={cn("tabular-nums", overdue ? "font-semibold text-oboya-orange" : "text-muted-foreground")}>
            {overdue ? <span className="sr-only">{t("kanban.overdue")} </span> : null}
            {format.dateTime(new Date(`${row.close_date}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <select
          aria-label={t("kanban.moveTo", { name })}
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="h-7 w-full rounded-md border border-border/70 bg-white px-1.5 text-[11px] text-oboya-blue-dark"
        >
          <option value="">{t("kanban.movePlaceholder")}</option>
          {stages
            .filter((s) => s.value !== row.stage_id)
            .map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
        </select>
      ) : null}
    </li>
  );
}
