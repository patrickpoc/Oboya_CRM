"use client";

import { useTranslations } from "next-intl";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertsTab } from "./AlertsTab";
import { AssignmentRulesTab } from "./AssignmentRulesTab";
import { RunsTab } from "./RunsTab";
import { StageTasksTab } from "./StageTasksTab";
import type { AutomationLookups } from "./shared";

export const AUTOMATION_TABS = ["assignment", "stage-tasks", "alerts", "runs"] as const;
type AutomationTab = (typeof AUTOMATION_TABS)[number];

/** /automation: tabs selected by `?tab=`. */
export function AutomationPage({ lookups }: { lookups: AutomationLookups }) {
  const t = useTranslations("automation");
  const { filters, setFilters } = useUrlFilters({ tab: "assignment" });
  const tab: AutomationTab = (AUTOMATION_TABS as readonly string[]).includes(filters.tab)
    ? (filters.tab as AutomationTab)
    : "assignment";

  return (
    <>
      <CrmPageHeader title={t("title")} description={t("description")} />
      <Tabs value={tab} onValueChange={(next) => setFilters({ tab: next })}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-11 md:h-9" ariaLabel={t("tabsLabel")}>
            {AUTOMATION_TABS.map((id) => (
              <TabsTrigger key={id} value={id} className="min-h-9 whitespace-nowrap md:min-h-0">
                {t(`tabs.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="assignment">
          <AssignmentRulesTab lookups={lookups} />
        </TabsContent>
        <TabsContent value="stage-tasks">
          <StageTasksTab lookups={lookups} />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab lookups={lookups} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
