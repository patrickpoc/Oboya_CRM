import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { ReportBuilder } from "@/components/crm/reports/ReportBuilder";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.builder");
  return { title: t("newTitle") };
}

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, can } = await requireCrmAuth();
  if (!can("reports", "view") || !can("reports", "create")) return <AccessDenied />;
  const { object } = await searchParams;
  return <ReportBuilder presetObject={Array.isArray(object) ? object[0] : object} lookups={await loadLookups(supabase)} />;
}
