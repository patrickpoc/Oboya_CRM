import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { IndustryNewsView } from "@/components/crm/insights/IndustryNewsView";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("industryNews");
  return { title: t("title"), description: t("description") };
}

export default async function IndustryNewsPage() {
  const { can } = await requireCrmAuth();
  if (!can("industry_news", "view")) return <AccessDenied />;
  return <IndustryNewsView />;
}
