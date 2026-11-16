"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { EmptyState } from "@/components/crm/common/states";
import { crmNavigation, filterNavigation, flattenNavigation } from "@/lib/crm/navigation";

/** Quick-access grid of the Setup sections the user may view. */
export function SetupLanding() {
  const t = useTranslations("setup");
  const tNav = useTranslations("nav");
  const { can } = useCrm();
  const setupGroup = crmNavigation.find((item) => item.labelKey === "setup");
  const items = flattenNavigation(filterNavigation(setupGroup?.children ?? [], can)).filter(
    (item) => item.href && item.icon
  );

  return (
    <>
      <CrmPageHeader title={t("landing.title")} description={t("landing.description")} />
      {items.length === 0 ? (
        <EmptyState title={t("landing.emptyTitle")} description={t("landing.emptyDescription")} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const Icon = item.icon!;
            return (
              <Link
                key={item.href}
                href={item.href!}
                className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-white px-4 py-6 text-center shadow-[var(--shadow-card)] transition-all hover:border-oboya-green/30 hover:shadow-lg"
              >
                <div className="flex size-14 items-center justify-center rounded-xl bg-oboya-green/10 text-oboya-green transition-colors group-hover:bg-oboya-green group-hover:text-white">
                  <Icon className="size-7" />
                </div>
                <p className="text-sm font-semibold text-oboya-blue-dark">{tNav(item.labelKey)}</p>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {t(`landing.hints.${item.labelKey}`)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
