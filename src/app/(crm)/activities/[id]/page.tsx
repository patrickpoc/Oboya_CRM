import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RecordPage } from "@/components/crm/record/RecordPage";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activities");
  return { title: t("singular") };
}

/** Activity record page (markViewed is called by RecordPage). */
export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmAuth();
  const { id } = await params;
  return <RecordPage object="activity" id={id} />;
}
