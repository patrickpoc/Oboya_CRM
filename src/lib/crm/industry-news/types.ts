/**
 * Domain types for the Industry News module.
 *
 * The shape follows the Oboya CRM conventions (camelCase, explicit optional
 * fields) and ports the useful parts of TrendRadar: keyword groups with
 * required/excluded words, hot-list and RSS sources, report mode, rank history
 * and the weighted ranking model.
 */

export type KeywordType = "contains" | "regex";

export type KeywordWord = {
  text: string;
  type: KeywordType;
  alias?: string;
};

/** One monitored topic. Words are OR-ed; required words are AND-ed. */
export type KeywordGroup = {
  id: string;
  /** Display name of the group / tab. */
  name: string;
  alias?: string;
  words: KeywordWord[];
  required: string[];
  exclude: string[];
  /** 0 = unlimited. */
  maxItems: number;
  industry?: string;
  region?: string;
};

export type NewsSourceType = "hotlist" | "rss";

export type NewsSource = {
  id: string;
  name: string;
  type: NewsSourceType;
  /** RSS feed URL; hot lists use the shared newsnow endpoint. */
  url?: string;
  /** Defensive HTTPS host check for hot-list results. */
  expectedDomain?: string;
  enabled: boolean;
  maxAgeDays?: number;
  maxItems?: number;
};

export type ReportMode = "daily" | "current" | "incremental";
export type DisplayMode = "keyword" | "platform";
export type AiLanguage = "en" | "zh-CN" | "es" | "pt-BR";

/** Models are called with OpenAI-compatible chat/completions, no browser key. */
export type AiSettings = {
  aiEnabled: boolean;
  aiLanguage: AiLanguage;
  aiMaxItemsPerRun: number;
  aiInstructions: string;
};

/** Whole graphical configuration, stored as JSONB in crm_industry_news_configs. */
export type IndustryNewsConfig = {
  name: string;
  keywords: KeywordGroup[];
  globalExcludes: string[];
  industries: string[];
  regions: string[];
  sources: NewsSource[];
  reportMode: ReportMode;
  displayMode: DisplayMode;
  rankThreshold: number;
  maxNewsPerKeyword: number;
  freshnessDays: number;
  aiEnabled: boolean;
  aiLanguage: AiLanguage;
  aiMaxItemsPerRun: number;
  aiInstructions: string;
};

export type RankPoint = { time: string; rank: number | null };

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  sourceType: NewsSourceType;
  rank: number;
  ranks: number[];
  rankTimeline: RankPoint[];
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  publishedAt?: string;
  summary?: string;
  author?: string;
  matchedKeywords: string[];
  industries: string[];
  regions: string[];
  isNew: boolean;
  weight: number;
  fetchedAt: string;
  newsDate: string;
  aiTitle?: string;
  aiSummary?: string;
  aiLanguage?: AiLanguage;
  aiModel?: string;
  aiAnalyzedAt?: string;
};

/** Normalised result of a single source fetch, before keyword matching. */
export type RawNewsItem = {
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  sourceType: NewsSourceType;
  rank: number;
  publishedAt?: string;
  summary?: string;
  author?: string;
};

export type SourceError = { sourceId: string; message: string };
