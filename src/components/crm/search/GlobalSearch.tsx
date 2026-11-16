"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { apiFetch } from "@/components/crm/common/api";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import { OBJECT_META } from "@/lib/crm/objects/types";
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_LENGTH,
  normalizeSearchQuery,
  seeAllHref,
  type SearchGroup,
} from "@/lib/crm/search/query";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Topbar global search (⌘K / Ctrl+K). Desktop: an inline combobox with a
 * results popover. Mobile: an icon that opens the same panel in a full-width
 * top sheet. Results come from GET /api/crm/search (RLS-scoped).
 */
export function GlobalSearch() {
  const t = useTranslations("search");
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => true);
  const isMac = useSyncExternalStore(noopSubscribe, () => /Mac|iPhone|iPad/.test(navigator.userAgent), () => true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const desktopInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        desktopInput.current?.focus();
        desktopInput.current?.select();
      } else {
        setSheetOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const shortcut = isMac ? "⌘K" : "Ctrl K";

  return (
    <>
      {isDesktop ? (
        <div className="w-56 lg:w-80">
          <SearchPanel inputRef={desktopInput} shortcut={shortcut} variant="popover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          aria-label={t("open")}
        >
          <Search className="size-5" />
        </button>
      )}
      <Sheet open={sheetOpen && !isDesktop} onOpenChange={setSheetOpen}>
        <SheetContent side="top" showCloseButton={false} className="max-h-[90dvh] gap-0 p-3">
          <SheetTitle className="sr-only">{t("label")}</SheetTitle>
          <SearchPanel variant="sheet" autoFocus shortcut={shortcut} onDone={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

type Option = { id: string; href: string };
type Status = "idle" | "loading" | "done" | "error";

function SearchPanel({
  variant,
  inputRef,
  autoFocus,
  shortcut,
  onDone,
}: {
  variant: "popover" | "sheet";
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  shortcut: string;
  /** Called after navigating or on Escape (closes the sheet). */
  onDone?: () => void;
}) {
  const t = useTranslations("search");
  const tShell = useTranslations("shell");
  const router = useRouter();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [resultQ, setResultQ] = useState("");
  const [active, setActive] = useState(-1);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (variant !== "popover" || !focused) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [variant, focused]);

  const runSearch = async (term: string) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setStatus("loading");
    try {
      const json = await apiFetch<{ groups: SearchGroup[] }>(`/api/crm/search?${new URLSearchParams({ q: term })}`, {
        signal: ctrl.signal,
        quiet: true,
      });
      setGroups(json.groups);
      setResultQ(term);
      setActive(-1);
      setStatus("done");
    } catch {
      if (!ctrl.signal.aborted) setStatus("error");
    }
  };

  const onChange = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const term = normalizeSearchQuery(value);
    if (!term) {
      controller.current?.abort();
      setStatus("idle");
      setGroups([]);
      setActive(-1);
      return;
    }
    timer.current = setTimeout(() => void runSearch(term), SEARCH_DEBOUNCE_MS);
  };

  // Flat option list in display order: hits of each group, then its "See all".
  const options: Option[] = [];
  for (const group of groups) {
    const basePath = OBJECT_META[group.object].basePath;
    for (const hit of group.hits) options.push({ id: `${baseId}-${group.object}-${hit.id}`, href: `${basePath}/${hit.id}` });
    options.push({ id: `${baseId}-${group.object}-all`, href: seeAllHref(basePath, resultQ) });
  }
  const indexOf = (id: string) => options.findIndex((o) => o.id === id);

  const go = (href: string) => {
    router.push(href);
    setFocused(false);
    inputRef?.current?.blur();
    onDone?.();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      const target = options[active] ?? options[0];
      if (target) {
        event.preventDefault();
        go(target.href);
      }
    } else if (event.key === "Escape") {
      if (variant === "popover") {
        setFocused(false);
        inputRef?.current?.blur();
      } else {
        onDone?.();
      }
    }
  };

  const showList = variant === "sheet" ? q.trim() !== "" : focused && q.trim() !== "";
  const activeId = options[active]?.id;
  const tooShort = normalizeSearchQuery(q) === null;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={t("label")}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? activeId : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          value={q}
          placeholder={t("placeholder")}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-lg border border-border/70 bg-white pr-16 pl-8 text-sm text-oboya-blue-dark outline-none placeholder:text-muted-foreground focus-visible:border-oboya-blue/60 focus-visible:ring-2 focus-visible:ring-oboya-blue/20 [&::-webkit-search-cancel-button]:hidden",
            variant === "sheet" ? "h-11" : "h-9"
          )}
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {status === "loading" ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
          {q ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
                inputRef?.current?.focus();
              }}
              aria-label={tShell("clearSearch")}
              className="rounded p-1 text-muted-foreground hover:text-oboya-blue-dark"
            >
              <X className="size-3.5" />
            </button>
          ) : variant === "popover" ? (
            <kbd className="rounded border border-border/70 bg-oboya-soft-white px-1.5 font-sans text-[10px] text-muted-foreground" title={t("shortcut", { shortcut })}>
              {shortcut}
            </kbd>
          ) : (
            <button type="button" onClick={onDone} aria-label={t("close")} className="rounded p-1 text-muted-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {showList ? (
        <div
          className={cn(
            "overflow-y-auto bg-white",
            variant === "popover"
              ? "absolute top-full right-0 z-50 mt-2 max-h-[70vh] w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border/60 shadow-[var(--shadow-card)]"
              : "mt-2 max-h-[calc(90dvh-5rem)]"
          )}
        >
          <div id={listId} role="listbox" aria-label={t("label")}>
            {groups.map((group) => {
              const config = getRecordConfig(group.object);
              const Icon = config?.icon ?? Search;
              const label = t(`groups.${group.object}`);
              const allId = `${baseId}-${group.object}-all`;
              return (
                <div key={group.object} role="group" aria-label={label} className="border-b border-border/50 py-1 last:border-b-0">
                  <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase" aria-hidden>
                    {label}
                  </p>
                  {group.hits.map((hit) => {
                    const id = `${baseId}-${group.object}-${hit.id}`;
                    const selected = activeId === id;
                    return (
                      <div
                        key={hit.id}
                        id={id}
                        role="option"
                        aria-selected={selected}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => go(`${OBJECT_META[group.object].basePath}/${hit.id}`)}
                        onPointerMove={() => setActive(indexOf(id))}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 md:min-h-0",
                          selected && "bg-oboya-soft-white"
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-oboya-soft-white text-oboya-blue">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-oboya-blue-dark">{hit.name}</span>
                          {hit.secondary ? (
                            <span className="block truncate text-xs text-muted-foreground">{hit.secondary}</span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                  <div
                    id={allId}
                    role="option"
                    aria-selected={activeId === allId}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => go(seeAllHref(OBJECT_META[group.object].basePath, resultQ))}
                    onPointerMove={() => setActive(indexOf(allId))}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-oboya-blue-light md:min-h-0",
                      activeId === allId && "bg-oboya-soft-white"
                    )}
                  >
                    {t("seeAll", { object: label })}
                    <ArrowRight className="size-3" aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>
          <div aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground empty:hidden">
            {tooShort
              ? t("minChars", { count: SEARCH_MIN_LENGTH })
              : status === "error"
                ? t("failed")
                : status === "loading" && groups.length === 0
                  ? t("searching")
                  : status === "done" && groups.length === 0
                    ? t("noResults", { q: resultQ })
                    : null}
          </div>
          {options.length > 0 ? (
            <p className="hidden border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground md:block">{t("hint")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
