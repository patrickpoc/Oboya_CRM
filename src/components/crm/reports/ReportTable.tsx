"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { EmptyState } from "@/components/crm/common/states";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import type { FieldType } from "@/lib/crm/objects/types";
import {
  rowPath,
  type GroupedReportResult,
  type ReportGroup,
  type ReportResult,
  type ReportRow,
} from "@/lib/crm/reports/definition";
import { cn } from "@/lib/utils";

/** Cell formatting shared by the three report shapes. */
function useFormatters(result: ReportResult) {
  const format = useFormatter();
  const tRecord = useTranslations("record");
  const config = getRecordConfig(result.object);
  const base = "currency" in result ? result.currency.base : "USD";
  const money = (value: number, currency: string) => {
    try {
      return format.number(value, { style: "currency", currency });
    } catch {
      return format.number(value);
    }
  };

  const field = (row: ReportRow, key: string, type: FieldType): string => {
    const display = row._display?.[key];
    if (display) return display;
    const value = row[key];
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "—";
    switch (type) {
      case "boolean":
        return tRecord(value ? "yes" : "no");
      case "date":
        return format.dateTime(new Date(`${String(value).slice(0, 10)}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
      case "datetime":
        return format.dateTime(new Date(String(value)), {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: result.timeZone,
        });
      case "currency": {
        const code = config?.fields.find((f) => f.key === key)?.currencyField;
        const currency = code ? String(row[code] ?? "USD") : "USD";
        return money(Number(value), currency);
      }
      case "number":
        return format.number(Number(value));
      case "percent":
        return `${format.number(Number(value))}%`;
      default:
        return Array.isArray(value) ? value.join(", ") : String(value);
    }
  };

  const aggregate = (value: number | undefined, type: FieldType): string => {
    if (value === undefined) return "";
    if (type === "currency") return money(value, base);
    if (type === "percent") return `${format.number(value, { maximumFractionDigits: 2 })}%`;
    return format.number(value, { maximumFractionDigits: 2 });
  };

  return { field, aggregate };
}

function TabularTable({ result }: { result: Extract<ReportResult, { type: "tabular" }> }) {
  const t = useTranslations("reports.table");
  const { field } = useFormatters(result);
  const columns: DataTableColumn<ReportRow>[] = result.columns.map((c) => ({
    key: c.key,
    header: c.label,
    sortable: true,
    sortValue: (row) => {
      const v = row._display?.[c.key] ?? row[c.key];
      return typeof v === "number" ? v : String(v ?? "");
    },
    cell: (row) => field(row, c.key, c.type),
  }));
  return (
    <div role="region" aria-label={t("tabular")}>
    <DataTable<ReportRow>
      data={result.rows}
      columns={columns}
      getRowId={(row) => String(row.id)}
      pageSize={25}
      emptyState={<EmptyState title={t("empty")} />}
    />
    </div>
  );
}

function GroupedTable({ result }: { result: GroupedReportResult }) {
  const t = useTranslations("reports.table");
  const { aggregate } = useFormatters(result);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const aggCols = result.columns.filter((c) => c.kind === "aggregate");
  const groupCols = result.columns.filter((c) => c.kind === "group");
  const matrix = result.type === "matrix";
  const multi = aggCols.length > 1;
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  if (result.groups.length === 0) return <EmptyState title={t("noGroups")} />;

  const numCell = "text-right tabular-nums";
  const stickyFirst = "sticky left-0 z-10 bg-white";

  const valueCells = (values: number[] | undefined, keyPrefix: string, strong = false) =>
    aggCols.map((c, i) => (
      <TableCell key={`${keyPrefix}-${c.key}`} className={cn(numCell, strong && "font-semibold")}>
        {aggregate(values?.[i], c.type) || (values ? "" : "—")}
      </TableCell>
    ));

  const renderGroup = (g: ReportGroup, parent: string | null) => {
    const id = parent ? `${parent}/${g.key}` : g.key;
    const hasChildren = Boolean(g.children?.length);
    const open = !collapsed.has(id);
    return (
      <Fragment key={id}>
        <TableRow className={cn(hasChildren && "bg-oboya-soft-white/60")}>
          <TableCell className={cn(matrix && stickyFirst, parent && "pl-8", "font-medium text-oboya-blue-dark")}>
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={t(open ? "collapse" : "expand", { name: g.label })}
                onClick={() => toggle(id)}
                className="mr-1 inline-flex size-6 items-center justify-center rounded align-middle text-oboya-blue hover:bg-muted"
              >
                {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              </button>
            ) : null}
            {g.label}
          </TableCell>
          {matrix
            ? result.colKeys.map((c) => (
                <Fragment key={c.key}>{valueCells(result.cells[rowPath([g.key])]?.[c.key], `${id}-${c.key}`)}</Fragment>
              ))
            : null}
          {valueCells(g.values, id, hasChildren || matrix)}
        </TableRow>
        {hasChildren && open ? g.children!.map((child) => renderGroup(child, id)) : null}
      </Fragment>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <Table>
        <caption className="sr-only">{t(matrix ? "matrix" : "summary")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={matrix && multi ? 2 : 1} className={cn(matrix && stickyFirst)}>
              {groupCols.map((c) => c.label).join(" / ") || t("group")}
            </TableHead>
            {matrix
              ? result.colKeys.map((c) => (
                  <TableHead key={c.key} colSpan={aggCols.length} className="text-right">
                    {c.label}
                  </TableHead>
                ))
              : null}
            {matrix ? (
              <TableHead colSpan={aggCols.length} className="text-right">
                {t("total")}
              </TableHead>
            ) : (
              aggCols.map((c) => (
                <TableHead key={c.key} className="text-right">
                  {c.label}
                </TableHead>
              ))
            )}
          </TableRow>
          {matrix && multi ? (
            <TableRow>
              {[...result.colKeys.map((c) => c.key), "__total"].flatMap((k) =>
                aggCols.map((c) => (
                  <TableHead key={`${k}-${c.key}`} className="text-right text-xs font-normal">
                    {c.label}
                  </TableHead>
                ))
              )}
            </TableRow>
          ) : null}
        </TableHeader>
        <TableBody>
          {result.groups.map((g) => renderGroup(g, null))}
          <TableRow className="border-t-2 bg-muted/30">
            <TableCell className={cn("font-semibold text-oboya-blue-dark", matrix && stickyFirst, matrix && "bg-muted")}>
              {t("total")}
            </TableCell>
            {matrix ? result.colKeys.map((c) => <TableCell key={c.key} colSpan={aggCols.length} />) : null}
            {valueCells(result.totals, "total", true)}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export function ReportTable({ result }: { result: ReportResult }) {
  const t = useTranslations("reports.table");
  return result.type === "tabular" ? (
    <TabularTable result={result} />
  ) : (
    <div className="space-y-2">
      <GroupedTable result={result} />
      <p className="text-xs text-muted-foreground">{t("multiValue")}</p>
    </div>
  );
}
