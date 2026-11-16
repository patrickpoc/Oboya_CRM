"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Settings2, Star, X, type LucideIcon } from "lucide-react";
import { useCrm } from "@/contexts/CrmContext";
import {
  crmNavigation,
  filterNavigation,
  flattenNavigation,
  type CrmNavItem,
} from "@/lib/crm/navigation";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "oboya-crm-quick-access";

/** Live, viewable modules with an icon (planned modules and Home excluded). */
function getQuickAccessItems(items: CrmNavItem[]): (CrmNavItem & { href: string })[] {
  return flattenNavigation(items).filter(
    (item): item is CrmNavItem & { href: string } =>
      Boolean(item.href && item.icon && item.module && !item.soon && item.module !== "home")
  );
}

function loadPinned(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${userId}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function savePinned(userId: string, hrefs: string[]) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${userId}`, JSON.stringify(hrefs));
  } catch {
    // Ignore quota / private mode.
  }
}

/** A fixed tile: a link, an action button, or a planned module ("Soon", not clickable). */
export type QuickAccessItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  soon?: boolean;
};

const TILE =
  "group relative flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-white px-4 text-center shadow-[var(--shadow-card)] transition-all";

/**
 * Without `items`: every viewable module, pinnable per user (reference
 * behaviour). With `items`: a fixed set of tiles (callers gate them by permission).
 */
export function QuickAccessGrid({
  items,
  title,
  soonLabel,
}: {
  items?: QuickAccessItem[];
  title?: string;
  soonLabel?: string;
} = {}) {
  return items ? <QuickAccessTiles items={items} title={title} soonLabel={soonLabel} /> : <PinnableQuickAccess />;
}

function QuickAccessTiles({ items, title, soonLabel }: { items: QuickAccessItem[]; title?: string; soonLabel?: string }) {
  return (
    <section aria-label={title}>
      {title ? <h2 className="mb-4 text-sm font-semibold text-oboya-blue-dark">{title}</h2> : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const body = (
            <>
              <div
                className={cn(
                  "flex size-14 items-center justify-center rounded-xl bg-oboya-green/10 text-oboya-green transition-colors",
                  !item.soon && "group-hover:bg-oboya-green group-hover:text-white",
                  item.soon && "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-7" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-oboya-blue-dark">{item.label}</p>
              {item.soon && soonLabel ? (
                <span className="absolute top-3 right-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {soonLabel}
                </span>
              ) : null}
            </>
          );
          if (item.soon) {
            return (
              <div key={item.key} className={cn(TILE, "opacity-70")} aria-disabled="true">
                {body}
              </div>
            );
          }
          if (item.onClick) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className={cn(TILE, "hover:border-oboya-green/30 hover:shadow-lg")}
              >
                {body}
              </button>
            );
          }
          return (
            <Link key={item.key} href={item.href ?? "#"} className={cn(TILE, "hover:border-oboya-green/30 hover:shadow-lg")}>
              {body}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function PinnableQuickAccess() {
  const t = useTranslations("shell.quickAccess");
  const tNav = useTranslations("nav");
  const tShell = useTranslations("shell");
  const { user, can } = useCrm();
  const [pinnedHrefs, setPinnedHrefs] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = loadPinned(user.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is read after hydration to avoid an SSR mismatch
    setPinnedHrefs(new Set(stored));
    setMounted(true);
  }, [user.id]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const allItems = useMemo(
    () => getQuickAccessItems(filterNavigation(crmNavigation, can)),
    [can]
  );

  const togglePin = useCallback(
    (href: string) => {
      setPinnedHrefs((prev) => {
        const next = new Set(prev);
        if (next.has(href)) next.delete(href);
        else next.add(href);
        savePinned(user.id, Array.from(next));
        return next;
      });
    },
    [user.id]
  );

  const visibleItems =
    pinnedHrefs.size > 0 ? allItems.filter((item) => pinnedHrefs.has(item.href)) : allItems;

  if (!mounted) return null;

  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-oboya-blue-dark">{t("title")}</h2>
          <p className="text-xs text-muted-foreground">
            {pinnedHrefs.size > 0 ? t("pinnedCount", { count: pinnedHrefs.size }) : t("allSections")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 md:min-h-0"
        >
          <Settings2 className="size-3.5" />
          {t("customize")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isPinned = pinnedHrefs.has(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-white px-4 text-center shadow-[var(--shadow-card)] transition-all hover:border-oboya-green/30 hover:shadow-lg"
            >
              {Icon && (
                <div className="flex size-14 items-center justify-center rounded-xl bg-oboya-green/10 text-oboya-green transition-colors group-hover:bg-oboya-green group-hover:text-white">
                  <Icon className="size-7" />
                </div>
              )}
              <p className="text-sm font-semibold text-oboya-blue-dark">{tNav(item.labelKey)}</p>
              {isPinned && (
                <Star className="absolute top-3 right-3 size-3.5 fill-oboya-green/60 text-oboya-green/60" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Customize drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-oboya-blue-dark/30 animate-in fade-in duration-200"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-quick-access-title"
            className="fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto bg-white shadow-2xl animate-in slide-in-from-right duration-300"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-white px-5 py-4">
              <div>
                <h3 id="crm-quick-access-title" className="text-sm font-semibold text-oboya-blue-dark">
                  {t("customizeTitle")}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("customizeSubtitle")}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
                aria-label={tShell("close")}
              >
                <X className="size-4" />
              </button>
            </div>

            <ul className="divide-y divide-border/50 px-5">
              {allItems.map((item) => {
                const Icon = item.icon;
                const isPinned = pinnedHrefs.has(item.href);
                const label = tNav(item.labelKey);

                return (
                  <li key={item.href} className="py-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isPinned}
                        aria-label={label}
                        onClick={() => togglePin(item.href)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                          isPinned ? "bg-oboya-green" : "bg-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                            isPinned ? "translate-x-[18px]" : "translate-x-[3px]"
                          )}
                        />
                      </button>
                      {Icon && (
                        <div
                          className={cn(
                            "flex size-8 items-center justify-center rounded-lg",
                            isPinned ? "bg-oboya-green/10 text-oboya-green" : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Icon className="size-4" />
                        </div>
                      )}
                      <p
                        className={cn(
                          "min-w-0 flex-1 text-sm font-medium",
                          isPinned ? "text-oboya-blue-dark" : "text-muted-foreground"
                        )}
                      >
                        {label}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-border/50 px-5 py-4">
              <p className="text-[11px] text-muted-foreground">{t("customizeHint")}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
