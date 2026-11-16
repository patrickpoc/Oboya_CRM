import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ObjectListView } from "@/components/crm/list/ObjectListView";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { OpportunityViewToggle } from "@/components/crm/pipeline/OpportunityViewToggle";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import { listParamsKey, parseListQuery } from "@/lib/crm/objects/query";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

export default async function OpportunitiesPage({
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
  const key = listParamsKey(opportunityConfig, flat);
  const query = parseListQuery(opportunityConfig, new URLSearchParams(key));

  const [lookups, initial] = await Promise.all([
    loadLookups(supabase),
    list(supabase, opportunityConfig, query, { userId: user.id }).catch((error) => {
      console.error("opportunities list failed:", error);
      return null;
    }),
  ]);

  return (
    <ObjectListView
      object="opportunity"
      lookups={lookups}
      initial={initial ? { key, ...initial } : undefined}
      headerActions={<OpportunityViewToggle current="list" />}
    />
  );
}
