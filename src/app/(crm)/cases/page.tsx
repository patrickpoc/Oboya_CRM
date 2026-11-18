import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CaseReportBar } from "@/components/crm/cases/CaseReportBar";
import { ObjectListView } from "@/components/crm/list/ObjectListView";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { caseConfig } from "@/lib/crm/objects/case";
import { listParamsKey, parseListQuery } from "@/lib/crm/objects/query";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cases");
  return { title: t("title") };
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user, can } = await requireCrmAuth();
  if (!can(caseConfig.module, "view")) return <AccessDenied />;

  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  ) as Record<string, string | undefined>;
  const key = listParamsKey(caseConfig, flat);
  const query = parseListQuery(caseConfig, new URLSearchParams(key));

  // Record pages link here with ?create=1&accountId=… or &contactId=… to open
  // the create drawer with the relationship prefilled.
  const createDefaults: Record<string, unknown> | undefined =
    flat.create === "1"
      ? {
          ...(flat.accountId ? { account_id: flat.accountId } : {}),
          ...(flat.contactId ? { contact_id: flat.contactId } : {}),
        }
      : undefined;

  const [lookups, initial] = await Promise.all([
    loadLookups(supabase),
    list(supabase, caseConfig, query, { userId: user.id }).catch((error) => {
      console.error("cases list failed:", error);
      return null;
    }),
  ]);

  return (
    <ObjectListView
      object="case"
      lookups={lookups}
      initial={initial ? { key, ...initial } : undefined}
      toolbar={<CaseReportBar />}
      createDefaults={createDefaults}
    />
  );
}
