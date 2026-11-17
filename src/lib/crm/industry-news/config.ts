import type { IndustryNewsConfig, KeywordGroup, NewsSource } from "./types";
import { createTrendRadarConfig } from "./trendradar-preset";

/**
 * First-run default: the preconfigured Oboya TrendRadar source/keyword set,
 * so Insights News is useful without any manual setup.
 */
export function createDefaultConfig(): IndustryNewsConfig {
  return createTrendRadarConfig();
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
    aiEnabled: typeof raw.aiEnabled === "boolean" ? raw.aiEnabled : fallback.aiEnabled,
    aiLanguage: ["en", "zh-CN", "es", "pt-BR"].includes(raw.aiLanguage ?? "")
      ? (raw.aiLanguage as IndustryNewsConfig["aiLanguage"])
      : fallback.aiLanguage,
    aiMaxItemsPerRun:
      typeof raw.aiMaxItemsPerRun === "number"
        ? Math.min(20, Math.max(1, Math.round(raw.aiMaxItemsPerRun)))
        : fallback.aiMaxItemsPerRun,
    aiInstructions: typeof raw.aiInstructions === "string" ? raw.aiInstructions.slice(0, 400) : "",
  };
}
