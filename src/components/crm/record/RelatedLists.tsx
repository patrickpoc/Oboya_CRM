"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/contexts/CrmContext";
import { getField } from "@/lib/crm/objects/query";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import {
  OBJECT_META,
  type RecordConfig,
  type RecordLookups,
  type RecordRow,
  type RelatedListData,
} from "@/lib/crm/objects/types";
import { FieldValue } from "./FieldValue";
import { RecordFormDrawer } from "./RecordFormDrawer";

/** Related tab: per list a count, the first 5 rows, "View all" and "New". */
export function RelatedLists({
  config,
  record,
  related,
  lookups,
}: {
  config: RecordConfig;
  record: RecordRow;
  related: RelatedListData[];
  lookups: RecordLookups;
}) {
  const t = useTranslations();
  const tr = useTranslations("record.related");
  const router = useRouter();
  const { can } = useCrm();
  const [creating, setCreating] = useState<RelatedListData | null>(null);
  const recordName = record._display?._name ?? "";

  if (related.length === 0) return <p className="py-6 text-sm text-muted-foreground">{tr("none")}</p>;

  return (
    <div className="space-y-4">
      {related.map((list) => {
        const meta = OBJECT_META[list.object];
        const target = getRecordConfig(list.object);
        const params = new URLSearchParams({ view: "all", [list.foreignKey]: record.id, ...(list.where ?? {}) });
        const columns = target
          ? list.columns.map((c) => getField(target, c)).filter((f) => f !== undefined)
          : [];
        return (
          <section key={list.key} className="rounded-xl border border-border/60 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold text-oboya-blue-dark">
                {t(`${config.namespace}.${list.labelKey}`)}{" "}
                <span className="text-muted-foreground">({list.total})</span>
              </h3>
              {target && can(target.module, "create") ? (
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setCreating(list)}>
                  <Plus /> {tr("new")}
                </Button>
              ) : null}
            </header>
            {list.rows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">{tr("empty")}</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {list.rows.map((row) => (
                  <li key={row.id} className="px-4 py-2.5">
                    <Link
                      href={`${meta.basePath}/${row.id}`}
                      className="text-sm font-medium text-oboya-blue-light hover:underline"
                    >
                      {row._display?._name || String(row[meta.nameColumn] ?? row.id)}
                    </Link>
                    {target && columns.length > 0 ? (
                      <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {columns.map((field) => (
                          <span key={field.key} className="inline-flex min-w-0 items-center gap-1">
                            <span>{t(`${target.namespace}.${field.labelKey}`)}:</span>
                            <FieldValue config={target} field={field} row={row} lookups={lookups} />
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {list.total > list.rows.length && target ? (
              <div className="border-t border-border/60 px-4 py-2 text-right">
                <Link href={`${meta.basePath}?${params}`} className="text-xs font-medium text-oboya-blue-light hover:underline">
                  {tr("viewAll")}
                </Link>
              </div>
            ) : null}
          </section>
        );
      })}
      {creating ? (
        <RecordFormDrawer
          object={creating.object}
          open
          onClose={() => setCreating(null)}
          lookups={lookups}
          defaults={{ [creating.foreignKey]: record.id, ...(creating.where ?? {}) }}
          defaultLabels={{ [creating.foreignKey]: recordName }}
          onCreated={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
