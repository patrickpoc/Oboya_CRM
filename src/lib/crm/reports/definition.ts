/**
 * Report contracts: client-safe (no server imports). Shared by the engine,
 * the builder, the API routes and the dashboards.
 */
import { z } from "zod";
import {
  filterableFields,
  getField,
  parseListQuery,
  sortableKeys,
} from "@/lib/crm/objects/query";
import type {
  CrmObject,
  FieldType,
  RecordConfig,
} from "@/lib/crm/objects/types";

/** Cases are excluded in v1. */
export const REPORT_OBJECTS = [
  "lead",
  "account",
  "contact",
  "opportunity",
  "activity",
] as const;
export type ReportObject = (typeof REPORT_OBJECTS)[number];

export const REPORT_DEFINITION_VERSION = 1;
export const REPORT_TYPES = ["tabular", "summary", "matrix"] as const;
export const REPORT_BUCKETS = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const;
export const REPORT_AGG_FNS = ["count", "sum", "avg", "min", "max"] as const;
export const REPORT_CHART_TYPES = [
  "none",
  "bar",
  "line",
  "funnel",
  "donut",
] as const;

export const MAX_REPORT_COLUMNS = 20;
export const MAX_REPORT_AGGREGATES = 6;
export const MAX_REPORT_LIMIT = 2000;
export const MAX_DEFINITION_BYTES = 32 * 1024;
export const MAX_DASHBOARD_WIDGETS = 20;
export const MAX_HOME_WIDGETS = 24;
/** Rows read per run (guarded limit, `truncated` reports the overflow). */
export const REPORT_SCAN_CAP = 20_000;
/** Rows in a CSV export. */
export const REPORT_EXPORT_CAP = 5000;

export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportBucket = (typeof REPORT_BUCKETS)[number];
export type ReportAggFn = (typeof REPORT_AGG_FNS)[number];
export type ReportChartType = (typeof REPORT_CHART_TYPES)[number];

/** Field types a report can group by (rows or columns). */
export const groupableFieldTypes: readonly FieldType[] = [
  "picklist",
  "multipicklist",
  "tags",
  "lookup",
  "owner",
  "entity",
  "country",
  "boolean",
  "date",
  "datetime",
];
/** Field types sum/avg/min/max accept (count needs no field). */
export const aggregatableFieldTypes: readonly FieldType[] = [
  "number",
  "currency",
  "percent",
];
/** Field types a group can be bucketed by day/week/month/quarter/year. */
export const bucketableFieldTypes: readonly FieldType[] = ["date", "datetime"];

const fieldKey = z.string().min(1).max(64);

const GroupSchema = z.object({
  field: fieldKey,
  bucket: z.enum(REPORT_BUCKETS).optional(),
});
export type ReportGroupBy = z.infer<typeof GroupSchema>;

const AggregateSchema = z.object({
  fn: z.enum(REPORT_AGG_FNS),
  /** Required for every fn except count. */
  field: fieldKey.optional(),
});
export type ReportAggregate = z.infer<typeof AggregateSchema>;

export const ReportChartSchema = z.object({
  type: z.enum(REPORT_CHART_TYPES),
  /** Index into `aggregates` plotted by the chart. */
  metric: z
    .number()
    .int()
    .min(0)
    .max(MAX_REPORT_AGGREGATES - 1)
    .default(0),
  stacked: z.boolean().optional(),
});
export type ReportChart = z.infer<typeof ReportChartSchema>;

export const ReportDefinitionSchema = z.object({
  version: z.literal(REPORT_DEFINITION_VERSION),
  object: z.enum(REPORT_OBJECTS),
  type: z.enum(REPORT_TYPES),
  /** Field keys, in display order (tabular only). */
  columns: z.array(fieldKey).max(MAX_REPORT_COLUMNS).default([]),
  /** Same strings as list URLs: `field -> "a,b"` / `"2026-01-01..2026-01-31"`. */
  filters: z.record(fieldKey, z.string().max(2000)).default({}),
  q: z.string().max(100).default(""),
  scope: z.enum(["mine", "all"]).default("all"),
  rowGroups: z.array(GroupSchema).max(2).default([]),
  columnGroup: GroupSchema.optional(),
  aggregates: z.array(AggregateSchema).max(MAX_REPORT_AGGREGATES).default([]),
  /**
   * tabular: a sortable field key. summary/matrix: "label" (group label) or
   * "agg:<index>" (an aggregate of the first/outer level).
   */
  sort: z
    .object({ field: z.string().min(1).max(64), dir: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().min(1).max(MAX_REPORT_LIMIT).default(500),
  chart: ReportChartSchema.default({ type: "none", metric: 0 }),
});
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;
export type ReportDefinitionInput = z.input<typeof ReportDefinitionSchema>;

export type DefinitionIssue = { path: string; code: string };
export type DefinitionValidation =
  { ok: true } | { ok: false; issues: DefinitionIssue[] };

/**
 * Semantic checks against the object config. Issue codes: unknown_field,
 * wrong_object, invalid_filter, invalid_sort, not_groupable, bucket_not_date,
 * not_aggregatable, field_required, field_not_allowed, duplicate_group,
 * limits, tabular_shape, summary_shape, matrix_shape, chart_dimension, chart_metric.
 */
export function validateDefinition(
  def: ReportDefinition,
  config: RecordConfig,
): DefinitionValidation {
  const issues: DefinitionIssue[] = [];
  const add = (path: string, code: string) => issues.push({ path, code });

  if (def.object !== config.object) add("object", "wrong_object");

  // Caps the engine relies on, enforced even for definitions that skipped the zod schema.
  if (
    def.columns.length > MAX_REPORT_COLUMNS ||
    def.aggregates.length > MAX_REPORT_AGGREGATES ||
    !Number.isInteger(def.limit) ||
    def.limit < 1 ||
    def.limit > MAX_REPORT_LIMIT
  ) {
    add("limits", "limits");
  }

  def.columns.forEach((key, i) => {
    if (!getField(config, key)) add(`columns.${i}`, "unknown_field");
  });

  const filterable = new Set(filterableFields(config).map((f) => f.key));
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(def.filters)) {
    if (!getField(config, key)) add(`filters.${key}`, "unknown_field");
    else if (!filterable.has(key)) add(`filters.${key}`, "invalid_filter");
    else params.set(key, value);
  }
  // Reuse the list-URL parsing: a key that does not survive has no valid value.
  const parsed = parseListQuery(config, params).filters;
  for (const key of params.keys())
    if (!parsed[key]) add(`filters.${key}`, "invalid_filter");

  const checkGroup = (g: ReportGroupBy, path: string) => {
    const field = getField(config, g.field);
    if (!field) return add(`${path}.field`, "unknown_field");
    if (!groupableFieldTypes.includes(field.type))
      add(`${path}.field`, "not_groupable");
    if (g.bucket && !bucketableFieldTypes.includes(field.type))
      add(`${path}.bucket`, "bucket_not_date");
  };
  def.rowGroups.forEach((g, i) => checkGroup(g, `rowGroups.${i}`));
  if (def.columnGroup) checkGroup(def.columnGroup, "columnGroup");

  const dims = [
    ...def.rowGroups,
    ...(def.columnGroup ? [def.columnGroup] : []),
  ];
  const seen = new Set<string>();
  dims.forEach((g, i) => {
    const id = `${g.field}:${g.bucket ?? ""}`;
    if (seen.has(id))
      add(
        i < def.rowGroups.length ? `rowGroups.${i}` : "columnGroup",
        "duplicate_group",
      );
    seen.add(id);
  });

  def.aggregates.forEach((a, i) => {
    const path = `aggregates.${i}`;
    if (a.fn === "count") {
      if (a.field) add(`${path}.field`, "field_not_allowed");
      return;
    }
    if (!a.field) return add(`${path}.field`, "field_required");
    const field = getField(config, a.field);
    if (!field) return add(`${path}.field`, "unknown_field");
    if (!aggregatableFieldTypes.includes(field.type))
      add(`${path}.field`, "not_aggregatable");
  });

  // Shape per report type.
  if (def.type === "tabular") {
    if (def.columns.length === 0) add("columns", "tabular_shape");
    if (def.rowGroups.length > 0) add("rowGroups", "tabular_shape");
    if (def.columnGroup) add("columnGroup", "tabular_shape");
    if (def.aggregates.length > 0) add("aggregates", "tabular_shape");
    if (def.chart.type !== "none") add("chart.type", "tabular_shape");
  } else if (def.type === "summary") {
    if (def.rowGroups.length < 1 || def.rowGroups.length > 2) add("rowGroups", "summary_shape");
    if (def.columnGroup) add("columnGroup", "summary_shape");
    if (def.aggregates.length < 1) add("aggregates", "summary_shape");
  } else {
    if (def.rowGroups.length !== 1) add("rowGroups", "matrix_shape");
    if (!def.columnGroup) add("columnGroup", "matrix_shape");
    if (def.aggregates.length < 1) add("aggregates", "matrix_shape");
  }

  if (def.chart.type !== "none" && def.type !== "tabular") {
    if (
      (def.chart.type === "funnel" || def.chart.type === "donut") &&
      dims.length !== 1
    ) {
      add("chart.type", "chart_dimension");
    }
    if (def.chart.metric >= def.aggregates.length)
      add("chart.metric", "chart_metric");
  }

  if (def.sort) {
    const { field } = def.sort;
    if (def.type === "tabular") {
      if (!sortableKeys(config).includes(field))
        add("sort.field", "invalid_sort");
    } else {
      const m = /^agg:(\d+)$/.exec(field);
      if (field !== "label" && !(m && Number(m[1]) < def.aggregates.length))
        add("sort.field", "invalid_sort");
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** Narrow helper for callers holding a CrmObject. */
export function isReportObject(value: unknown): value is ReportObject {
  return (
    typeof value === "string" &&
    (REPORT_OBJECTS as readonly string[]).includes(value)
  );
}
export type { CrmObject };

// ---------------------------------------------------------------- results

/** Resolved (already translated by the caller) column header. */
export type ReportColumn = {
  key: string;
  label: string;
  type: FieldType;
  /** field: tabular column; group: row/column group; aggregate: computed metric. */
  kind: "field" | "group" | "aggregate";
};

export type ReportAggregateInfo = {
  fn: ReportAggFn;
  field?: string;
  label: string;
};

/** One value per aggregate, in `aggregates` order (currency already converted to base). */
export type ReportCell = number[];

export type ReportGroup = {
  /** Raw group key (id/value/bucket); "" for empty. */
  key: string;
  label: string;
  /** One value per aggregate. */
  values: number[];
  /** Second level; never nested deeper. */
  children?: ReportGroup[];
};

/** Joins group keys into the `cells` row key (matrix has one level, so it is the key itself). */
export const ROW_PATH_SEPARATOR = "\u001f";
export function rowPath(keys: string[]): string {
  return keys.join(ROW_PATH_SEPARATOR);
}

type ReportResultBase = {
  object: ReportObject;
  columns: ReportColumn[];
  /** IANA zone used for buckets and datetime filters. */
  timeZone: string;
  /** ISO timestamp. */
  generatedAt: string;
  /** Present when the 20k scan cap cut the data. */
  truncated?: { scanned: number; total: number };
};

/** A row: raw column values plus `_display` labels for references. */
export type ReportRow = Record<string, unknown> & {
  _display?: Record<string, string>;
};

export type TabularReportResult = ReportResultBase & {
  type: "tabular";
  rows: ReportRow[];
  /** Matching rows before `limit`. */
  total: number;
};

export type GroupedReportResult = ReportResultBase & {
  type: "summary" | "matrix";
  /** Row groups, at most 2 levels. */
  groups: ReportGroup[];
  /** Matrix column keys in display order; empty for summary. */
  colKeys: { key: string; label: string }[];
  /** matrix: cells[rowPath][colKey] -> one value per aggregate. Empty for summary. */
  cells: Record<string, Record<string, ReportCell>>;
  /** Grand totals, one per aggregate. */
  totals: number[];
  aggregates: ReportAggregateInfo[];
  /** Currency amounts are converted to `base`; `missing` lists currencies without a rate. */
  currency: { base: string; missing: string[] };
};

export type ReportResult = TabularReportResult | GroupedReportResult;

// ---------------------------------------------------------------- sharing

export const REPORT_VISIBILITIES = ["private", "team", "public"] as const;
export type ReportVisibility = (typeof REPORT_VISIBILITIES)[number];

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500).default("");

export const FolderInputSchema = z
  .object({
    name,
    visibility: z.enum(REPORT_VISIBILITIES),
    teamId: z.guid().nullish(),
  })
  .refine((v) => v.visibility !== "team" || !!v.teamId, {
    path: ["teamId"],
    message: "team_required",
  });
export type FolderInput = z.infer<typeof FolderInputSchema>;

/** The report inherits the visibility of its folder (no folder = private). */
export const ReportInputSchema = z.object({
  name,
  description,
  folderId: z.guid().nullish(),
  definition: ReportDefinitionSchema.refine(
    (d) => JSON.stringify(d).length <= MAX_DEFINITION_BYTES,
    {
      message: "definition_too_large",
    },
  ),
});
export type ReportInput = z.infer<typeof ReportInputSchema>;

export const WIDGET_SIZES = ["sm", "md", "lg"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];
const widgetId = z.string().min(1).max(64);
const position = z.number().int().min(0).max(100);

export const DashboardWidgetSchema = z.object({
  id: widgetId,
  reportId: z.guid(),
  chartOverride: ReportChartSchema.optional(),
  size: z.enum(WIDGET_SIZES),
  position,
});
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

export const DashboardInputSchema = z
  .object({
    name,
    description,
    visibility: z.enum(REPORT_VISIBILITIES),
    teamId: z.guid().nullish(),
    widgets: z
      .array(DashboardWidgetSchema)
      .max(MAX_DASHBOARD_WIDGETS)
      .default([]),
  })
  .refine((v) => v.visibility !== "team" || !!v.teamId, {
    path: ["teamId"],
    message: "team_required",
  });
export type DashboardInput = z.infer<typeof DashboardInputSchema>;

// ---------------------------------------------------------------- home

export const HOME_WIDGET_KINDS = ["builtin", "report", "dashboard"] as const;
export const BUILTIN_HOME_WIDGETS = [
  "kpi_open_leads",
  "kpi_pipeline",
  "kpi_won_month",
  "kpi_tasks_today",
  "pipeline_chart",
  "my_tasks",
  "recent_records",
  "quick_access",
] as const;
export type BuiltinHomeWidget = (typeof BUILTIN_HOME_WIDGETS)[number];

/** `ref`: a BUILTIN_HOME_WIDGETS id for builtin, else a report/dashboard uuid. */
export const HomeWidgetSchema = z
  .object({
    id: widgetId,
    kind: z.enum(HOME_WIDGET_KINDS),
    ref: z.string().min(1).max(64),
    size: z.enum(WIDGET_SIZES),
    position,
  })
  .refine(
    (w) =>
      w.kind === "builtin"
        ? (BUILTIN_HOME_WIDGETS as readonly string[]).includes(w.ref)
        : z.guid().safeParse(w.ref).success,
    { path: ["ref"], message: "invalid_ref" },
  );
export type HomeWidget = z.infer<typeof HomeWidgetSchema>;

export const HomeLayoutInputSchema = z.object({
  widgets: z.array(HomeWidgetSchema).max(MAX_HOME_WIDGETS),
});
export type HomeLayoutInput = z.infer<typeof HomeLayoutInputSchema>;

export const HOME_LAYOUT_SCOPES = ["default", "team", "user"] as const;
export type HomeLayoutScope = (typeof HOME_LAYOUT_SCOPES)[number];
