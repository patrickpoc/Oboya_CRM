import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HomeGrid } from "@/components/crm/home/HomeGrid";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("home") };
}

/**
 * Home: KPIs, pipeline by stage, my tasks, recent records and quick access.
 * Numbers load client-side from /api/crm/dashboard (needs the browser
 * timezone); lookups are loaded here only for the New lead / New account drawers.
 */
export default async function DashboardPage() {
  const { user, can, supabase } = await requireCrmAuth();
  const t = await getTranslations("dashboard");
  if (!can("home")) return <AccessDenied />;

  const lookups = can("leads", "create") || can("accounts", "create") ? await loadLookups(supabase) : null;

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("greeting", { name: user.fullName || user.email })}
      />
      <HomeGrid lookups={lookups} />
    </>
  );
}
