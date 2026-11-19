import type {
  IndustryNewsConfig,
  KeywordGroup,
  NewsItem,
  RankPoint,
  RawNewsItem,
} from "./types";

/** Match and ranking logic ported from TrendRadar's core/frequency.py + analyzer.py. */

const lower = (value: string) => value.trim().toLowerCase();

/** TrendRadar writes regex words as `/pattern/`; accept a bare pattern too. */
function regexSource(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2
    ? trimmed.slice(1, -1)
    : trimmed;
}

export function compileKeywordRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(regexSource(pattern), "i");
  } catch {
    // A bad regex from the editor must not break the whole ingest.
    return null;
  }
}

function containsWord(text: string, word: string): boolean {
  const trimmed = word.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) {
    const regex = compileKeywordRegex(trimmed);
    return regex ? regex.test(text) : false;
  }
  return text.includes(lower(trimmed));
}

/** Global filter -> group excludes -> required (all) -> normal words (any). */
export function matchesGroup(title: string, group: KeywordGroup, globalExcludes: string[]): boolean {
  const text = lower(title);
  if (globalExcludes.some((word) => containsWord(text, word))) return false;
  if (group.exclude.some((word) => containsWord(text, word))) return false;
  if (group.required.length > 0 && !group.required.every((word) => containsWord(text, word))) {
    return false;
  }
  if (group.words.length === 0) return true;
  return group.words.some((word) =>
    word.type === "regex" ? Boolean(compileKeywordRegex(word.text)?.test(text)) : containsWord(text, word.text)
  );
}

export type MatchResult = {
  matchedKeywords: string[];
  industries: string[];
  regions: string[];
};

/** A title can belong to several groups; each contributes its tab and tags. */
export function collectMatches(title: string, config: IndustryNewsConfig): MatchResult | null {
  const matched = config.keywords.filter((group) => matchesGroup(title, group, config.globalExcludes));
  if (matched.length === 0) return null;
  const unique = <T>(values: T[]) => [...new Set(values)];
  return {
    matchedKeywords: unique(matched.map((group) => group.alias || group.name)),
    industries: unique(
      matched.map((group) => group.industry).filter((value): value is string => Boolean(value))
    ),
    regions: unique(
      matched.map((group) => group.region).filter((value): value is string => Boolean(value))
    ),
  };
}

/**
 * TrendRadar weights: rank 0.6, frequency 0.3, hotness 0.1.
 * Rank 1 scores 10 and rank >= 10 scores 1; count saturates at 10.
 */
export function calculateWeight(
  ranks: number[],
  seenCount: number,
  rankThreshold: number
): number {
  if (ranks.length === 0) return 0;
  const rankScore = (ranks.reduce((sum, rank) => sum + 11 - Math.min(Math.max(rank, 1), 10), 0) / ranks.length) * 10;
  const frequencyScore = Math.min(seenCount, 10) * 10;
  const hotnessScore = (ranks.filter((rank) => rank > 0 && rank <= rankThreshold).length / ranks.length) * 100;
  const total = rankScore * 0.6 + frequencyScore * 0.3 + hotnessScore * 0.1;
  return Math.round(total * 10) / 10;
}

/** Merge a fresh fetch into an existing story, keeping its rank history. */
export function mergeNewsItem(
  previous: NewsItem | undefined,
  raw: RawNewsItem,
  match: MatchResult,
  config: IndustryNewsConfig,
  now: Date,
  id: string
): NewsItem {
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const ranks = [...(previous?.ranks ?? []), raw.rank].slice(-100);
  const point: RankPoint = { time: hhmm, rank: raw.rank > 0 ? raw.rank : null };
  const rankTimeline = [...(previous?.rankTimeline ?? []), point].slice(-100);
  const seenCount = (previous?.seenCount ?? 0) + 1;
  return {
    id: previous?.id ?? id,
    title: raw.title,
    url: raw.url,
    sourceId: raw.sourceId,
    sourceName: raw.sourceName,
    sourceType: raw.sourceType,
    rank: raw.rank,
    ranks,
    rankTimeline,
    firstSeenAt: previous?.firstSeenAt ?? hhmm,
    lastSeenAt: hhmm,
    seenCount,
    publishedAt: raw.publishedAt ?? previous?.publishedAt,
    summary: raw.summary ?? previous?.summary,
    author: raw.author ?? previous?.author,
    matchedKeywords: match.matchedKeywords,
    industries: match.industries,
    regions: match.regions,
    isNew: !previous,
    weight: calculateWeight(ranks.filter((rank) => rank > 0), seenCount, config.rankThreshold),
    fetchedAt: now.toISOString(),
    newsDate: now.toISOString().slice(0, 10),
  };
}

/** Freshness is applied at display time, not ingest time (TrendRadar behaviour). */
export function applyFreshness(items: NewsItem[], days: number, now = new Date()): NewsItem[] {
  if (days <= 0) return items;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const stamp = item.publishedAt ?? item.fetchedAt;
    const time = Date.parse(stamp);
    return Number.isNaN(time) || time >= cutoff;
  });
}

export function sortNewsItems(items: NewsItem[], mode: IndustryNewsConfig["displayMode"]): NewsItem[] {
  return [...items].sort((a, b) => {
    if (mode === "platform" && a.sourceName !== b.sourceName) {
      return a.sourceName.localeCompare(b.sourceName);
    }
    return b.weight - a.weight || b.seenCount - a.seenCount || a.title.localeCompare(b.title);
  });
}

/** Applies the per-group cap while preserving the incoming (weighted) order. */
export function capPerKeyword(items: NewsItem[], max: number): NewsItem[] {
  if (max <= 0) return items;
  const counts = new Map<string, number>();
  return items.filter((item) => {
    const key = item.matchedKeywords[0] ?? "";
    const count = counts.get(key) ?? 0;
    if (count >= max) return false;
    counts.set(key, count + 1);
    return true;
  });
}
