"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { FilterBar, FilterSelect, FilterTabs, SearchInput } from "@/components/crm/common/FilterBar";
import { EmptyState } from "@/components/crm/common/states";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DateRangeFilter } from "@/components/crm/common/DateRangeFilter";
import { FieldValue } from "@/components/crm/record/FieldValue";
import { useFieldOptions } from "@/components/crm/record/FieldInput";
import { RecordFormDrawer } from "@/components/crm/record/RecordFormDrawer";
import { apiFetch, objectApiPath } from "@/components/crm/record/api";
import { countryFlagOptions } from "@/constants/country-flags";
import { useCrm } from "@/contexts/CrmContext";
import { DEFAULT_PAGE_SIZE, filterableFields, getField, listParamKeys, listParamsKey } from "@/lib/crm/objects/query";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import type { CrmObject, FieldConfig, Option, RecordLookups, RecordRow } from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";

type ListData = { key: string; rows: RecordRow[]; total: number };

/**
 * Generic list page body for a registered object: view tabs (mine / all /
 * recent), URL-synced filters and search, server-side sort + pagination via
 * GET /api/crm/objects/:object, CSV export and a "New" drawer.
 * `initial` is the first page loaded by the server for `initial.key`.
 */
export function ObjectListView({
  object,
  lookups,
  initial,
  headerActions,
  toolbar,
}: {
  object: CrmObject;
  lookups: RecordLookups;
  initial?: ListData;
  /** Extra header controls (e.g. the opportunities list/kanban toggle). */
  headerActions?: React.ReactNode;
  /** Extra controls inside the filter bar (e.g. the leads created-date range). */
  toolbar?: React.ReactNode;
}) {
  const config = getRecordConfig(object)!;
  const t = useTranslations();
  const tl = useTranslations("listViews");
  const router = useRouter();
  const { can } = useCrm();
  const options = useFieldOptions(config, lookups);

  const defaults = useMemo(
    () => Object.fromEntries(listParamKeys(config).map((k) => [k, ""])) as Record<string, string>,
    [config]
  );
  const { filters, setFilters, reset } = useUrlFilters(defaults);
  const key = listParamsKey(config, filters);

  const [data, setData] = useState<ListData | null>(initial ?? null);
  const [error, setError] = useState<{ key: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data?.key === key && retry === 0) return;
    const controller = new AbortController();
    apiFetch<{ rows: RecordRow[]; total: number }>(`${objectApiPath(object)}?${key}`, { signal: controller.signal })
      .then((result) => {
        setData({ key, ...result });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError({ key });
        void err;
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the query (or retry) changes
  }, [key, retry, object]);

  const loading = data?.key !== key && error?.key !== key;
  const view = filters.view || "mine";
  const sortKey = filters.sort || config.defaultSort.field;
  const sortDir = (filters.dir || (sortKey === config.defaultSort.field ? config.defaultSort.dir : "asc")) as
    | "asc"
    | "desc";
  const page = Number.parseInt(filters.page || "0", 10) || 0;
  const pageSize = Number.parseInt(filters.pageSize || "", 10) || DEFAULT_PAGE_SIZE;

  const label = (field: FieldConfig) => t(`${config.namespace}.${field.labelKey}`);

  const columns: DataTableColumn<RecordRow>[] = config.listColumns
    .map((k) => getField(config, k))
    .filter((f): f is FieldConfig => Boolean(f))
    .map((field, index) => ({
      key: field.key,
      header: label(field),
      sortable: Boolean(field.sortable && !field.virtual),
      cell: (row) =>
        index === 0 ? (
          <Link
            href={`${config.basePath}/${row.id}`}
            className="font-medium text-oboya-blue-light hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row._display?._name || "—"}
          </Link>
        ) : (
          <FieldValue config={config} field={field} row={row} lookups={lookups} />
        ),
    }));

  const filterOptions = (field: FieldConfig): Option[] | null => {
    switch (field.type) {
      case "picklist":
      case "multipicklist":
      case "tags":
        return options(field);
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
        return null; // lookups etc.: URL only (e.g. "View all" from a related list)
    }
  };

  const activeFilters = filterableFields(config).some((f) => filters[f.key]) || Boolean(filters.q);
  const exportHref = `${objectApiPath(object, "/export")}?${key}`;

  return (
    <>
      <CrmPageHeader
        title={t(`${config.namespace}.title`)}
        actions={
          <>
            {headerActions}
            {can(config.module, "export") ? (
              <a
                href={exportHref}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}
                download
              >
                <Download /> {tl("exportCsv")}
              </a>
            ) : null}
            {can(config.module, "create") ? (
              <Button
                size="sm"
                className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90"
                onClick={() => setCreating(true)}
              >
                <Plus /> {tl("new")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-3">
        <FilterTabs
          value={view}
          onChange={(next) => setFilters({ view: next === "mine" ? "" : next, page: "" })}
          options={[
            { value: "mine", label: tl("views.mine") },
            { value: "all", label: tl("views.all") },
            { value: "recent", label: tl("views.recent") },
          ]}
        />
        <FilterBar
          showReset={activeFilters}
          onReset={() => {
            setSearch("");
            reset();
            if (view !== "mine") setFilters({ view });
          }}
        >
          <SearchInput
            value={search}
            placeholder={tl("searchPlaceholder")}
            onChange={(value) => {
              setSearch(value);
              if (searchTimer.current) clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => setFilters({ q: value.trim(), page: "" }), 300);
            }}
          />
          {filterableFields(config).map((field) => {
            if (field.type === "date" || field.type === "datetime") {
              return (
                <DateRangeFilter
                  key={field.key}
                  label={label(field)}
                  value={filters[field.key] ?? ""}
                  onChange={(value) => setFilters({ [field.key]: value, page: "" })}
                />
              );
            }
            const opts = filterOptions(field);
            if (!opts) return null;
            return (
              <FilterSelect
                key={field.key}
                label={label(field)}
                value={filters[field.key] ?? ""}
                options={opts}
                allLabel={tl("filterAll")}
                onChange={(value) => setFilters({ [field.key]: value, page: "" })}
              />
            );
          })}
          {toolbar}
        </FilterBar>

        <DataTable<RecordRow>
          data={data?.key === key ? data.rows : []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={loading}
          error={error?.key === key ? t("shell.failedToLoad") : null}
          onRetry={() => setRetry((n) => n + 1)}
          onRowClick={(row) => router.push(`${config.basePath}/${row.id}`)}
          emptyState={
            <EmptyState
              icon={config.icon}
              title={view === "recent" && !activeFilters ? tl("emptyRecent") : tl("empty")}
            />
          }
          server={{
            sortKey,
            sortDir,
            page,
            pageSize,
            total: data?.key === key ? data.total : 0,
            onChange: (next) =>
              setFilters({
                sort: next.sortKey === config.defaultSort.field ? "" : (next.sortKey ?? ""),
                dir: next.sortDir,
                page: next.page ? String(next.page) : "",
              }),
          }}
        />
      </div>

      <RecordFormDrawer object={object} open={creating} onClose={() => setCreating(false)} lookups={lookups} />
    </>
  );
}
