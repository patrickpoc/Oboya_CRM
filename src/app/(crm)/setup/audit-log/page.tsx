import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { AuditLogSetup } from "@/components/crm/setup/AuditLogSetup";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("auditLog") };
}

export default async function Page() {
  const { can } = await requireCrmAuth();
  if (!can("audit_logs", "view")) return <AccessDenied />;
  return <AuditLogSetup />;
}
