import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RecordPage } from "@/components/crm/record/RecordPage";
import { getEntityDefaultCurrency, leadSummaryFromRecord } from "@/lib/crm/leads/repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";
import { ConvertLeadButton } from "../_components/ConvertLeadButton";
import { LeadStatusPath } from "../_components/LeadStatusPath";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leads");
  return { title: t("singular") };
}

/** Lead record page (RecordPage handles 404/permissions and markViewed, and reads the lead once). */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, can } = await requireCrmAuth();
  const { id } = await params;

  return (
    <RecordPage
      object="lead"
      id={id}
      slots={async ({ record }) => {
        const lead = leadSummaryFromRecord(record);
        const canConvert = !lead.convertedAt && can("leads", "convert");
        return {
          actionSlot: canConvert ? (
            <ConvertLeadButton
              leadId={lead.id}
              leadName={lead.name}
              company={lead.company}
              defaultCurrency={await getEntityDefaultCurrency(supabase, record.entity_id)}
            />
          ) : undefined,
          pathSlot: (
            <LeadStatusPath
              leadId={lead.id}
              status={lead.status}
              unqualifiedReason={lead.unqualifiedReason}
              convertedAt={lead.convertedAt}
              account={lead.account}
              contact={lead.contact}
              opportunity={lead.opportunity}
            />
          ),
        };
      }}
    />
  );
}
