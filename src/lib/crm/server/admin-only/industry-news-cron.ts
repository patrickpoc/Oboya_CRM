import "server-only";

import { createDefaultConfig } from "@/lib/crm/industry-news/config";
import { ingestNews, loadStoredConfig } from "@/lib/crm/industry-news/server";
import { rowToConfig, type ConfigRow } from "@/lib/crm/industry-news/rows";
import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Cron has no user session. The service role reads/writes the global config,
 * and the hardened RPCs accept `service_role` for the global singleton only.
 */
export async function runIndustryNewsCron() {
  const service = createServiceClient();
  const supabase = service as unknown as CrmSupabaseClient;

  const stored = await loadStoredConfig(supabase, "");
  if (stored) return ingestNews(supabase, "", stored);

  const defaults = createDefaultConfig();
  const { data, error } = await service.rpc("crm_industry_news_ensure_global_config", {
    p_name: defaults.name,
    p_config: defaults,
  });
  if (error) throw error;
  return ingestNews(supabase, "", rowToConfig(data as ConfigRow));
}
