import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AutomationPage } from "@/components/crm/automation/AutomationPage";
import type { AutomationLookups, PipelineOption } from "@/components/crm/automation/shared";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { getLeadSlaHours, loadLookups } from "@/lib/crm/repositories/lookups";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automation");
  return { title: t("title") };
}

export default async function Page() {
  const { can, supabase } = await requireCrmAuth();
  if (!can("automation", "view")) return <AccessDenied />;

  const [lookups, slaHours, pipelines, stages] = await Promise.all([
    loadLookups(supabase),
    getLeadSlaHours(supabase),
    supabase.from("crm_pipelines").select("id, name, is_default").order("is_default", { ascending: false }).order("name"),
    supabase.from("crm_pipeline_stages").select("id, pipeline_id, label, active").order("sort_order"),
  ]);

  const pipelineOptions: PipelineOption[] = (pipelines.data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    isDefault: p.is_default === true,
    stages: (stages.data ?? [])
      .filter((s) => s.pipeline_id === p.id)
      .map((s) => ({ id: s.id as string, label: s.label as string, active: s.active !== false })),
  }));

  const data: AutomationLookups = {
    users: lookups.users,
    entities: lookups.entities,
    sources: lookups.picklists.lead_source ?? [],
    pipelines: pipelineOptions,
    slaHours,
    canViewFallback: can("setup_lead_assignment", "view"),
  };

  return <AutomationPage lookups={data} />;
}
