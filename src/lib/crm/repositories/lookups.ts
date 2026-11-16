import "server-only";

import { cache } from "react";
import type { CrmSupabaseClient } from "@/lib/supabase/server";
import type { Option, RecordLookups, StageOption, UserOption } from "@/lib/crm/objects/types";
import { parseSlaHours, type SlaHours } from "@/lib/crm/leads/sla";

/**
 * Option lists shared by record pages, list views and the API. Read with the
 * user-scoped client (RLS: active users read config tables) and deduplicated
 * per request with React `cache` (the client is the same object per request).
 */

export const getPicklists = cache(async (client: CrmSupabaseClient): Promise<Record<string, Option[]>> => {
  const { data, error } = await client
    .from("crm_picklist_values")
    .select("picklist, value, label")
    .eq("active", true)
    .order("sort_order")
    .order("label");
  if (error) {
    console.error("picklists read failed:", error.code);
    return {};
  }
  const out: Record<string, Option[]> = {};
  for (const row of (data ?? []) as Array<{ picklist: string; value: string; label: string }>) {
    (out[row.picklist] ??= []).push({ value: row.value, label: row.label });
  }
  return out;
});

export const getUsers = cache(async (client: CrmSupabaseClient): Promise<UserOption[]> => {
  const { data, error } = await client
    .from("crm_users")
    .select("id, full_name, email, status")
    .order("full_name");
  if (error) {
    console.error("users read failed:", error.code);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; full_name: string; email: string; status: string }>).map((u) => ({
    value: u.id,
    label: u.full_name || u.email,
    active: u.status === "active",
  }));
});

export const getEntities = cache(async (client: CrmSupabaseClient): Promise<Option[]> => {
  const { data, error } = await client
    .from("crm_entities")
    .select("id, name")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) {
    console.error("entities read failed:", error.code);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; name: string }>).map((e) => ({ value: e.id, label: e.name }));
});

/** Active stages of the default pipeline, in order. */
export const getStages = cache(async (client: CrmSupabaseClient): Promise<StageOption[]> => {
  const { data, error } = await client
    .from("crm_pipeline_stages")
    .select("id, label, kind, probability, color_token, crm_pipelines!inner(is_default)")
    .eq("active", true)
    .eq("crm_pipelines.is_default", true)
    .order("sort_order");
  if (error) {
    console.error("stages read failed:", error.code);
    return [];
  }
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      label: string;
      kind: StageOption["kind"];
      probability: number;
      color_token: string | null;
    }>
  ).map((s) => ({
    value: s.id,
    label: s.label,
    kind: s.kind,
    probability: s.probability,
    color: s.color_token,
  }));
});

/** crm_settings.lead_sla_hours (defaults 24/48 when missing or invalid). */
export const getLeadSlaHours = cache(async (client: CrmSupabaseClient): Promise<SlaHours> => {
  const { data, error } = await client.from("crm_settings").select("value").eq("key", "lead_sla_hours").maybeSingle();
  if (error) console.error("lead sla setting read failed:", error.code);
  return parseSlaHours((data as { value?: unknown } | null)?.value);
});

/** Everything a record page or list view needs, serializable for client components. */
export const loadLookups = cache(async (client: CrmSupabaseClient): Promise<RecordLookups> => {
  const [picklists, users, entities, stages] = await Promise.all([
    getPicklists(client),
    getUsers(client),
    getEntities(client),
    getStages(client),
  ]);
  return { picklists, users, entities, stages };
});
