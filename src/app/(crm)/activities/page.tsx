import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ObjectListView } from "@/components/crm/list/ObjectListView";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { activityConfig } from "@/lib/crm/objects/activity";
import { listParamsKey, parseListQuery } from "@/lib/crm/objects/query";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activities");
  return { title: t("title") };
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user, can } = await requireCrmAuth();
  if (!can(activityConfig.module, "view")) return <AccessDenied />;

  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  ) as Record<string, string | undefined>;
  const key = listParamsKey(activityConfig, flat);
  const query = parseListQuery(activityConfig, new URLSearchParams(key));

  const [lookups, initial] = await Promise.all([
    loadLookups(supabase),
    list(supabase, activityConfig, query, { userId: user.id }).catch((error) => {
      console.error("activities list failed:", error);
      return null;
    }),
  ]);

  return (
    <ObjectListView
      object="activity"
      lookups={lookups}
      initial={initial ? { key, ...initial } : undefined}
    />
  );
}
