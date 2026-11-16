import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { OpportunityKanban } from "@/components/crm/pipeline/OpportunityKanban";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import { parseListQuery } from "@/lib/crm/objects/query";
import { PIPELINE_LIMIT, pipelineKey, pipelineParams } from "@/lib/crm/opportunities/pipeline";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("pipelineTitle") };
}

/** Opportunities kanban (one column per active stage). */
export default async function OpportunityPipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user, can } = await requireCrmAuth();
  if (!can(opportunityConfig.module, "view")) return <AccessDenied />;

  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  ) as Record<string, string | undefined>;
  const key = pipelineKey(flat);
  const query = parseListQuery(opportunityConfig, pipelineParams(flat), { maxPageSize: PIPELINE_LIMIT });

  const [lookups, initial] = await Promise.all([
    loadLookups(supabase),
    list(supabase, opportunityConfig, query, { userId: user.id }).catch((error) => {
      console.error("opportunity pipeline failed:", error);
      return null;
    }),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return <OpportunityKanban lookups={lookups} initial={initial ? { key, ...initial } : undefined} today={today} />;
}
