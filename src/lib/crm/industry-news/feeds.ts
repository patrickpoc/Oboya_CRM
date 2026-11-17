import type { NewsSource, RawNewsItem, SourceError } from "./types";

/** Server-side fetching for hot lists and RSS/Atom feeds (no API keys needed). */

const HOTLIST_API = "https://newsnow.busiyi.world/api/s";
const MAX_SUMMARY = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** TrendRadar's per-feed max_age_days; 0 means no limit. Undated items survive. */
function withinAge(item: RawNewsItem, maxAgeDays: number, now: number): boolean {
  if (maxAgeDays <= 0 || !item.publishedAt) return true;
  const time = Date.parse(item.publishedAt);
  return Number.isNaN(time) || time >= now - maxAgeDays * DAY_MS;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function tag(block: string, name: string): string {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "i").exec(block);
  return match ? decodeEntities(match[1]).trim() : "";
}

function linkOf(block: string): string {
  const direct = tag(block, "link");
  if (direct) return direct;
  const match = /<link\s[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  return match ? decodeEntities(match[1]) : "";
}

function stripHtml(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY);
}

function parseDate(value: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** JSON Feed allows `author` as a string or `{ name }`. */
function jsonFeedAuthor(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim().slice(0, 120) || undefined;
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name.trim().slice(0, 120) || undefined : undefined;
  }
  return undefined;
}

/** Minimal RSS 2.0 / Atom / JSON Feed reader; avoids a new dependency. */
export function parseFeed(xml: string, source: NewsSource): RawNewsItem[] {
  const isJson = /^\s*\{/.test(xml);
  if (isJson) {
    try {
      const doc = JSON.parse(xml) as { items?: Array<Record<string, unknown>> };
      return (doc.items ?? [])
        .map((item) => ({
          title: stripHtml(String(item.title ?? "")),
          url: String(item.url ?? item.id ?? ""),
          sourceId: source.id,
          sourceName: source.name,
          sourceType: "rss" as const,
          rank: 0,
          publishedAt: parseDate(String(item.date_published ?? "")),
          summary: stripHtml(String(item.content_text ?? item.summary ?? "")),
          author: jsonFeedAuthor(item.author),
        }))
        .filter((item) => item.title && item.url);
    } catch {
      return [];
    }
  }

  const blocks =
    xml.match(/<(?:[\w-]+:)?(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?(?:item|entry)>/gi) ?? [];
  return blocks
    .map((block) => {
      const published = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date");
      const creator = tag(block, "dc:creator") || tag(block, "author");
      return {
        title: stripHtml(tag(block, "title")),
        url: linkOf(block),
        sourceId: source.id,
        sourceName: source.name,
        sourceType: "rss" as const,
        rank: 0,
        publishedAt: parseDate(published),
        summary: stripHtml(tag(block, "description") || tag(block, "summary") || tag(block, "content")),
        author: creator ? stripHtml(creator).slice(0, 120) : undefined,
      };
    })
    .filter((item) => item.title && item.url);
}

function trustedUrl(raw: string, expectedDomain?: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (!expectedDomain) return true;
    const host = url.hostname.toLowerCase();
    const expected = expectedDomain.toLowerCase();
    return host === expected || host.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

async function fetchHotlist(source: NewsSource, signal?: AbortSignal): Promise<RawNewsItem[]> {
  const response = await fetch(
    `${HOTLIST_API}?id=${encodeURIComponent(source.id)}&latest`,
    { signal, headers: { "Accept-Language": "zh-CN", "User-Agent": "OboyaCRM/1.0" } }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    status?: string;
    items?: Array<{ title?: string; url?: string; mobileUrl?: string }>;
    data?: { items?: Array<{ title?: string; url?: string; mobileUrl?: string }> };
  };
  if (payload.status !== "success" && payload.status !== "cache") {
    throw new Error(`status ${payload.status ?? "unknown"}`);
  }
  const items = payload.items ?? payload.data?.items ?? [];
  return items
    .map((item, index) => ({
      title: stripHtml(item.title ?? ""),
      url: (item.url ?? item.mobileUrl ?? "").trim(),
      sourceId: source.id,
      sourceName: source.name,
      sourceType: "hotlist" as const,
      rank: index + 1,
    }))
    .filter((item) => item.title && trustedUrl(item.url, source.expectedDomain))
    .slice(0, source.maxItems ?? 50);
}

async function fetchRss(source: NewsSource, signal: AbortSignal | undefined, defaultMaxAgeDays: number): Promise<RawNewsItem[]> {
  if (!source.url) throw new Error("missing feed URL");
  const response = await fetch(source.url, {
    signal,
    headers: {
      Accept: "application/feed+json, application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "OboyaCRM/1.0",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const maxAgeDays = source.maxAgeDays ?? defaultMaxAgeDays;
  const now = Date.now();
  return parseFeed(await response.text(), source)
    .filter((item) => withinAge(item, maxAgeDays, now))
    .slice(0, source.maxItems ?? 30);
}

/** Per-source failures never stop the other sources from being ingested. */
export async function fetchSources(
  sources: NewsSource[],
  signal?: AbortSignal,
  defaultMaxAgeDays = 0
): Promise<{ items: RawNewsItem[]; errors: SourceError[] }> {
  const enabled = sources.filter((source) => source.enabled);
  const results = await Promise.allSettled(
    enabled.map((source) =>
      source.type === "rss"
        ? fetchRss(source, signal, defaultMaxAgeDays)
        : fetchHotlist(source, signal)
    )
  );
  const items: RawNewsItem[] = [];
  const errors: SourceError[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
      return;
    }
    const reason = result.reason as Error | undefined;
    errors.push({ sourceId: enabled[index].id, message: reason?.message ?? "fetch failed" });
  });
  return { items, errors };
}
