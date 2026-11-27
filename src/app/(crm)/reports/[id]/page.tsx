import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { ReportView } from "@/components/crm/reports/ReportView";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.view");
  return { title: t("title") };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { can } = await requireCrmAuth();
  if (!can("reports", "view")) return <AccessDenied />;
  const { id } = await params;
  return <ReportView id={id} />;
}
