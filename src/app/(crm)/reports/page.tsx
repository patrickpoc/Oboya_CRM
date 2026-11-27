import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { ReportsIndex, type TeamOption } from "@/components/crm/reports/ReportsIndex";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.index");
  return { title: t("title") };
}

/** Reports & Dashboards index. Teams feed the visibility pickers (the database enforces the publish rule). */
export default async function ReportsPage() {
  const { user, can, supabase } = await requireCrmAuth();
  if (!can("reports")) return <AccessDenied />;

  const { data } = await supabase.from("crm_teams").select("id, name, manager_id").eq("active", true).order("name");
  const teams: TeamOption[] = (data ?? []).map((t) => ({ id: t.id, name: t.name, managerId: t.manager_id }));
  const managedTeamIds = teams.filter((t) => t.managerId === user.id).map((t) => t.id);

  return <ReportsIndex teams={teams} isAdmin={user.role === "super_admin"} managedTeamIds={managedTeamIds} />;
}
