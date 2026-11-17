import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, normaliseConfig } from "../config";
import { cacheKey, cachedFetch, invalidateIndustryNewsCache } from "../client-cache";
import { decodeCursor, encodeCursor } from "../cursor";
import { parseFeed } from "../feeds";
import {
  applyFreshness,
  calculateWeight,
  capPerKeyword,
  collectMatches,
  matchesGroup,
  mergeNewsItem,
  sortNewsItems,
} from "../matching";
import type { IndustryNewsConfig, KeywordGroup, NewsItem, RawNewsItem } from "../types";

const group = (overrides: Partial<KeywordGroup> = {}): KeywordGroup => ({
  id: "g1",
  name: "Horticulture",
  words: [{ text: "horticulture", type: "contains" }],
  required: [],
  exclude: [],
  maxItems: 0,
  ...overrides,
});

const config = (overrides: Partial<IndustryNewsConfig> = {}): IndustryNewsConfig => ({
  ...createDefaultConfig(),
  keywords: [group()],
  globalExcludes: [],
  ...overrides,
});

describe("keyword matching (TrendRadar port)", () => {
  it("matches contains and case-insensitive regex words", () => {
    expect(matchesGroup("Global HORTICULTURE report", group(), [])).toBe(true);
    expect(
      matchesGroup("AI chips", group({ words: [{ text: "/ai\\s+chips/", type: "regex" }] }), [])
    ).toBe(true);
    expect(matchesGroup("AI chips", group({ words: [{ text: "/[bad/", type: "regex" }] }), [])).toBe(false);
  });

  it("applies global filter, then group excludes, required, and OR words", () => {
    expect(matchesGroup("震惊 horticulture", group(), ["震惊"])).toBe(false);
    expect(matchesGroup("horticulture scandal", group({ exclude: ["scandal"] }), [])).toBe(false);
    expect(
      matchesGroup("horticulture", group({ required: [" Brazil "], words: [{ text: "horticulture", type: "contains" }] }), [])
    ).toBe(false);
    expect(
      matchesGroup(
        "Brazil horticulture",
        group({
          required: ["brazil"],
          words: [
            { text: "flowers", type: "contains" },
            { text: "horticulture", type: "contains" },
          ],
        }),
        []
      )
    ).toBe(true);
  });

  it("matches everything when a group has no words and no required words", () => {
    expect(matchesGroup("anything at all", group({ words: [] }), [])).toBe(true);
  });

  it("collects several groups with their industry and region tags", () => {
    const result = collectMatches("Brazil horticulture", {
      ...config(),
      keywords: [
        group({ id: "a", name: "Plants", industry: "horticulture" }),
        group({ id: "b", name: "LatAm", words: [{ text: "brazil", type: "contains" }], region: "latinAmerica" }),
      ],
    });
    expect(result?.matchedKeywords).toEqual(["Plants", "LatAm"]);
    expect(result?.industries).toEqual(["horticulture"]);
    expect(result?.regions).toEqual(["latinAmerica"]);
    expect(collectMatches("unrelated", config())).toBeNull();
  });
});

describe("weight ranking", () => {
  it("uses the 0.6 / 0.3 / 0.1 TrendRadar formula", () => {
    expect(calculateWeight([1], 1, 5)).toBe(73);
    expect(calculateWeight([10], 1, 5)).toBe(9);
    expect(calculateWeight([], 5, 5)).toBe(0);
  });

  it("caps frequency at ten appearances", () => {
    expect(calculateWeight([1], 10, 5)).toBe(calculateWeight([1], 50, 5));
  });
});

describe("rank history merging", () => {
  const raw: RawNewsItem = {
    title: "New horticulture policy",
    url: "https://example.com/news/1",
    sourceId: "rss",
    sourceName: "Example",
    sourceType: "rss",
    rank: 3,
  };
  const match = { matchedKeywords: ["Horticulture"], industries: ["horticulture"], regions: [] };

  it("keeps previous ranks and marks a story as seen again", () => {
    const now = new Date("2026-11-16T10:30:00Z");
    const first = mergeNewsItem(undefined, raw, match, config(), now, "id-1");
    expect(first.isNew).toBe(true);
    expect(first.seenCount).toBe(1);
    expect(first.weight).toBe(calculateWeight([3], 1, 5));

    const second = mergeNewsItem(
      first,
      { ...raw, rank: 1 },
      match,
      config(),
      new Date("2026-11-16T11:30:00Z"),
      "ignored"
    );
    expect(second.id).toBe("id-1");
    expect(second.isNew).toBe(false);
    expect(second.ranks).toEqual([3, 1]);
    expect(second.rankTimeline).toHaveLength(2);
    expect(second.seenCount).toBe(2);
    expect(second.lastSeenAt).toBe("11:30");
  });
});

describe("RSS / Atom / JSON feed parsing", () => {
  const source = { id: "feed", name: "Feed", type: "rss" as const, enabled: true };

  it("parses RSS 2.0 with CDATA and strips HTML from the summary", () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title><![CDATA[Horticulture & gardens]]></title>
      <link>https://example.com/a</link>
      <pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    </item></channel></rss>`;
    const items = parseFeed(xml, source);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Horticulture & gardens");
    expect(items[0].summary).toBe("Hello world");
    expect(items[0].publishedAt).toBe("2026-11-16T10:00:00.000Z");
  });

  it("parses Atom links and JSON Feed items", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Greenhouses</title><link href="https://example.com/b"/>
      <updated>2026-11-16T09:00:00Z</updated><summary>Nursery news</summary>
    </entry></feed>`;
    expect(parseFeed(atom, source)[0].url).toBe("https://example.com/b");

    const jsonFeed = JSON.stringify({
      items: [{ title: "Plants", url: "https://example.com/c", date_published: "2026-11-16T08:00:00Z" }],
    });
    expect(parseFeed(jsonFeed, source)[0].title).toBe("Plants");
  });
});

describe("display helpers", () => {
  const item = (overrides: Partial<NewsItem> = {}): NewsItem => ({
    id: "x",
    title: "Story",
    url: "https://example.com",
    sourceId: "s",
    sourceName: "Source",
    sourceType: "hotlist",
    rank: 1,
    ranks: [1],
    rankTimeline: [],
    firstSeenAt: "10:00",
    lastSeenAt: "10:00",
    seenCount: 1,
    matchedKeywords: ["Horticulture"],
    industries: [],
    regions: [],
    isNew: false,
    weight: 50,
    fetchedAt: "2026-11-16T10:00:00.000Z",
    newsDate: "2026-11-16",
    ...overrides,
  });

  it("sorts by weight and caps per keyword", () => {
    const sorted = sortNewsItems([item({ title: "low", weight: 10 }), item({ title: "high", weight: 90 })], "keyword");
    expect(sorted[0].title).toBe("high");
    expect(capPerKeyword(sorted, 1)).toHaveLength(1);
  });

  it("drops stale items only when freshness is enabled", () => {
    const old = item({ fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(applyFreshness([old], 7, new Date("2026-11-16"))).toHaveLength(0);
    expect(applyFreshness([old], 0, new Date("2026-11-16"))).toHaveLength(1);
  });

  it("fills missing keys from the default config", () => {
    expect(normaliseConfig(null).keywords.length).toBeGreaterThan(0);
    expect(normaliseConfig({ reportMode: "daily" }).reportMode).toBe("daily");
    expect(normaliseConfig({ aiEnabled: true, aiLanguage: "es", aiMaxItemsPerRun: 99 })).toMatchObject({
      aiEnabled: true,
      aiLanguage: "es",
      aiMaxItemsPerRun: 20,
    });
  });

  it("round-trips a keyset cursor and rejects malformed values", () => {
    const current = item({ weight: 42.5, fetchedAt: "2026-11-16T10:00:00.000Z" });
    const cursor = encodeCursor(current);
    expect(decodeCursor(cursor)).toEqual({
      weight: 42.5,
      fetchedAt: "2026-11-16T10:00:00.000Z",
      id: current.id,
    });

    const encoded = (payload: unknown) => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const valid = "2026-11-16T10:00:00.000Z";
    expect(decodeCursor(encoded({ weight: "high", fetchedAt: valid, id: "x" }))).toBeNull();
    expect(decodeCursor(encoded({ weight: 1, fetchedAt: "not-a-date", id: "x" }))).toBeNull();
    expect(decodeCursor(encoded({ weight: 1, fetchedAt: valid, id: "" }))).toBeNull();
    expect(decodeCursor(encoded({ weight: 1, fetchedAt: valid }))).toBeNull();
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("builds stable cache keys from filters", () => {
    expect(cacheKey("user-1", "bootstrap", { b: "2", a: "1", empty: "", skipped: undefined })).toBe(
      "oboya:industry-news:user-1:bootstrap:a=1&b=2"
    );
  });
});

describe("read-only response cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    invalidateIndustryNewsCache();
  });

  afterEach(() => {
    invalidateIndustryNewsCache();
    vi.useRealTimers();
  });

  it("serves fresh values and reloads after the TTL expires", async () => {
    const key = cacheKey("cache-user", "bootstrap", { topic: "all" });
    const loader = vi.fn(async () => ({ count: 1 }));

    await expect(cachedFetch(key, 1_000, loader)).resolves.toEqual({ count: 1 });
    await expect(cachedFetch(key, 1_000, loader)).resolves.toEqual({ count: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await expect(cachedFetch(key, 1_000, loader)).resolves.toEqual({ count: 1 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent requests with the same key", async () => {
    const key = cacheKey("cache-user", "items", { cursor: "next" });
    let resolveLoader!: (value: { count: number }) => void;
    const loader = vi.fn(
      () => new Promise<{ count: number }>((resolve) => { resolveLoader = resolve; })
    );

    const first = cachedFetch(key, 10_000, loader);
    const second = cachedFetch(key, 10_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoader({ count: 2 });
    await expect(Promise.all([first, second])).resolves.toEqual([{ count: 2 }, { count: 2 }]);
  });

  it("drops cached entries when invalidated", async () => {
    const key = cacheKey("cache-user", "config", {});
    const loader = vi.fn(async () => ({ ok: true }));

    await cachedFetch(key, 60_000, loader);
    invalidateIndustryNewsCache();
    await cachedFetch(key, 60_000, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
