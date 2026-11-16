import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { fetchSources } from "./feeds";
import {
  applyFreshness,
  capPerKeyword,
  collectMatches,
  mergeNewsItem,
  sortNewsItems,
} from "./matching";
import { newsItemToInsert, newsItemToUpdate, rawItemKey, rowToConfig, rowToNewsItem } from "./rows";
import type { ConfigRow, ItemRow, StoredConfig } from "./rows";
import type { IndustryNewsConfig, NewsItem } from "./types";

/** All queries use the user-scoped client, so RLS decides visibility. */

const CONFIG_COLUMNS = "id, owner_id, name, config, updated_at";
const ITEM_COLUMNS =
  "id, title, url, source_id, source_name, source_type, rank, ranks, rank_timeline, first_seen_at, last_seen_at, seen_count, published_at, summary, author, matched_keywords, industries, regions, is_new, weight, fetched_at, news_date";

export async function loadStoredConfig(
  supabase: CrmSupabaseClient,
  userId: string
): Promise<StoredConfig | null> {
  const { data, error } = await supabase
    .from("crm_industry_news_configs")
    .select(CONFIG_COLUMNS)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToConfig(data as ConfigRow) : null;
}

export async function saveStoredConfig(
  supabase: CrmSupabaseClient,
  userId: string,
  name: string,
  config: IndustryNewsConfig
): Promise<StoredConfig> {
  const existing = await loadStoredConfig(supabase, userId);
  if (existing) {
    const { data, error } = await supabase
      .from("crm_industry_news_configs")
      .update({ name, config })
      .eq("id", existing.id)
      .select(CONFIG_COLUMNS)
      .single();
    if (error) throw error;
    return rowToConfig(data as ConfigRow);
  }
  const { data, error } = await supabase
    .from("crm_industry_news_configs")
    .insert({ owner_id: userId, name, config, created_by: userId })
    .select(CONFIG_COLUMNS)
    .single();
  if (error) throw error;
  return rowToConfig(data as ConfigRow);
}

export type NewsQuery = {
  keyword?: string;
  source?: string;
  industry?: string;
  region?: string;
  search?: string;
  from?: string;
  to?: string;
  limit: number;
};

export async function listNewsItems(
  supabase: CrmSupabaseClient,
  stored: StoredConfig,
  query: NewsQuery
): Promise<NewsItem[]> {
  let builder = supabase
    .from("crm_industry_news_items")
    .select(ITEM_COLUMNS)
    .eq("config_id", stored.id)
    .is("deleted_at", null)
    .order("weight", { ascending: false })
    .order("fetched_at", { ascending: false })
    .limit(query.limit);
  if (query.keyword) builder = builder.contains("matched_keywords", [query.keyword]);
  if (query.source) builder = builder.eq("source_id", query.source);
  if (query.industry) builder = builder.contains("industries", [query.industry]);
  if (query.region) builder = builder.contains("regions", [query.region]);
  if (query.search) builder = builder.ilike("title", `%${query.search}%`);
  if (query.from) builder = builder.gte("news_date", query.from);
  if (query.to) builder = builder.lte("news_date", query.to);
  const { data, error } = await builder;
  if (error) throw error;

  const config = stored.config;
  let items = (data ?? []).map((row) => rowToNewsItem(row as ItemRow));
  if (config.reportMode === "daily") {
    const today = new Date().toISOString().slice(0, 10);
    items = items.filter((item) => item.newsDate === today);
  } else if (config.reportMode === "incremental") {
    items = items.filter((item) => item.isNew);
  }
  return capPerKeyword(
    sortNewsItems(applyFreshness(items, config.freshnessDays), config.displayMode),
    config.maxNewsPerKeyword
  );
}

export type IngestResult = {
  fetched: number;
  added: number;
  updated: number;
  matched: number;
  errors: Array<{ sourceId: string; message: string }>;
};

/** Fetch, match, merge and persist. Only the user's own config and rows are touched. */
export async function ingestNews(
  supabase: CrmSupabaseClient,
  userId: string,
  stored: StoredConfig
): Promise<IngestResult> {
  const config = stored.config;
  const { items: rawItems, errors } = await fetchSources(config.sources);
  const result: IngestResult = { fetched: rawItems.length, added: 0, updated: 0, matched: 0, errors };

  const { data: existingRows, error: existingError } = await supabase
    .from("crm_industry_news_items")
    .select(ITEM_COLUMNS)
    .eq("config_id", stored.id)
    .is("deleted_at", null)
    .order("fetched_at", { ascending: false })
    .limit(2000);
  if (existingError) throw existingError;

  const existing = new Map<string, NewsItem>();
  for (const row of (existingRows ?? []) as ItemRow[]) {
    const item = rowToNewsItem(row);
    const key = `${item.sourceId}::${item.url}`;
    if (!existing.has(key)) existing.set(key, item);
  }

  const now = new Date();
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    const key = rawItemKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    const match =
      config.keywords.length === 0
        ? { matchedKeywords: ["all"], industries: [] as string[], regions: [] as string[] }
        : collectMatches(raw.title, config);
    if (!match) continue;
    result.matched += 1;

    const previous = existing.get(key);
    const item = mergeNewsItem(previous, raw, match, config, now, crypto.randomUUID());
    if (previous) updates.push({ id: previous.id, values: newsItemToUpdate(item) });
    else inserts.push(newsItemToInsert(item, stored.id, userId));
  }

  result.added = inserts.length;
  result.updated = updates.length;

  for (let index = 0; index < inserts.length; index += 100) {
    const chunk = inserts.slice(index, index + 100);
    const { error } = await supabase.from("crm_industry_news_items").insert(chunk);
    if (error) throw error;
  }
  await Promise.all(
    updates.map(async (update) => {
      const { error } = await supabase
        .from("crm_industry_news_items")
        .update(update.values)
        .eq("id", update.id);
      if (error) throw error;
    })
  );

  return result;
}
