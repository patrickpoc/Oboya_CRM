import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { LeadAssignmentSetup } from "@/components/crm/setup/LeadAssignmentSetup";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("leadAssignment") };
}

export default async function Page() {
  const { can } = await requireCrmAuth();
  if (!can("setup_lead_assignment", "view")) return <AccessDenied />;
  return <LeadAssignmentSetup />;
}
