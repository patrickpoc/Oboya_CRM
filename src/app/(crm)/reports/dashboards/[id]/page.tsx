import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DashboardView } from "@/components/crm/reports/DashboardView";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.dashboards");
  return { title: t("title") };
}

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { can } = await requireCrmAuth();
  if (!can("reports")) return <AccessDenied />;
  const { id } = await params;
  return <DashboardView id={id} />;
}
