"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Legend } from "@/components/crm/common/Legend";
import { ChartCard } from "@/components/crm/dashboard/ChartCard";
import { rowPath, type ReportDefinition, type ReportResult } from "@/lib/crm/reports/definition";

/** Brand palette in series order (AGENTS.md tokens only). */
export const REPORT_CHART_COLORS = [
  "var(--oboya-blue)",
  "var(--oboya-green)",
  "var(--oboya-blue-light)",
  "var(--oboya-green-light)",
  "var(--oboya-orange)",
  "var(--oboya-yellow-dark)",
  "var(--oboya-blue-dark)",
  "var(--oboya-yellow-light)",
] as const;
const MAX_SERIES = REPORT_CHART_COLORS.length;
const OTHER_KEY = "__other__";

type Model = {
  categories: { key: string; label: string }[];
  series: { key: string; label: string }[];
  /** values[category][series] */
  values: number[][];
  /** Series beyond the palette were dropped (non-additive aggregate). */
  dropped: boolean;
  fn: string;
  currency: string | null;
  isPercent: boolean;
};

function buildModel(
  result: ReportResult,
  chart: ReportDefinition["chart"],
  labels: { metric: string; other: string },
): Model | null {
  if (result.type === "tabular") return null;
  const m = Math.min(chart.metric, result.aggregates.length - 1);
  if (m < 0) return null;
  const agg = result.aggregates[m];
  const col = result.columns.filter((c) => c.kind === "aggregate")[m];
  const base = {
    fn: agg.fn,
    currency: col?.type === "currency" ? result.currency.base : null,
    isPercent: col?.type === "percent",
  };
  const categories = result.groups.map((g) => ({ key: g.key, label: g.label }));
  let series: Model["series"];
  let values: number[][];

  if (result.type === "matrix") {
    series = result.colKeys;
    values = result.groups.map((g) =>
      series.map((s) => result.cells[rowPath([g.key])]?.[s.key]?.[m] ?? 0),
    );
  } else if (
    (chart.type === "bar" || chart.type === "line") &&
    result.groups.some((g) => g.children?.length)
  ) {
    const seen = new Map<string, string>();
    for (const g of result.groups)
      for (const c of g.children ?? []) if (!seen.has(c.key)) seen.set(c.key, c.label);
    series = [...seen].map(([key, label]) => ({ key, label }));
    values = result.groups.map((g) =>
      series.map((s) => g.children?.find((c) => c.key === s.key)?.values[m] ?? 0),
    );
  } else {
    series = [{ key: "v", label: labels.metric }];
    values = result.groups.map((g) => [g.values[m] ?? 0]);
  }

  let dropped = false;
  if (series.length > MAX_SERIES) {
    const totals = series.map((_, i) => values.reduce((n, row) => n + row[i], 0));
    const order = series.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
    const additive = agg.fn === "count" || agg.fn === "sum";
    const keep = order.slice(0, additive ? MAX_SERIES - 1 : MAX_SERIES).sort((a, b) => a - b);
    const rest = order.filter((i) => !keep.includes(i));
    const nextSeries = keep.map((i) => series[i]);
    const nextValues = values.map((row) => keep.map((i) => row[i]));
    if (additive) {
      nextSeries.push({ key: OTHER_KEY, label: labels.other });
      nextValues.forEach((row, r) => row.push(rest.reduce((n, i) => n + values[r][i], 0)));
    } else dropped = true;
    series = nextSeries;
    values = nextValues;
  }
  let cats = categories;
  if ((chart.type === "funnel" || chart.type === "donut") && cats.length > MAX_SERIES) {
    // One colour per slice: keep the first 7 and fold the rest into "Other" (count/sum only).
    const keep = MAX_SERIES - 1;
    const additive = agg.fn === "count" || agg.fn === "sum";
    const tail = values.slice(keep);
    cats = cats.slice(0, keep);
    values = values.slice(0, keep);
    if (additive) {
      cats = [...cats, { key: OTHER_KEY, label: labels.other }];
      values = [...values, [tail.reduce((n, row) => n + (row[0] ?? 0), 0)]];
    } else dropped = true;
  }
  return { categories: cats, series, values, dropped, ...base };
}

/**
 * Report chart (bar, line, funnel, donut) in the ChartCard shell. Colors follow
 * the brand palette order; every chart has a legend (not color alone) and an
 * sr-only data table.
 */
export function ReportChart({
  result,
  chart,
  title,
  height,
  compact = false,
}: {
  result: ReportResult;
  chart: ReportDefinition["chart"];
  title?: string;
  height?: number;
  compact?: boolean;
}) {
  const t = useTranslations("reports.chart");
  const format = useFormatter();
  const h = height ?? (compact ? 200 : 300);

  const model = useMemo(
    () => buildModel(result, chart, { metric: t("value"), other: t("other") }),
    [result, chart, t],
  );
  const metricLabel =
    result.type === "tabular"
      ? ""
      : (result.aggregates[Math.min(chart.metric, result.aggregates.length - 1)]?.label ?? "");

  const fmt = (n: number) => {
    if (!model) return String(n);
    if (model.currency)
      return format.number(n, { style: "currency", currency: model.currency, maximumFractionDigits: 0 });
    const s = format.number(n, { maximumFractionDigits: 2 });
    return model.isPercent ? `${s}%` : s;
  };
  const tick = (n: number) =>
    model?.currency
      ? format.number(n, { style: "currency", currency: model.currency, notation: "compact", maximumFractionDigits: 1 })
      : format.number(n, { notation: "compact", maximumFractionDigits: 1 });

  const heading = title ?? t("title");

  if (chart.type === "none" || !model) {
    return (
      <ChartCard
        title={heading}
        chart={<p className="py-6 text-center text-sm text-muted-foreground">{t("none")}</p>}
      />
    );
  }
  const empty =
    model.categories.length === 0 || model.values.every((row) => row.every((v) => v === 0));
  if (empty) {
    return (
      <ChartCard
        title={heading}
        chart={<p className="py-6 text-center text-sm text-muted-foreground">{t("noData")}</p>}
      />
    );
  }

  const color = (i: number) => REPORT_CHART_COLORS[i % MAX_SERIES];
  const stacked = chart.stacked ?? result.type === "matrix";
  const rows = model.categories.map((c, r) => {
    const row: Record<string, string | number> = { label: c.label };
    model.series.forEach((_, s) => (row[`s${s}`] = model.values[r][s]));
    return row;
  });
  const pieData = model.categories.map((c, r) => ({
    name: c.label,
    value: model.values[r][0],
    fill: color(r),
  }));
  const total = pieData.reduce((n, p) => n + p.value, 0);
  const tooltipStyle = { borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 };
  const axisTick = { fontSize: 11 };
  const multi = model.series.length > 1;

  let body: React.ReactNode;
  if (chart.type === "donut") {
    body = (
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={1}
            stroke="var(--background)"
            isAnimationActive={false}
          />
          <Tooltip formatter={(v, name) => [fmt(Number(v)), String(name)]} contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    );
  } else if (chart.type === "funnel") {
    body = (
      <ResponsiveContainer width="100%" height={h}>
        <FunnelChart>
          <Tooltip formatter={(v, name) => [fmt(Number(v)), String(name)]} contentStyle={tooltipStyle} />
          <Funnel data={pieData} dataKey="value" nameKey="name" isAnimationActive={false}>
            {compact ? null : (
              <LabelList
                position="right"
                dataKey="name"
                fill="var(--oboya-blue-dark)"
                stroke="none"
                fontSize={11}
              />
            )}
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  } else {
    const common = (
      <>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={axisTick} width={compact ? 40 : 56} tickFormatter={(v) => tick(Number(v))} />
        <Tooltip
          formatter={(v, name) => [fmt(Number(v)), String(name)]}
          cursor={{ fill: "var(--oboya-soft-white)" }}
          contentStyle={tooltipStyle}
        />
      </>
    );
    body =
      chart.type === "line" ? (
        <ResponsiveContainer width="100%" height={h}>
          <LineChart data={rows}>
            {common}
            {model.series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={`s${i}`}
                name={s.label}
                stroke={color(i)}
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={rows}>
            {common}
            {model.series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={`s${i}`}
                name={s.label}
                fill={color(i)}
                stackId={stacked ? "stack" : undefined}
                radius={stacked ? undefined : [4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
  }

  const legendItems =
    chart.type === "donut" || chart.type === "funnel"
      ? pieData.map((p, i) => ({ key: String(i), name: p.name, fill: p.fill, extra: fmt(p.value) }))
      : multi
        ? model.series.map((s, i) => ({ key: s.key, name: s.label, fill: color(i), extra: "" }))
        : [];

  return (
    <ChartCard
      title={heading}
      description={compact ? undefined : metricLabel}
      chart={
        <>
          {body}
          {legendItems.length > 0 ? (
            <Legend
              className="mt-3"
              items={legendItems.map((l) => ({
                key: l.key,
                swatch: (
                  <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: l.fill }} />
                ),
                label: l.extra ? `${l.name} · ${l.extra}` : l.name,
              }))}
            />
          ) : null}
          {model.dropped ? <p className="mt-2 text-xs text-muted-foreground">{t("omitted")}</p> : null}
          {chart.type === "donut" && total > 0 ? <p className="sr-only">{t("total", { value: fmt(total) })}</p> : null}
          <table className="sr-only">
            <caption>{heading}</caption>
            <thead>
              <tr>
                <th scope="col">{t("group")}</th>
                {model.series.map((s) => (
                  <th key={s.key} scope="col">
                    {multi ? s.label : metricLabel || s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.categories.map((c, r) => (
                <tr key={c.key}>
                  <th scope="row">{c.label}</th>
                  {model.values[r].map((v, s) => (
                    <td key={s}>{fmt(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      }
    />
  );
}
