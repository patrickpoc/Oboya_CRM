"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, KeyRound, LogOut, Menu, UserRound } from "lucide-react";
import { hardNavigate } from "@/app/(auth)/_components/AuthCard";
import { CrmLanguageSwitcher, useChangeCrmLocale } from "@/components/crm/layout/CrmLanguageSwitcher";
import { NotificationBell } from "@/components/crm/notifications/NotificationBell";
import { EntityAvatar } from "@/components/crm/common/EntityAvatar";
import { CRM_LOCALE_OPTIONS } from "@/contexts/CrmLocaleContext";
import { useCrm } from "@/contexts/CrmContext";
import { getBreadcrumbs, type Breadcrumb } from "@/lib/crm/navigation";
import { cn } from "@/lib/utils";
import { closeEmailDatabases } from "@/lib/crm/email/local-db";

interface CrmTopbarProps {
  onMenuClick?: () => void;
  menuOpen?: boolean;
  /** Global search control; rendered in `#crm-search-slot`. */
  search?: React.ReactNode;
}

export function CrmTopbar({ onMenuClick, menuOpen, search }: CrmTopbarProps) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const crumbs = getBreadcrumbs(pathname);

  const crumbLabel = (crumb: Breadcrumb) => {
    if (crumb.labelKey === "detail") return t("detail");
    if (crumb.labelKey && tNav.has(crumb.labelKey)) return tNav(crumb.labelKey);
    return crumb.label;
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/60 bg-white/95 px-4 backdrop-blur md:gap-4 md:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
        aria-label={t("openNav")}
        aria-controls="crm-sidebar"
        aria-expanded={menuOpen}
      >
        <Menu className="size-5" />
      </button>

      <nav aria-label={t("breadcrumbs")} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => (
          <span
            key={`${crumb.labelKey ?? crumb.label}-${i}`}
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              i > 0 && i < crumbs.length - 1 && "hidden sm:flex",
              i === 0 && crumbs.length > 1 && "hidden sm:flex"
            )}
          >
            {i > 0 && <span className="text-muted-foreground/50">/</span>}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="truncate text-muted-foreground hover:text-foreground"
              >
                {crumbLabel(crumb)}
              </Link>
            ) : (
              <span className="truncate font-medium text-oboya-blue-dark">
                {crumbLabel(crumb)}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div id="crm-search-slot" className="flex shrink-0 items-center empty:hidden">
        {search}
      </div>

      {/* The user menu also switches language, so the standalone switcher yields room at 768-1024px. */}
      <CrmLanguageSwitcher className="hidden lg:block" />

      <NotificationBell />

      <CrmUserMenu />
    </header>
  );
}

function CrmUserMenu() {
  const t = useTranslations("shell");
  const { user } = useCrm();
  const { locale, change } = useChangeCrmLocale();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const name = user.fullName || user.email;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleLogout = () => {
    setSigningOut(true);
    closeEmailDatabases();
    // The route drops the Supabase session and ends the Casdoor SSO session.
    hardNavigate("/api/auth/casdoor/logout");
  };

  const itemClass =
    "flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-oboya-blue-dark transition-colors hover:bg-oboya-soft-white md:min-h-9";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("userMenu")}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted",
          open && "bg-muted"
        )}
      >
        <EntityAvatar name={name} tone="green" size="sm" className="size-7" />
        <div className="hidden text-left lg:block">
          <p className="max-w-40 truncate text-xs font-medium text-oboya-blue-dark">{name}</p>
          <p className="max-w-40 truncate text-[10px] text-muted-foreground">{user.roleLabel}</p>
        </div>
        <ChevronDown className="hidden size-3.5 text-muted-foreground lg:block" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("userMenu")}
          className="absolute top-full right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border/60 bg-white py-1 shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-border/60 px-3.5 py-3">
            <p className="truncate text-sm font-semibold text-oboya-blue-dark">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{user.roleLabel}</p>
          </div>

          <Link
            href="/profile"
            role="menuitem"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <UserRound className="size-4 text-muted-foreground" aria-hidden />
            {t("profileSettings")}
          </Link>

          <Link
            href="/change-password"
            role="menuitem"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <KeyRound className="size-4 text-muted-foreground" aria-hidden />
            {t("changePassword")}
          </Link>

          <div className="border-t border-border/60 py-1" role="group" aria-label={t("language")}>
            <p className="px-3.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("language")}
            </p>
            {CRM_LOCALE_OPTIONS.map((item) => {
              const selected = item.value === locale;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    change(item.value);
                    setOpen(false);
                  }}
                  className={cn(itemClass, selected && "font-semibold text-oboya-green")}
                >
                  <span className="flex size-4 items-center justify-center" aria-hidden>
                    {selected ? <Check className="size-4" /> : null}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {item.short}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-border/60 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              disabled={signingOut}
              className={cn(itemClass, "disabled:opacity-60")}
            >
              <LogOut className="size-4 text-muted-foreground" aria-hidden />
              {signingOut ? t("signingOut") : t("signOut")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
