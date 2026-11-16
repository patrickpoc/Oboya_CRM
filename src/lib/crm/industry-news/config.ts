import { HOTLIST_PRESETS, INDUSTRY_PRESETS, RSS_PRESETS, industryGroup } from "./presets";
import type { IndustryNewsConfig, KeywordGroup, NewsSource } from "./types";

/** A useful starting config: horticulture + a few Chinese hot lists and RSS. */
export function createDefaultConfig(): IndustryNewsConfig {
  const sources: NewsSource[] = [
    ...["toutiao", "baidu", "cls-hot", "zhihu"]
      .map((id) => HOTLIST_PRESETS.find((entry) => entry.id === id))
      .filter((entry): entry is (typeof HOTLIST_PRESETS)[number] => Boolean(entry))
      .map((entry) => ({ ...entry, type: "hotlist" as const, enabled: true })),
    ...RSS_PRESETS.slice(0, 1).map((entry) => ({
      ...entry,
      type: "rss" as const,
      enabled: true,
      maxAgeDays: 7,
      maxItems: 30,
    })),
  ];
  const keywords = INDUSTRY_PRESETS.slice(0, 1)
    .map((entry) => industryGroup(entry.id))
    .filter((entry): entry is KeywordGroup => Boolean(entry));

  return {
    name: "Industry news",
    keywords,
    globalExcludes: [],
    industries: INDUSTRY_PRESETS.slice(0, 1).map((entry) => entry.id),
    regions: [],
    sources,
    reportMode: "current",
    displayMode: "keyword",
    rankThreshold: 5,
    maxNewsPerKeyword: 0,
    freshnessDays: 7,
  };
}

/** Fills missing keys so an older stored JSONB config still renders safely. */
export function normaliseConfig(value: unknown): IndustryNewsConfig {
  const fallback = createDefaultConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Partial<IndustryNewsConfig>;
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : fallback.name,
    keywords: Array.isArray(raw.keywords) ? (raw.keywords as KeywordGroup[]) : fallback.keywords,
    globalExcludes: Array.isArray(raw.globalExcludes)
      ? (raw.globalExcludes as string[])
      : fallback.globalExcludes,
    industries: Array.isArray(raw.industries) ? (raw.industries as string[]) : fallback.industries,
    regions: Array.isArray(raw.regions) ? (raw.regions as string[]) : fallback.regions,
    sources: Array.isArray(raw.sources) ? (raw.sources as NewsSource[]) : fallback.sources,
    reportMode: raw.reportMode ?? fallback.reportMode,
    displayMode: raw.displayMode ?? fallback.displayMode,
    rankThreshold: typeof raw.rankThreshold === "number" ? raw.rankThreshold : fallback.rankThreshold,
    maxNewsPerKeyword:
      typeof raw.maxNewsPerKeyword === "number" ? raw.maxNewsPerKeyword : fallback.maxNewsPerKeyword,
    freshnessDays: typeof raw.freshnessDays === "number" ? raw.freshnessDays : fallback.freshnessDays,
  };
}
