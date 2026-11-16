import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ObjectListView } from "@/components/crm/list/ObjectListView";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { leadConfig } from "@/lib/crm/objects/lead";
import { listParamsKey, parseListQuery } from "@/lib/crm/objects/query";
import { getLeadSlaHours, loadLookups } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";
import { LeadSlaLegend } from "./_components/LeadListExtras";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leads");
  return { title: t("title") };
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user, can } = await requireCrmAuth();
  if (!can(leadConfig.module, "view")) return <AccessDenied />;

  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  ) as Record<string, string | undefined>;
  const key = listParamsKey(leadConfig, flat);
  const query = parseListQuery(leadConfig, new URLSearchParams(key));

  const [lookups, slaHours, initial] = await Promise.all([
    loadLookups(supabase),
    getLeadSlaHours(supabase),
    list(supabase, leadConfig, query, { userId: user.id }).catch((error) => {
      console.error("leads list failed:", error);
      return null;
    }),
  ]);

  return (
    <>
      <ObjectListView
        object="lead"
        lookups={lookups}
        initial={initial ? { key, ...initial } : undefined}
      />
      <LeadSlaLegend hours={slaHours} />
    </>
  );
}
