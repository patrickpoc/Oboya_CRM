import { normaliseConfig } from "./config";
import type { IndustryNewsConfig, NewsItem, RankPoint, RawNewsItem } from "./types";

/** Mapping between snake_case PostgREST rows and the camelCase domain types. */

export type ConfigRow = {
  id: string;
  owner_id: string;
  name: string;
  config: unknown;
  updated_at: string;
};

export type StoredConfig = {
  id: string;
  name: string;
  config: IndustryNewsConfig;
  updatedAt: string;
};

export function rowToConfig(row: ConfigRow): StoredConfig {
  return {
    id: row.id,
    name: row.name,
    config: normaliseConfig(row.config),
    updatedAt: row.updated_at,
  };
}

export type ItemRow = {
  id: string;
  title: string;
  url: string;
  source_id: string;
  source_name: string;
  source_type: "hotlist" | "rss";
  rank: number;
  ranks: unknown;
  rank_timeline: unknown;
  first_seen_at: string | null;
  last_seen_at: string | null;
  seen_count: number;
  published_at: string | null;
  summary: string | null;
  author: string | null;
  matched_keywords: unknown;
  industries: unknown;
  regions: unknown;
  is_new: boolean;
  weight: number | string;
  fetched_at: string;
  news_date: string;
  ai_title: string | null;
  ai_summary: string | null;
  ai_language: "en" | "zh-CN" | "es" | "pt-BR" | null;
  ai_model: string | null;
  ai_analyzed_at: string | null;
};

const arrayOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function rowToNewsItem(row: ItemRow): NewsItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceType: row.source_type,
    rank: row.rank,
    ranks: arrayOf<number>(row.ranks),
    rankTimeline: arrayOf<RankPoint>(row.rank_timeline),
    firstSeenAt: row.first_seen_at ?? "",
    lastSeenAt: row.last_seen_at ?? "",
    seenCount: row.seen_count,
    publishedAt: row.published_at ?? undefined,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    matchedKeywords: arrayOf<string>(row.matched_keywords),
    industries: arrayOf<string>(row.industries),
    regions: arrayOf<string>(row.regions),
    isNew: row.is_new,
    weight: Number(row.weight),
    fetchedAt: row.fetched_at,
    newsDate: row.news_date,
    aiTitle: row.ai_title ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    aiLanguage: row.ai_language ?? undefined,
    aiModel: row.ai_model ?? undefined,
    aiAnalyzedAt: row.ai_analyzed_at ?? undefined,
  };
}

/** Narrow projection used by ingest to merge rank history without reading wide rows. */
export type RecentItemRow = Pick<
  ItemRow,
  | "id"
  | "source_id"
  | "url"
  | "ranks"
  | "rank_timeline"
  | "seen_count"
  | "first_seen_at"
  | "published_at"
  | "summary"
  | "author"
  | "news_date"
>;

export function recentRowToNewsItem(row: RecentItemRow): NewsItem {
  return {
    id: row.id,
    title: "",
    url: row.url,
    sourceId: row.source_id,
    sourceName: "",
    sourceType: "rss",
    rank: 0,
    ranks: arrayOf<number>(row.ranks),
    rankTimeline: arrayOf<RankPoint>(row.rank_timeline),
    firstSeenAt: row.first_seen_at ?? "",
    lastSeenAt: row.first_seen_at ?? "",
    seenCount: row.seen_count,
    publishedAt: row.published_at ?? undefined,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    matchedKeywords: [],
    industries: [],
    regions: [],
    isNew: false,
    weight: 0,
    fetchedAt: row.first_seen_at ?? "",
    newsDate: row.news_date,
  };
}

function toRow(item: NewsItem, configId: string, userId: string) {
  return {
    title: item.title,
    url: item.url,
    source_id: item.sourceId,
    source_name: item.sourceName,
    source_type: item.sourceType,
    rank: item.rank,
    ranks: item.ranks,
    rank_timeline: item.rankTimeline,
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    seen_count: item.seenCount,
    published_at: item.publishedAt ?? null,
    summary: item.summary ?? null,
    author: item.author ?? null,
    matched_keywords: item.matchedKeywords,
    industries: item.industries,
    regions: item.regions,
    is_new: item.isNew,
    weight: item.weight,
    fetched_at: item.fetchedAt,
    news_date: item.newsDate,
    owner_id: userId,
    config_id: configId,
    created_by: userId,
  };
}

export function newsItemToInsert(item: NewsItem, configId: string, userId: string) {
  return toRow(item, configId, userId);
}

export function newsItemToUpdate(item: NewsItem) {
  return {
    rank: item.rank,
    ranks: item.ranks,
    rank_timeline: item.rankTimeline,
    last_seen_at: item.lastSeenAt,
    seen_count: item.seenCount,
    published_at: item.publishedAt ?? null,
    summary: item.summary ?? null,
    matched_keywords: item.matchedKeywords,
    industries: item.industries,
    regions: item.regions,
    is_new: item.isNew,
    weight: item.weight,
    fetched_at: item.fetchedAt,
    news_date: item.newsDate,
  };
}

export function rawItemKey(raw: RawNewsItem): string {
  return `${raw.sourceId}::${raw.url}`;
}
