import type { CrmObject, Option, RecordRow } from "@/lib/crm/objects/types";
import type { CurrencyTotals, StagePoint } from "./aggregate";

/** Amount KPI: per-currency totals plus the FX rollup when a table exists. */
export type MoneyKpi = {
  count: number;
  totals: CurrencyTotals;
  /** Sum in `base` (null when crm_settings has no usable FX table). */
  converted: number | null;
  base: string | null;
  /** Currencies without a rate (left out of `converted`). */
  missing: string[];
};

export type RecentRecord = { object: CrmObject; id: string; name: string; viewedAt: string };

/** GET /api/crm/dashboard. A null section = no permission on that module. */
export type DashboardData = {
  leads: { open: number; slaOverdue: number } | null;
  pipeline: MoneyKpi | null;
  won: MoneyKpi | null;
  tasks: { today: number; overdue: number } | null;
  stages: StagePoint[] | null;
  myTasks: RecordRow[] | null;
  recent: RecentRecord[];
  entities: Option[];
};
