"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { FilterTabs } from "@/components/crm/common/FilterBar";
import { ChartCard } from "@/components/crm/dashboard/ChartCard";
import type { StagePoint } from "@/lib/crm/dashboard/aggregate";

type Metric = "amount" | "count";

/**
 * Open opportunities per active stage (stage order). One series, so one brand
 * colour, no legend; hover tooltip plus an sr-only table for screen readers.
 * Amount needs the FX table (mixed currencies cannot be summed otherwise).
 */
export function PipelineChart({ stages, base }: { stages: StagePoint[]; base: string | null }) {
  const t = useTranslations("dashboard.chart");
  const format = useFormatter();
  const [picked, setPicked] = useState<Metric>("amount");
  const metric: Metric = base ? picked : "count";

  const money = (n: number) =>
    format.number(n, { style: "currency", currency: base ?? "USD", maximumFractionDigits: 0 });
  const compact = (n: number) =>
    metric === "amount"
      ? format.number(n, { style: "currency", currency: base ?? "USD", notation: "compact", maximumFractionDigits: 1 })
      : format.number(n, { maximumFractionDigits: 0 });
  const data = stages.map((s) => ({ label: s.label, value: metric === "amount" ? (s.amount ?? 0) : s.count }));
  const empty = stages.every((s) => s.count === 0);

  return (
    <ChartCard
      title={t("title")}
      description={base ? (metric === "amount" ? t("amountIn", { currency: base }) : undefined) : t("noFx")}
      type="bar"
      data={data}
      xKey="label"
      yKey="value"
      color="var(--oboya-blue)"
      height={240}
      seriesLabel={metric === "amount" ? t("amount") : t("opportunities")}
      formatValue={metric === "amount" ? money : (n) => format.number(n)}
      formatTick={compact}
      actions={
        base ? (
          <FilterTabs
            value={metric}
            onChange={(v) => setPicked(v as Metric)}
            options={[
              { value: "amount", label: t("amount") },
              { value: "count", label: t("count") },
            ]}
            className="shrink-0"
          />
        ) : null
      }
    >
      {empty ? <p className="mt-2 text-center text-xs text-muted-foreground">{t("empty")}</p> : null}
      <table className="sr-only">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("stage")}</th>
            <th scope="col">{t("opportunities")}</th>
            {base ? <th scope="col">{t("amountIn", { currency: base })}</th> : null}
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{s.count}</td>
              {base ? <td>{money(s.amount ?? 0)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}
