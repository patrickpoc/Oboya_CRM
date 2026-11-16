import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { UsersSetup } from "@/components/crm/setup/UsersSetup";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("users") };
}

export default async function Page() {
  const { can } = await requireCrmAuth();
  if (!can("setup_users", "view")) return <AccessDenied />;
  return <UsersSetup />;
}
