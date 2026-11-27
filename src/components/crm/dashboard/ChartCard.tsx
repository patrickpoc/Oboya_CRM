"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ChartRow = Record<string, string | number>;

/**
 * Line or bar chart in a card, generalised from the reference
 * VisitorsChart / QuotesChart (same sizes, grid, ticks and brand colors).
 */
export function ChartCard({
  title,
  data = [],
  xKey = "",
  yKey = "",
  type = "line",
  color,
  height = 220,
  description,
  actions,
  formatValue,
  formatTick,
  seriesLabel,
  children,
  chart,
}: {
  title: string;
  /** Built-in single-series chart; omit when passing `chart`. */
  data?: ChartRow[];
  xKey?: string;
  yKey?: string;
  type?: "line" | "bar";
  /** CSS color, brand tokens only (defaults: green line, blue bar). */
  color?: string;
  height?: number;
  description?: React.ReactNode;
  /** Header controls (e.g. a metric toggle). */
  actions?: React.ReactNode;
  /** Tooltip value format. */
  formatValue?: (value: number) => string;
  /** Y-axis tick format (e.g. compact numbers). */
  formatTick?: (value: number) => string;
  /** Tooltip series name (defaults to yKey). */
  seriesLabel?: string;
  /** Rendered under the chart, e.g. an sr-only data table. */
  children?: React.ReactNode;
  /** Custom chart body (e.g. ReportChart) rendered instead of the built-in line/bar. */
  chart?: React.ReactNode;
}) {
  const tooltip = (
    <Tooltip
      formatter={(value) => [
        formatValue ? formatValue(Number(value)) : String(value),
        seriesLabel ?? yKey,
      ]}
      cursor={{ fill: "var(--oboya-soft-white)" }}
      contentStyle={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        fontSize: 12,
      }}
    />
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        {chart ?? (
          <ResponsiveContainer width="100%" height={height}>
            {type === "line" ? (
              <LineChart data={data}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={
                    formatTick ? (v) => formatTick(Number(v)) : undefined
                  }
                />
                {tooltip}
                <Line
                  type="monotone"
                  dataKey={yKey}
                  stroke={color ?? "var(--oboya-green)"}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            ) : (
              <BarChart data={data}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={
                    formatTick ? (v) => formatTick(Number(v)) : undefined
                  }
                />
                {tooltip}
                <Bar
                  dataKey={yKey}
                  fill={color ?? "var(--oboya-blue)"}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
