"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DateRangeFilter } from "@/components/crm/common/DateRangeFilter";
import { EntityAvatar } from "@/components/crm/common/EntityAvatar";
import { FilterBar, FilterSelect } from "@/components/crm/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/crm/common/states";
import { StatusPill, type PillTone } from "@/components/crm/common/StatusPill";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  auditRecordHref,
  auditRecordLabel,
  diffEntries,
  formatDiffValue,
} from "@/lib/crm/setup/audit";
import type { SetupAuditLog } from "@/lib/crm/setup/rows";
import { cn } from "@/lib/utils";
import { apiFetch, useErrorMessage } from "./shared";

type Payload = {
  logs: SetupAuditLog[];
  total: number;
  page: number;
  pageSize: number;
  actors: { id: string; name: string }[];
};

const PAGE_SIZE = 25;
const ACTION_TONES: Record<string, PillTone> = {
  create: "success",
  update: "info",
  delete: "danger",
  restore: "highlight",
  stage_change: "brand",
  owner_change: "warning",
  convert: "success",
};

/** Setup -> Audit log (D4): filterable, paginated, expandable diffs. */
export function AuditLogSetup() {
  const t = useTranslations("setup.audit");
  const tc = useTranslations("setup.common");
  const tAct = useTranslations("activities");
  const format = useFormatter();
  const contextLabel = (ctx: SetupAuditLog["context"]) => {
    if (!ctx) return null;
    if (typeof ctx.rule_name === "string" && ctx.rule_name) return t("contextRule", { name: ctx.rule_name });
    if (typeof ctx.template_name === "string" && ctx.template_name) return t("contextTemplate", { name: ctx.template_name });
    if (typeof ctx.kind === "string" && ctx.kind) {
      return t("contextKindLabel", { kind: t.has(`contextKind.${ctx.kind}`) ? t(`contextKind.${ctx.kind}`) : ctx.kind });
    }
    return null;
  };
  const errorMessage = useErrorMessage();
  const { filters, setFilters, reset } = useUrlFilters({ object: "", action: "", actor: "", from: "", to: "", page: "0" });
  const [result, setResult] = useState<{ key: string; data?: Payload; error?: unknown } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [retry, setRetry] = useState(0);

  const page = Math.max(0, Number.parseInt(filters.page, 10) || 0);
  const query = new URLSearchParams({
    ...(filters.object ? { object: filters.object } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actor ? { actor: filters.actor } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    page: String(page),
    pageSize: String(PAGE_SIZE),
  }).toString();

  useEffect(() => {
    let cancelled = false;
    apiFetch<Payload>(`/api/crm/audit-logs?${query}`)
      .then((data) => !cancelled && setResult({ key: query, data }))
      .catch((error) => !cancelled && setResult({ key: query, error }));
    return () => {
      cancelled = true;
    };
  }, [query, retry]);

  const data = result?.data;
  const loading = result?.key !== query;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const setFilter = (patch: Partial<typeof filters>) => setFilters({ ...patch, page: "0" });
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <CrmPageHeader title={t("title")} description={t("description")} />
      <FilterBar
        className="mb-4"
        showReset={Boolean(filters.object || filters.action || filters.actor || filters.from || filters.to)}
        onReset={reset}
      >
        <FilterSelect
          label={t("object")}
          value={filters.object}
          onChange={(object) => setFilter({ object })}
          options={AUDIT_OBJECTS.map((o) => ({ value: o, label: t(`objects.${o}`) }))}
        />
        <FilterSelect
          label={t("action")}
          value={filters.action}
          onChange={(action) => setFilter({ action })}
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: t(`actions.${a}`) }))}
        />
        <FilterSelect
          label={t("actor")}
          value={filters.actor}
          onChange={(actor) => setFilter({ actor })}
          options={(data?.actors ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <DateRangeFilter
          label={t("date")}
          value={filters.from || filters.to ? `${filters.from}..${filters.to}` : ""}
          onChange={(range) => {
            const [from = "", to = ""] = range ? range.split("..") : [];
            setFilter({ from, to });
          }}
        />
      </FilterBar>

      {result?.error && !loading ? (
        <ErrorState message={errorMessage(result.error)} onRetry={() => setRetry((n) => n + 1)} />
      ) : loading && !data ? (
        <TableSkeleton columns={5} />
      ) : data && data.logs.length === 0 ? (
        <EmptyState title={t("empty")} description={t("emptyDescription")} />
      ) : data ? (
        <div className={cn("space-y-3", loading && "opacity-60")} aria-busy={loading}>
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">{t("date")}</th>
                  <th className="px-3 py-2 font-medium">{t("actor")}</th>
                  <th className="px-3 py-2 font-medium">{t("action")}</th>
                  <th className="px-3 py-2 font-medium">{t("record")}</th>
                  <th className="px-3 py-2 font-medium">{t("changes")}</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((log) => {
                  const entries = diffEntries(log.diff);
                  const open = expanded.has(log.id);
                  const href = auditRecordHref(log.object, log.recordId);
                  return (
                    <Fragment key={log.id}>
                      <tr className="border-b border-border/40 align-top">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={open ? t("collapse") : t("expand")}
                            disabled={entries.length === 0}
                            onClick={() => toggle(log.id)}
                            className="rounded p-1 hover:bg-muted disabled:opacity-30"
                          >
                            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                          </button>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {format.dateTime(new Date(log.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-2">
                            <EntityAvatar name={log.actorName} size="sm" />
                            {log.actorName === "Automation" ? tAct("automationActor") : log.actorName}
                          </span>
                          {contextLabel(log.context) ? (
                            <span className="block text-[11px] text-muted-foreground">{contextLabel(log.context)}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill tone={ACTION_TONES[log.action] ?? "neutral"}>
                            {t.has(`actions.${log.action}`) ? t(`actions.${log.action}`) : log.action}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2">
                          {href ? (
                            <Link href={href} className="inline-flex items-center gap-1 text-oboya-blue hover:underline">
                              {t.has(`objects.${log.object}`) ? t(`objects.${log.object}`) : log.object}
                              <ExternalLink className="size-3" />
                            </Link>
                          ) : (
                            <span>{t.has(`objects.${log.object}`) ? t(`objects.${log.object}`) : log.object}</span>
                          )}
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {auditRecordLabel(log.recordId, log.recordKey)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {t("fieldsChanged", { count: entries.length })}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-border/40 bg-oboya-soft-white/60">
                          <td />
                          <td colSpan={5} className="px-3 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="py-1 pr-3 font-medium">{t("field")}</th>
                                  <th className="py-1 pr-3 font-medium">{t("before")}</th>
                                  <th className="py-1 font-medium">{t("after")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entries.map((entry) => (
                                  <tr key={entry.field} className="align-top">
                                    <td className="py-1 pr-3 font-mono text-oboya-blue-dark">{entry.field}</td>
                                    <td className="py-1 pr-3 break-all text-oboya-orange line-through decoration-oboya-orange/40">
                                      {formatDiffValue(entry.before)}
                                    </td>
                                    <td className="py-1 break-all text-oboya-green">{formatDiffValue(entry.after)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t("showing", {
                from: page * PAGE_SIZE + 1,
                to: page * PAGE_SIZE + data.logs.length,
                total: data.total,
              })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setFilters({ page: String(page - 1) })}
                aria-label={tc("previousPage")}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border p-2 disabled:opacity-40 md:min-h-8 md:min-w-8"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span>
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setFilters({ page: String(page + 1) })}
                aria-label={tc("nextPage")}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border p-2 disabled:opacity-40 md:min-h-8 md:min-w-8"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
