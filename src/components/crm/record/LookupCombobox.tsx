"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { OBJECT_META, type CrmObject, type RecordRow } from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";
import { apiFetch, objectApiPath } from "./api";

type Match = { id: string; label: string };

/**
 * Async lookup: searches GET /api/crm/objects/:object?view=all&q= (RLS-scoped)
 * and stores the selected id. `label` is the current display name.
 */
export function LookupCombobox({
  object,
  value,
  label,
  onChange,
  id,
  invalid,
  excludeId,
}: {
  object: CrmObject;
  value: string | null;
  label?: string;
  onChange: (id: string | null, label?: string) => void;
  id?: string;
  invalid?: boolean;
  excludeId?: string;
}) {
  const t = useTranslations("record");
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const search = (term: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const current = ++request.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ view: "all", pageSize: "10" });
        if (term.trim()) params.set("q", term.trim());
        const result = await apiFetch<{ rows: RecordRow[] }>(`${objectApiPath(object)}?${params}`);
        if (current !== request.current) return;
        const nameColumn = OBJECT_META[object].nameColumn;
        setMatches(
          result.rows
            .filter((r) => r.id !== excludeId)
            .map((r) => ({ id: r.id, label: r._display?._name || String(r[nameColumn] ?? r.id) }))
        );
        setActive(0);
      } catch {
        if (current === request.current) setMatches([]);
      } finally {
        if (current === request.current) setLoading(false);
      }
    }, 250);
  };

  const pick = (match: Match) => {
    onChange(match.id, match.label);
    setOpen(false);
    setQuery("");
  };

  if (value && !open) {
    return (
      <div
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm",
          invalid ? "border-oboya-orange" : "border-input"
        )}
      >
        <button
          type="button"
          id={id}
          className="min-w-0 flex-1 truncate text-left text-oboya-blue-dark"
          onClick={() => {
            setOpen(true);
            search("");
          }}
        >
          {label || value}
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t("clear")}
          className="rounded p-0.5 text-muted-foreground hover:text-oboya-blue-dark"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        value={query}
        placeholder={t("lookupPlaceholder")}
        className="h-9 pl-8"
        onFocus={() => {
          setOpen(true);
          search(query);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          search(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {loading ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border/70 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 && !loading ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t("lookupNoResults")}</li>
          ) : (
            matches.map((match, i) => (
              <li
                key={match.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(match);
                }}
                className={cn(
                  "cursor-pointer truncate px-3 py-2 text-sm text-oboya-blue-dark",
                  i === active ? "bg-oboya-soft-white" : "hover:bg-oboya-soft-white/60"
                )}
              >
                {match.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
