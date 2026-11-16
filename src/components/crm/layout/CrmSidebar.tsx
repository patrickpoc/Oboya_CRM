"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useCrm } from "@/contexts/CrmContext";
import {
  badgeTotal,
  crmNavigation,
  filterNavigation,
  findActiveHref,
  type CrmNavItem,
  type NavCounts,
} from "@/lib/crm/navigation";
import { cn } from "@/lib/utils";

function CountBadge({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-oboya-orange px-1.5 text-[10px] font-semibold leading-5 text-white">
      {value > 99 ? "99+" : value}
    </span>
  );
}

function SoonBadge() {
  const t = useTranslations("shell");
  return (
    <span className="ml-auto inline-flex items-center rounded-full bg-oboya-soft-white px-1.5 text-[10px] font-semibold leading-4 text-oboya-blue-dark/70 ring-1 ring-inset ring-border/70">
      {t("soon")}
    </span>
  );
}

interface CrmSidebarProps {
  mobileOpen?: boolean;
  onNavigate?: () => void;
  /** Badge counts (`leadsNew`, `tasksDue`); missing keys render no badge. */
  counts?: NavCounts;
}

export function CrmSidebar({ mobileOpen = false, onNavigate, counts = {} }: CrmSidebarProps) {
  const pathname = usePathname();
  const { can, user } = useCrm();
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const items = useMemo(
    () => filterNavigation(crmNavigation, can, { isSuperAdmin: user.role === "super_admin" }),
    [can, user.role]
  );
  const activeHref = findActiveHref(pathname, items);

  return (
    <aside
      id="crm-sidebar"
      aria-label={tShell("mainNav")}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-border/60 bg-white transition-transform duration-300 lg:z-30 lg:max-w-none lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border/60 px-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="relative block shrink-0" aria-label="Oboya Horticulture">
            <Image
              src="/assets/logo.svg"
              alt="Oboya Horticulture"
              width={160}
              height={39}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <span className="text-xs font-semibold text-muted-foreground">{tShell("crm")}</span>
        </div>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
          aria-label={tShell("closeNav")}
          onClick={onNavigate}
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain p-3">
        <ul className="space-y-1">
          {items.map((item) => {
            if (!item.children || item.href) {
              const active = item.href === activeHref;
              return (
                <li key={item.labelKey}>
                  <Link
                    href={item.href ?? "#"}
                    prefetch={item.soon ? false : undefined}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-oboya-green/10 font-medium text-oboya-green"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {item.icon && <item.icon className="size-4 shrink-0" />}
                    {t(item.labelKey)}
                    {item.soon ? <SoonBadge /> : <CountBadge value={badgeTotal(item, counts)} />}
                  </Link>
                </li>
              );
            }

            return (
              <NavGroup
                key={item.labelKey}
                item={item}
                activeHref={activeHref}
                onNavigate={onNavigate}
                counts={counts}
              />
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function containsHref(item: CrmNavItem, href?: string): boolean {
  if (!href) return false;
  return item.href === href || (item.children ?? []).some((child) => containsHref(child, href));
}

function NavGroup({
  item,
  activeHref,
  onNavigate,
  counts,
}: {
  item: CrmNavItem;
  activeHref?: string;
  onNavigate?: () => void;
  counts: NavCounts;
}) {
  const t = useTranslations("nav");
  const isChildActive = containsHref(item, activeHref);
  const [open, setOpen] = useState(Boolean(isChildActive) || item.labelKey === "sales");
  const groupId = `crm-nav-${item.labelKey}`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={groupId}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
          isChildActive
            ? "font-medium text-oboya-blue-dark"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        <span className="flex-1 text-left">{t(item.labelKey)}</span>
        {!open ? <CountBadge value={badgeTotal(item, counts)} /> : null}
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      {open && (
        <ul id={groupId} className="mt-1 ml-4 space-y-0.5 border-l border-border/50 pl-3">
          {item.children?.map((child) => (
            <NavLeaf
              key={child.labelKey}
              item={child}
              activeHref={activeHref}
              onNavigate={onNavigate}
              counts={counts}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NavLeaf({
  item,
  activeHref,
  onNavigate,
  counts,
  depth = 0,
}: {
  item: CrmNavItem;
  activeHref?: string;
  onNavigate?: () => void;
  counts: NavCounts;
  depth?: number;
}) {
  const t = useTranslations("nav");
  const active = item.href === activeHref;
  return (
    <li>
      <Link
        href={item.href ?? "#"}
        prefetch={item.soon ? false : undefined}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors md:py-1.5 md:text-xs",
          depth > 0 && "pl-6",
          active
            ? "bg-oboya-green/10 font-medium text-oboya-green"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <span className="truncate">{t(item.labelKey)}</span>
        {item.soon ? (
          <SoonBadge />
        ) : (
          <CountBadge value={item.badge ? (counts[item.badge] ?? 0) : 0} />
        )}
      </Link>
      {item.children?.length ? (
        <ul className="space-y-0.5">
          {item.children.map((child) => (
            <NavLeaf
              key={child.labelKey}
              item={child}
              activeHref={activeHref}
              onNavigate={onNavigate}
              counts={counts}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
