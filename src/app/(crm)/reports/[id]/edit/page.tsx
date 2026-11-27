import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { ReportBuilder } from "@/components/crm/reports/ReportBuilder";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.builder");
  return { title: t("editTitle") };
}

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, can } = await requireCrmAuth();
  if (!can("reports", "view") || !can("reports", "edit")) return <AccessDenied />;
  const { id } = await params;
  return <ReportBuilder id={id} lookups={await loadLookups(supabase)} />;
}
