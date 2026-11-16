"use client";

import { useTranslations } from "next-intl";
import { Legend } from "@/components/crm/common/Legend";
import { StatusPill } from "@/components/crm/common/StatusPill";
import type { SlaHours } from "@/lib/crm/leads/sla";

/** SLA legend shown under the leads list, with the configured thresholds (crm_settings.lead_sla_hours). */
export function LeadSlaLegend({ hours }: { hours: SlaHours }) {
  const t = useTranslations("leads");
  return (
    <Legend
      className="mt-3"
      items={[
        {
          key: "on_track",
          swatch: <StatusPill tone="success" size="xs">{t("sla.on_track")}</StatusPill>,
          label: t("list.slaOnTrack", { hours: hours.warning }),
        },
        {
          key: "warning",
          swatch: <StatusPill tone="warning" size="xs">{t("sla.warning")}</StatusPill>,
          label: t("list.slaWarning", { hours: hours.warning }),
        },
        {
          key: "overdue",
          swatch: <StatusPill tone="danger" size="xs">{t("sla.overdue")}</StatusPill>,
          label: t("list.slaOverdue", { hours: hours.overdue }),
        },
      ]}
    />
  );
}
