"use client";

import { useLayoutEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { crmNavigation, findActiveHref, flattenNavigation } from "@/lib/crm/navigation";

const CRM_TITLE_SUFFIX = "Oboya CRM";

/** Sets the browser tab title for CRM pages. */
export function setCrmDocumentTitle(pageTitle: string) {
  const trimmed = pageTitle.trim();
  document.title = trimmed ? `${trimmed} | ${CRM_TITLE_SUFFIX}` : CRM_TITLE_SUFFIX;
}

/** Sync browser title from a page heading (CrmPageHeader). */
export function useCrmDocumentTitle(pageTitle: string) {
  useLayoutEffect(() => {
    if (!pageTitle.trim()) return;
    setCrmDocumentTitle(pageTitle);
  }, [pageTitle]);
}

/**
 * Route-based browser title so the tab is never blank while a page loads.
 * CrmPageHeader overrides this with the page H1 via useLayoutEffect.
 */
export function CrmRouteDocumentTitle() {
  const pathname = usePathname() || "/dashboard";
  const t = useTranslations("nav");

  const title = useMemo(() => {
    const href = findActiveHref(pathname);
    const match = flattenNavigation(crmNavigation).find((item) => item.href === href);
    if (!match) return "";
    return t.has(match.labelKey) ? t(match.labelKey) : match.label;
  }, [pathname, t]);

  useLayoutEffect(() => {
    setCrmDocumentTitle(title);
  }, [title]);

  return null;
}
