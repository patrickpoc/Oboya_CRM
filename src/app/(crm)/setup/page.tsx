import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SetupLanding } from "@/components/crm/setup/SetupLanding";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("setup") };
}

/** Grid of the Setup sections the user may view (each page re-checks its module). */
export default async function SetupPage() {
  await requireCrmAuth();
  return <SetupLanding />;
}
