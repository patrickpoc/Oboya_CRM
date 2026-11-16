"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CrmProvider } from "@/contexts/CrmContext";
import { CrmSidebar } from "@/components/crm/layout/CrmSidebar";
import { CrmTopbar } from "@/components/crm/layout/CrmTopbar";
import { CrmPageTransition } from "@/components/crm/layout/CrmPageTransition";
import { CrmLoadingProvider } from "@/components/crm/layout/CrmLoadingContext";
import { CrmRouteDocumentTitle } from "@/components/crm/layout/CrmRouteDocumentTitle";
import { useNavCounts } from "@/components/crm/layout/use-nav-counts";
import { GlobalSearch } from "@/components/crm/search/GlobalSearch";
import type { NavCounts } from "@/lib/crm/navigation";
import type { CrmUser, ResolvedPermissions } from "@/lib/crm/types";

function CrmShellFrame({
  children,
  counts,
  search,
}: {
  children: React.ReactNode;
  counts?: NavCounts;
  search?: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const polledCounts = useNavCounts();

  // Close the drawer on route change and on Escape.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route change closes the mobile drawer
    setSidebarOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    <CrmLoadingProvider>
      <CrmRouteDocumentTitle />
      <div className="min-h-screen bg-oboya-soft-white">
        {sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-oboya-blue-dark/40 lg:hidden"
            aria-label={t("closeNav")}
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <CrmSidebar
          mobileOpen={sidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
          counts={counts ?? polledCounts}
        />
        <div className="lg:pl-64">
          <CrmTopbar
            onMenuClick={() => setSidebarOpen(true)}
            menuOpen={sidebarOpen}
            search={search ?? <GlobalSearch />}
          />
          <main className="p-4 sm:p-6">
            <CrmPageTransition>{children}</CrmPageTransition>
          </main>
        </div>
      </div>
    </CrmLoadingProvider>
  );
}

export function CrmShell({
  children,
  user,
  permissions,
  counts,
  search,
}: {
  children: React.ReactNode;
  user: CrmUser;
  permissions: ResolvedPermissions;
  /** Overrides the `/api/crm/nav-counts` poll (e.g. counts computed on the server). */
  counts?: NavCounts;
  /** Global search control for the topbar slot. */
  search?: React.ReactNode;
}) {
  return (
    <CrmProvider initialUser={user} initialPermissions={permissions}>
      <CrmShellFrame counts={counts} search={search}>
        {children}
      </CrmShellFrame>
    </CrmProvider>
  );
}
