import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OpportunityPath } from "@/components/crm/pipeline/OpportunityPath";
import { RecordPage } from "@/components/crm/record/RecordPage";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("singular") };
}

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

/**
 * Opportunity record page: generic RecordPage (reads the record through the
 * repository once) + stage path with the Closed Lost dialog.
 */
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmAuth();
  const { id } = await params;

  return (
    <RecordPage
      object="opportunity"
      id={id}
      slots={({ record, lookups }) => ({
        pathSlot:
          typeof record.stage_id === "string" ? (
            <OpportunityPath
              id={record.id}
              name={record._display?._name ?? text(record.name) ?? ""}
              stageId={record.stage_id}
              lossReason={text(record.loss_reason)}
              lossNote={text(record.loss_note)}
              stages={lookups.stages}
              lossReasons={lookups.picklists.loss_reason ?? []}
            />
          ) : undefined,
      })}
    />
  );
}
