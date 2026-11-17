import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { analysePending, type AiRunResult } from "./ai";
import { createDefaultConfig } from "./config";
import { decodeCursor, encodeCursor } from "./cursor";
import { fetchSources } from "./feeds";
import { capPerKeyword, collectMatches, mergeNewsItem, sortNewsItems } from "./matching";
import {
  newsItemToInsert,
  newsItemToUpdate,
  rawItemKey,
  recentRowToNewsItem,
  rowToConfig,
  rowToNewsItem,
  type ConfigRow,
  type ItemRow,
  type RecentItemRow,
  type StoredConfig,
} from "./rows";
import type { IndustryNewsConfig, NewsItem } from "./types";

/**
 * All queries use the user-scoped client, so RLS decides visibility.
 * Reads/writes are consolidated in SQL RPCs: one bootstrap call for the
 * initial screen, one call for ingest + retention, one call for config save.
 */

const CONFIG_COLUMNS = "id, owner_id, name, config, updated_at";
const INGEST_COLUMNS =
  "id, source_id, url, ranks, rank_timeline, seen_count, first_seen_at, published_at, summary, author, news_date";

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

/** One upsert call replaces the old read-then-insert/update pair. */
export async function saveStoredConfig(
  supabase: CrmSupabaseClient,
  _userId: string,
  name: string,
  config: IndustryNewsConfig
): Promise<StoredConfig> {
  const { data, error } = await supabase.rpc("crm_industry_news_save_config", {
    p_name: name,
    p_config: config,
  });
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
  cursor?: string;
  limit: number;
};

export type NewsPage = { items: NewsItem[]; nextCursor: string | null };

type RpcCursor = {
  p_cursor_weight: number | null;
  p_cursor_fetched_at: string | null;
  p_cursor_id: string | null;
};

function cursorArgs(value: string | undefined | null): RpcCursor {
  const cursor = decodeCursor(value);
  return {
    p_cursor_weight: cursor?.weight ?? null,
    p_cursor_fetched_at: cursor?.fetchedAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  };
}

function filters(query: NewsQuery) {
  return {
    p_keyword: query.keyword || null,
    p_source: query.source || null,
    p_industry: query.industry || null,
    p_region: query.region || null,
    p_search: query.search || null,
    p_from: query.from || null,
    p_to: query.to || null,
    p_today: new Date().toISOString().slice(0, 10),
  };
}

function shapePage(rows: ItemRow[], limit: number, config: IndustryNewsConfig): NewsPage {
  const decoded = rows.map(rowToNewsItem);
  const nextCursor = decoded.length === limit ? encodeCursor(decoded[decoded.length - 1]) : null;
  const sorted = sortNewsItems(decoded, config.displayMode);
  return { items: capPerKeyword(sorted, config.maxNewsPerKeyword), nextCursor };
}

/** Keyset page through a deferred-join RPC; no OFFSET and no wide row scan. */
export async function listNewsItems(
  supabase: CrmSupabaseClient,
  configId: string,
  query: NewsQuery
): Promise<NewsPage> {
  const { data, error } = await supabase.rpc("crm_industry_news_page", {
    p_config_id: configId,
    p_limit: query.limit,
    ...cursorArgs(query.cursor),
    ...filters(query),
  });
  if (error) throw error;
  const items = ((data ?? []) as ItemRow[]).map(rowToNewsItem);
  return {
    items,
    nextCursor: items.length === query.limit ? encodeCursor(items[items.length - 1]) : null,
  };
}

export type BootstrapResult = {
  configId: string;
  config: IndustryNewsConfig;
  name: string;
  saved: boolean;
  updatedAt: string | null;
  items: NewsItem[];
  nextCursor: string | null;
};

/** Config + first page in one database call, used on page load. */
export async function bootstrapIndustryNews(
  supabase: CrmSupabaseClient,
  query: NewsQuery
): Promise<BootstrapResult> {
  const { data, error } = await supabase.rpc("crm_industry_news_bootstrap", {
    p_limit: query.limit,
    ...cursorArgs(query.cursor),
    ...filters(query),
  });
  if (error) throw error;

  const payload = data as {
    configId?: string | null;
    config: unknown;
    name: string;
    saved: boolean;
    updatedAt: string | null;
    items: ItemRow[];
  } | null;
  if (!payload?.saved) {
    const config = createDefaultConfig();
    return { configId: "", config, name: config.name, saved: false, updatedAt: null, items: [], nextCursor: null };
  }
  const config = rowToConfig({ id: "", owner_id: "", name: payload.name, config: payload.config, updated_at: payload.updatedAt ?? "" }).config;
  const page = shapePage((payload.items ?? []) as ItemRow[], query.limit, config);
  return {
    configId: payload.configId ?? "",
    config,
    name: payload.name,
    saved: true,
    updatedAt: payload.updatedAt,
    items: page.items,
    nextCursor: page.nextCursor,
  };
}

export type IngestResult = {
  fetched: number;
  added: number;
  updated: number;
  matched: number;
  purged: number;
  errors: Array<{ sourceId: string; message: string }>;
  ai: AiRunResult;
};

/** Fetch, match, merge, batch-persist, clean up and optionally run AI. */
export async function ingestNews(
  supabase: CrmSupabaseClient,
  _userId: string,
  stored: StoredConfig
): Promise<IngestResult> {
  const config = stored.config;
  const { items: rawItems, errors } = await fetchSources(config.sources, AbortSignal.timeout(30_000));
  const result: IngestResult = {
    fetched: rawItems.length,
    added: 0,
    updated: 0,
    matched: 0,
    purged: 0,
    errors,
    ai: { status: "off", analyzed: 0, failed: 0 },
  };

  const { data: existingRows, error: existingError } = await supabase
    .from("crm_industry_news_items")
    .select(INGEST_COLUMNS)
    .eq("config_id", stored.id)
    .is("deleted_at", null)
    .order("fetched_at", { ascending: false })
    .limit(2000);
  if (existingError) throw existingError;

  const existing = new Map<string, NewsItem>();
  for (const row of (existingRows ?? []) as RecentItemRow[]) {
    const item = recentRowToNewsItem(row);
    if (!existing.has(`${item.sourceId}::${item.url}`)) existing.set(`${item.sourceId}::${item.url}`, item);
  }

  const now = new Date();
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<Record<string, unknown>> = [];
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
    if (previous) updates.push({ id: previous.id, ...newsItemToUpdate(item) });
    else inserts.push(newsItemToInsert(item, stored.id, _userId));
  }

  // One DB round trip for all inserts, all updates and the 30-day purge.
  const { data: written, error: writeError } = await supabase.rpc("crm_industry_news_ingest", {
    p_config_id: stored.id,
    p_inserts: inserts,
    p_updates: updates,
  });
  if (writeError) throw writeError;
  const counts = (written ?? {}) as { added?: number; updated?: number; purged?: number };
  result.added = Number(counts.added ?? inserts.length);
  result.updated = Number(counts.updated ?? updates.length);
  result.purged = Number(counts.purged ?? 0);

  result.ai = await analysePending(supabase, stored);
  return result;
}
