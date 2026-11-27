"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { apiFetch, useApiErrorMessage } from "@/components/crm/common/api";
import { DateRangeFilter } from "@/components/crm/common/DateRangeFilter";
import { FilterSelect } from "@/components/crm/common/FilterBar";
import { ErrorState } from "@/components/crm/common/states";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { ReportOutput } from "@/components/crm/reports/ReportView";
import { SaveReportDialog } from "@/components/crm/reports/SaveReportDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { browserTimeZone } from "@/lib/crm/activities/due";
import { countryFlagOptions } from "@/constants/country-flags";
import { useCrm } from "@/contexts/CrmContext";
import { filterableFields, getField, sortableKeys } from "@/lib/crm/objects/query";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import type { FieldConfig, Option, RecordConfig, RecordLookups } from "@/lib/crm/objects/types";
import { REPORTS_API, type ReportResponse, type RunResponse } from "@/lib/crm/reports/api-contract";
import {
  REPORT_AGG_FNS,
  REPORT_BUCKETS,
  REPORT_CHART_TYPES,
  REPORT_OBJECTS,
  REPORT_TYPES,
  ReportDefinitionSchema,
  aggregatableFieldTypes,
  bucketableFieldTypes,
  groupableFieldTypes,
  validateDefinition,
  type ReportDefinition,
  type ReportGroupBy,
  type ReportObject,
  type ReportResult,
  type ReportType,
} from "@/lib/crm/reports/definition";
import { cn } from "@/lib/utils";

const PREVIEW_DEBOUNCE_MS = 600;
const selectClass = "h-8 min-w-0 rounded-md border border-border/70 bg-white px-2 text-sm text-oboya-blue-dark";
const iconButton =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-oboya-blue hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent";

function blankDefinition(object: ReportObject): ReportDefinition {
  const config = getRecordConfig(object)!;
  return ReportDefinitionSchema.parse({
    version: 1,
    object,
    type: "tabular",
    columns: config.listColumns.filter((k) => getField(config, k)),
  });
}

/** Shape changes when the report type changes, so the new type starts valid. */
function withType(def: ReportDefinition, config: RecordConfig, type: ReportType): ReportDefinition {
  const groupable = config.fields.filter((f) => groupableFieldTypes.includes(f.type));
  const base = { ...def, type, sort: undefined, chart: { type: "none" as const, metric: 0 } };
  if (type === "tabular") {
    return { ...base, columns: def.columns.length ? def.columns : config.listColumns, rowGroups: [], columnGroup: undefined, aggregates: [] };
  }
  const aggregates = def.aggregates.length ? def.aggregates : [{ fn: "count" as const }];
  const first = def.rowGroups[0] ?? { field: groupable[0]?.key ?? "" };
  if (type === "summary") return { ...base, rowGroups: [first, ...def.rowGroups.slice(1, 2)], columnGroup: undefined, aggregates };
  const column = def.columnGroup ?? { field: groupable.find((f) => f.key !== first.field)?.key ?? "" };
  return { ...base, rowGroups: [first], columnGroup: column, aggregates };
}

const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Sections start open from md up and collapsed on phones so the preview stays reachable. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const open = useSyncExternalStore(subscribeWide, () => window.matchMedia("(min-width: 768px)").matches, () => true);
  return (
    <details open={open} className="group space-y-2 border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
      <summary className="cursor-pointer list-none text-xs font-semibold tracking-wide text-oboya-blue-dark uppercase marker:hidden [&::-webkit-details-marker]:hidden">
        {title}
      </summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Loader({ id, presetObject, lookups }: { id?: string; presetObject?: string; lookups: RecordLookups }) {
  const t = useTranslations("reports.builder");
  const { can } = useCrm();
  const [loaded, setLoaded] = useState<ReportResponse["report"] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiFetch<ReportResponse>(REPORTS_API.report(id), { signal: controller.signal, quiet: true })
      .then((r) => setLoaded(r.report))
      .catch(() => !controller.signal.aborted && setFailed(true));
    return () => controller.abort();
  }, [id, reload]);

  if (id && failed) {
    return (
      <ErrorState
        message={t("loadFailed")}
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (id && !loaded) return <Skeleton className="h-96 w-full" />;

  const allowed = REPORT_OBJECTS.filter((o) => {
    const config = getRecordConfig(o);
    return config && can(config.module, "view");
  });
  if (allowed.length === 0) return <p className="text-sm text-muted-foreground">{t("needsView")}</p>;
  const preset = allowed.find((o) => o === presetObject) ?? allowed[0];
  return (
    <BuilderForm
      key={loaded?.id ?? "new"}
      lookups={lookups}
      allowed={allowed}
      saved={loaded}
      initial={loaded?.definition ?? blankDefinition(preset)}
    />
  );
}

/** Report builder: settings on the left, live preview on the right (stacked below md). */
export function ReportBuilder(props: { id?: string; presetObject?: string; lookups: RecordLookups }) {
  return <Loader {...props} />;
}

function BuilderForm({
  lookups,
  allowed,
  saved,
  initial,
}: {
  lookups: RecordLookups;
  allowed: ReportObject[];
  saved: ReportResponse["report"] | null;
  initial: ReportDefinition;
}) {
  const t = useTranslations();
  const tb = useTranslations("reports.builder");
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const [def, setDef] = useState<ReportDefinition>(initial);
  const [saveOpen, setSaveOpen] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result?: ReportResult; error?: string }>({ key: "" });

  const config = getRecordConfig(def.object)!;
  const label = (f: FieldConfig) => t(`${config.namespace}.${f.labelKey}`);
  const patch = (p: Partial<ReportDefinition>) => setDef((d) => ({ ...d, ...p }));

  const issues = useMemo(() => {
    const check = validateDefinition(def, config);
    return check.ok ? [] : check.issues;
  }, [def, config]);

  // Debounced live preview of the unsaved definition. Only async callbacks set state.
  const defKey = JSON.stringify(def);
  const valid = issues.length === 0;
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<RunResponse>(REPORTS_API.run, {
        method: "POST",
        body: JSON.stringify({ definition: JSON.parse(defKey), tz: browserTimeZone() }),
        signal: controller.signal,
        quiet: true,
      })
        .then((r) => setPreview({ key: defKey, result: r.result }))
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setPreview({ key: defKey, error: errorMessage(e) });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [defKey, valid, errorMessage]);
  const loading = valid && preview.key !== defKey;

  // ---- option lists
  const fieldOptions = (types: readonly string[]): Option[] =>
    config.fields.filter((f) => types.includes(f.type)).map((f) => ({ value: f.key, label: label(f) }));
  const filterOptions = (field: FieldConfig): Option[] | null => {
    switch (field.type) {
      case "picklist":
      case "multipicklist":
      case "tags":
        if (field.picklist?.kind === "static") {
          return field.picklist.options.map((o) => ({ value: o.value, label: t(`${config.namespace}.${o.labelKey}`) }));
        }
        if (field.picklist?.kind === "picklist") return lookups.picklists[field.picklist.picklist] ?? [];
        return field.picklist?.kind === "stages" ? lookups.stages : [];
      case "owner":
        return lookups.users.filter((u) => u.active);
      case "entity":
        return lookups.entities;
      case "country":
        return countryFlagOptions.map((c) => ({ value: c.code, label: c.label }));
      case "boolean":
        return [
          { value: "true", label: t("record.yes") },
          { value: "false", label: t("record.no") },
        ];
      default:
        return null;
    }
  };

  const setFilter = (key: string, value: string) => {
    const filters = { ...def.filters };
    if (value) filters[key] = value;
    else delete filters[key];
    patch({ filters });
  };

  const changeObject = (object: ReportObject) => setDef(blankDefinition(object));
  const move = (index: number, by: -1 | 1) => {
    const columns = [...def.columns];
    [columns[index], columns[index + by]] = [columns[index + by], columns[index]];
    patch({ columns });
  };

  const groupEditor = (
    title: string,
    group: ReportGroupBy | undefined,
    onChange: (g: ReportGroupBy | undefined) => void,
    removable: boolean
  ) => {
    const field = group ? getField(config, group.field) : undefined;
    const dateField = Boolean(field && bucketableFieldTypes.includes(field.type));
    return (
      <div className="flex flex-wrap items-end gap-2">
        <Field label={title}>
          <select
            className={cn(selectClass, "w-44")}
            value={group?.field ?? ""}
            onChange={(e) => {
              const next = getField(config, e.target.value);
              onChange(
                next
                  ? { field: next.key, bucket: bucketableFieldTypes.includes(next.type) ? (group?.bucket ?? "month") : undefined }
                  : undefined
              );
            }}
          >
            <option value="">{tb("group.pick")}</option>
            {fieldOptions(groupableFieldTypes).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {dateField && group ? (
          <Field label={tb("group.bucket")}>
            <select className={selectClass} value={group.bucket ?? "month"} onChange={(e) => onChange({ ...group, bucket: e.target.value as ReportGroupBy["bucket"] })}>
              {REPORT_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {tb(`buckets.${b}`)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {removable ? (
          <button type="button" className={iconButton} aria-label={tb("group.remove")} onClick={() => onChange(undefined)}>
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    );
  };

  const grouped = def.type !== "tabular";
  const sortOptions: Option[] = grouped
    ? [{ value: "label", label: tb("sort.label") }, ...def.aggregates.map((_, i) => ({ value: `agg:${i}`, label: tb("sort.agg", { index: i + 1 }) }))]
    : config.fields.filter((f) => sortableKeys(config).includes(f.key)).map((f) => ({ value: f.key, label: label(f) }));

  const aggregateFields = fieldOptions(aggregatableFieldTypes);

  return (
    <>
      <CrmPageHeader
        title={tb(saved ? "editTitle" : "newTitle")}
        actions={
          <>
            <Link href={saved ? `/reports/${saved.id}` : "/reports"} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}>
              {tb("back")}
            </Link>
            <Button
              size="sm"
              className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90"
              disabled={!valid}
              onClick={() => setSaveOpen(true)}
            >
              <Save aria-hidden /> {tb("save.open")}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <aside aria-label={tb("config")} className="min-w-0 space-y-4 rounded-xl border bg-white p-4 md:max-h-[calc(100vh-10rem)] md:overflow-y-auto">
          <Section title={tb("object")}>
            <Field label={tb("object")}>
              <select className={selectClass} value={def.object} onChange={(e) => changeObject(e.target.value as ReportObject)}>
                {allowed.map((o) => (
                  <option key={o} value={o}>
                    {t(`${getRecordConfig(o)!.namespace}.title`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tb("type")}>
              <select className={selectClass} value={def.type} onChange={(e) => setDef(withType(def, config, e.target.value as ReportType))}>
                {REPORT_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {tb(`types.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tb("scope")}>
              <select className={selectClass} value={def.scope} onChange={(e) => patch({ scope: e.target.value as "mine" | "all" })}>
                <option value="all">{tb("scopes.all")}</option>
                <option value="mine">{tb("scopes.mine")}</option>
              </select>
            </Field>
          </Section>

          {def.type === "tabular" ? (
            <Section title={tb("columns.title")}>
              {def.columns.length === 0 ? <p className="text-xs text-muted-foreground">{tb("columns.empty")}</p> : null}
              <ol className="space-y-1">
                {def.columns.map((key, i) => {
                  const name = getField(config, key);
                  const text = name ? label(name) : key;
                  return (
                    <li key={key} className="flex items-center gap-1 rounded-md border border-border/60 pl-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{text}</span>
                      <button type="button" className={iconButton} disabled={i === 0} aria-label={tb("columns.up", { name: text })} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-4" aria-hidden />
                      </button>
                      <button type="button" className={iconButton} disabled={i === def.columns.length - 1} aria-label={tb("columns.down", { name: text })} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-4" aria-hidden />
                      </button>
                      <button type="button" className={iconButton} aria-label={tb("columns.remove", { name: text })} onClick={() => patch({ columns: def.columns.filter((c) => c !== key) })}>
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <select
                className={cn(selectClass, "w-full")}
                aria-label={tb("columns.add")}
                value=""
                disabled={def.columns.length >= 20}
                onChange={(e) => e.target.value && patch({ columns: [...def.columns, e.target.value] })}
              >
                <option value="">{tb("columns.add")}</option>
                {config.fields
                  .filter((f) => !def.columns.includes(f.key))
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {label(f)}
                    </option>
                  ))}
              </select>
            </Section>
          ) : null}

          <Section title={tb("filters.title")}>
            <Field label={tb("search")}>
              <Input className="h-8 text-sm" value={def.q} maxLength={100} placeholder={tb("searchPlaceholder")} onChange={(e) => patch({ q: e.target.value })} />
            </Field>
            <div className="flex flex-col items-start gap-2">
              {filterableFields(config).map((field) => {
                if (field.type === "date" || field.type === "datetime") {
                  return <DateRangeFilter key={field.key} label={label(field)} value={def.filters[field.key] ?? ""} onChange={(v) => setFilter(field.key, v)} />;
                }
                const options = filterOptions(field);
                if (!options) return null;
                return (
                  <FilterSelect
                    key={field.key}
                    label={label(field)}
                    value={def.filters[field.key] ?? ""}
                    options={options}
                    allLabel={tb("filters.all")}
                    onChange={(v) => setFilter(field.key, v)}
                  />
                );
              })}
            </div>
          </Section>

          {grouped ? (
            <Section title={tb("group.title")}>
              {groupEditor(tb("group.rows"), def.rowGroups[0], (g) => patch({ rowGroups: g ? [g, ...def.rowGroups.slice(1)] : def.rowGroups.slice(1) }), false)}
              {def.type === "summary" ? (
                def.rowGroups[1] ? (
                  groupEditor(tb("group.second"), def.rowGroups[1], (g) => patch({ rowGroups: g ? [def.rowGroups[0], g] : [def.rowGroups[0]] }), true)
                ) : (
                  <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={!def.rowGroups[0]} onClick={() => patch({ rowGroups: [def.rowGroups[0], { field: "" }] })}>
                    <Plus aria-hidden /> {tb("group.addRow")}
                  </Button>
                )
              ) : null}
              {def.type === "matrix" ? groupEditor(tb("group.column"), def.columnGroup, (g) => patch({ columnGroup: g }), false) : null}
            </Section>
          ) : null}

          {grouped ? (
            <Section title={tb("aggregates.title")}>
              {def.aggregates.map((a, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Field label={tb("aggregates.fn")}>
                    <select
                      className={selectClass}
                      value={a.fn}
                      onChange={(e) => {
                        const fn = e.target.value as typeof a.fn;
                        const next = fn === "count" ? { fn } : { fn, field: a.field ?? aggregateFields[0]?.value };
                        patch({ aggregates: def.aggregates.map((x, j) => (j === i ? next : x)) });
                      }}
                    >
                      {REPORT_AGG_FNS.map((fn) => (
                        <option key={fn} value={fn}>
                          {tb(`aggregates.fns.${fn}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {a.fn !== "count" ? (
                    <Field label={tb("aggregates.field")}>
                      <select
                        className={cn(selectClass, "w-36")}
                        value={a.field ?? ""}
                        onChange={(e) => patch({ aggregates: def.aggregates.map((x, j) => (j === i ? { ...x, field: e.target.value || undefined } : x)) })}
                      >
                        <option value="" />
                        {aggregateFields.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <button type="button" className={iconButton} aria-label={tb("aggregates.remove", { index: i + 1 })} onClick={() => patch({ aggregates: def.aggregates.filter((_, j) => j !== i) })}>
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={def.aggregates.length >= 6} onClick={() => patch({ aggregates: [...def.aggregates, { fn: "count" }] })}>
                <Plus aria-hidden /> {tb("aggregates.add")}
              </Button>
            </Section>
          ) : null}

          <Section title={tb("sort.title")}>
            <div className="flex flex-wrap gap-2">
              <Field label={tb("sort.field")}>
                <select
                  className={cn(selectClass, "w-40")}
                  value={def.sort?.field ?? ""}
                  onChange={(e) => patch({ sort: e.target.value ? { field: e.target.value, dir: def.sort?.dir ?? (grouped && e.target.value !== "label" ? "desc" : "asc") } : undefined })}
                >
                  <option value="">{tb("sort.default")}</option>
                  {sortOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              {def.sort ? (
                <Field label={tb("sort.dir")}>
                  <select className={selectClass} value={def.sort.dir} onChange={(e) => patch({ sort: { field: def.sort!.field, dir: e.target.value as "asc" | "desc" } })}>
                    <option value="asc">{tb("sort.asc")}</option>
                    <option value="desc">{tb("sort.desc")}</option>
                  </select>
                </Field>
              ) : null}
            </div>
            <Field label={tb("limit")}>
              <Input
                type="number"
                min={1}
                max={2000}
                className="h-8 w-28 text-sm"
                value={def.limit}
                onChange={(e) => patch({ limit: Math.min(2000, Math.max(1, Number.parseInt(e.target.value, 10) || 1)) })}
              />
            </Field>
          </Section>

          {grouped ? (
            <Section title={tb("chart.title")}>
              <div className="flex flex-wrap gap-2">
                <Field label={tb("chart.type")}>
                  <select className={selectClass} value={def.chart.type} onChange={(e) => patch({ chart: { ...def.chart, type: e.target.value as ReportDefinition["chart"]["type"] } })}>
                    {REPORT_CHART_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {tb(`chart.types.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {def.chart.type !== "none" ? (
                  <Field label={tb("chart.metric")}>
                    <select className={selectClass} value={def.chart.metric} onChange={(e) => patch({ chart: { ...def.chart, metric: Number(e.target.value) } })}>
                      {def.aggregates.map((_, i) => (
                        <option key={i} value={i}>
                          {tb("sort.agg", { index: i + 1 })}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
              {def.chart.type === "bar" ? (
                <label className="flex items-center gap-2 text-sm text-oboya-blue-dark">
                  <input type="checkbox" checked={def.chart.stacked ?? false} onChange={(e) => patch({ chart: { ...def.chart, stacked: e.target.checked } })} />
                  {tb("chart.stacked")}
                </label>
              ) : null}
            </Section>
          ) : null}
        </aside>

        <section aria-label={tb("preview.title")} aria-busy={loading} className="min-w-0 space-y-3">
          {issues.length > 0 ? (
            <div role="alert" className="rounded-lg border border-oboya-orange/40 bg-oboya-orange/5 p-3 text-sm text-oboya-blue-dark">
              <p className="font-medium">{tb("preview.invalid")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {[...new Set(issues.map((i) => i.code))].map((code) => (
                  <li key={code}>{tb.has(`issues.${code}`) ? tb(`issues.${code}`) : code}</li>
                ))}
              </ul>
            </div>
          ) : preview.error && preview.key === defKey ? (
            <ErrorState message={preview.error || tb("preview.failed")} />
          ) : preview.result ? (
            <div className={cn("transition-opacity", loading && "opacity-60")}>
              {loading ? <p role="status" className="sr-only">{tb("preview.running")}</p> : null}
              <ReportOutput result={preview.result} chart={def.chart} />
            </div>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </section>
      </div>

      {saveOpen ? (
        <SaveReportDialog
          open
          onOpenChange={setSaveOpen}
          definition={def}
          report={saved ? { id: saved.id, name: saved.name, description: saved.description, folderId: saved.folderId } : null}
          onSaved={(id) => router.push(`/reports/${id}`)}
        />
      ) : null}
    </>
  );
}
