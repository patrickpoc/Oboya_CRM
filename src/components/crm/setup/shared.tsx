"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { ApiError, apiFetch, useApiErrorMessage } from "@/components/crm/common/api";
import { Label } from "@/components/ui/label";
import { moveById, moveItem } from "@/lib/crm/setup/stages";
import { cn } from "@/lib/utils";

export { ApiError, apiFetch };

export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm text-oboya-blue-dark disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Translated message for an API error (`setup.errors.<code>`), via the shared common mapper. */
export function useErrorMessage() {
  return useApiErrorMessage("setup");
}

/** Loads `url` once (and on reload()); keeps the last good data on refresh errors. */
export function useSetupData<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiFetch<T>(url);
      setData(next);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; the loader sets loading state before awaiting the API
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/**
 * Reorderable list: native HTML5 drag and drop plus keyboard (up/down buttons,
 * Alt+Arrow on the handle). Reports the full new id order.
 */
export function SortableList<T extends { id: string }>({
  items,
  disabled,
  onReorder,
  renderItem,
  itemLabel,
}: {
  items: T[];
  disabled?: boolean;
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  itemLabel: (item: T) => string;
}) {
  const t = useTranslations("setup.common");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ids = items.map((i) => i.id);

  const commit = (next: string[], id: string) => {
    if (next.join() === ids.join()) return;
    onReorder(next);
    const item = items.find((i) => i.id === id);
    if (item) {
      setAnnouncement(t("reordered", { label: itemLabel(item), position: next.indexOf(id) + 1, total: next.length }));
    }
  };

  const move = (id: string, delta: -1 | 1) => commit(moveById(ids, id, delta), id);

  return (
    <>
      <ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-white">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable={!disabled}
            onDragStart={(e) => {
              setDragId(item.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverIndex(index);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) commit(moveItem(ids, ids.indexOf(dragId), index), dragId);
              setDragId(null);
              setOverIndex(null);
            }}
            className={cn(
              "flex items-center gap-2 px-2 py-2 sm:px-3",
              dragId === item.id && "opacity-50",
              overIndex === index && dragId !== item.id && "bg-oboya-blue/5 shadow-[inset_0_2px_0_var(--oboya-blue)]"
            )}
          >
            {!disabled ? (
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  className="hidden cursor-grab rounded p-1 text-muted-foreground hover:bg-muted sm:block"
                  aria-label={t("dragHandle", { label: itemLabel(item) })}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === "ArrowUp") {
                      e.preventDefault();
                      move(item.id, -1);
                    } else if (e.altKey && e.key === "ArrowDown") {
                      e.preventDefault();
                      move(item.id, 1);
                    }
                  }}
                >
                  <GripVertical className="size-4" />
                </button>
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(item.id, -1)}
                    aria-label={t("moveUp", { label: itemLabel(item) })}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === items.length - 1}
                    onClick={() => move(item.id, 1)}
                    aria-label={t("moveDown", { label: itemLabel(item) })}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

export function moduleLabelKey(module: string) {
  return `modules.${module}` as const;
}
