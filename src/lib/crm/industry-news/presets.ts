import type { KeywordGroup, NewsSource } from "./types";

/**
 * Default source catalogue. Hot lists come from the same public newsnow
 * endpoint used by TrendRadar; RSS feeds are the small industry-friendly set
 * from its config template. No API key is required for either.
 */
export const HOTLIST_PRESETS: ReadonlyArray<{
  id: string;
  name: string;
  expectedDomain: string;
}> = [
  { id: "toutiao", name: "今日头条", expectedDomain: "toutiao.com" },
  { id: "baidu", name: "百度热搜", expectedDomain: "baidu.com" },
  { id: "wallstreetcn-hot", name: "华尔街见闻", expectedDomain: "wallstreetcn.com" },
  { id: "thepaper", name: "澎湃新闻", expectedDomain: "thepaper.cn" },
  { id: "bilibili-hot-search", name: "哔哩哔哩", expectedDomain: "bilibili.com" },
  { id: "cls-hot", name: "财联社", expectedDomain: "cls.cn" },
  { id: "ifeng", name: "凤凰网", expectedDomain: "ifeng.com" },
  { id: "tieba", name: "百度贴吧", expectedDomain: "baidu.com" },
  { id: "weibo", name: "微博", expectedDomain: "weibo.com" },
  { id: "douyin", name: "抖音", expectedDomain: "douyin.com" },
  { id: "zhihu", name: "知乎", expectedDomain: "zhihu.com" },
];

export const RSS_PRESETS: ReadonlyArray<{ id: string; name: string; url: string }> = [
  { id: "hacker-news", name: "Hacker News", url: "https://hnrss.org/frontpage" },
  { id: "yahoo-finance", name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { id: "ruanyifeng", name: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/atom.xml" },
];

/** Selecting an industry in the UI creates/updates a keyword group. */
export const INDUSTRY_PRESETS: ReadonlyArray<{
  id: string;
  words: string[];
}> = [
  { id: "horticulture", words: ["horticulture", "nursery", "园艺", "苗木", "花卉", "gardening"] },
  { id: "agriculture", words: ["agriculture", "farming", "农业", "种植", "crop"] },
  { id: "gardenRetail", words: ["garden centre", "garden center", "retail", "园艺零售", "盆栽"] },
  { id: "landscape", words: ["landscaping", "landscape", "绿化", "景观"] },
  { id: "logistics", words: ["logistics", "shipping", "freight", "物流", "供应链"] },
  { id: "sustainability", words: ["sustainability", "carbon", "esg", "可持续", "环保"] },
];

/** Geographic groups mirror TrendRadar's regional keyword groups. */
export const REGION_PRESETS: ReadonlyArray<{
  id: string;
  words: string[];
}> = [
  { id: "global", words: [] },
  { id: "china", words: ["中国", "China", "国内"] },
  { id: "eastAsia", words: ["日本", "韩国", "Japan", "Korea", "东亚"] },
  { id: "europe", words: ["Europe", "欧盟", "荷兰", "德国", "欧洲"] },
  { id: "northAmerica", words: ["United States", "America", "美国", "加拿大", "北美"] },
  { id: "latinAmerica", words: ["Brazil", "巴西", "墨西哥", "拉美", "Latin America"] },
];

export function industryGroup(id: string): KeywordGroup | null {
  const preset = INDUSTRY_PRESETS.find((entry) => entry.id === id);
  if (!preset) return null;
  return {
    id: `industry:${preset.id}`,
    name: preset.id,
    words: preset.words.map((text) => ({ text, type: "contains" as const })),
    required: [],
    exclude: [],
    maxItems: 0,
    industry: preset.id,
  };
}

export function regionGroup(id: string): KeywordGroup | null {
  const preset = REGION_PRESETS.find((entry) => entry.id === id);
  if (!preset || preset.words.length === 0) return null;
  return {
    id: `region:${preset.id}`,
    name: preset.id,
    words: preset.words.map((text) => ({ text, type: "contains" as const })),
    required: [],
    exclude: [],
    maxItems: 0,
    region: preset.id,
  };
}

export function presetSource(id: string): NewsSource | null {
  const hotlist = HOTLIST_PRESETS.find((entry) => entry.id === id);
  if (hotlist) {
    return { ...hotlist, type: "hotlist", enabled: true };
  }
  const feed = RSS_PRESETS.find((entry) => entry.id === id);
  if (feed) {
    return { ...feed, type: "rss", enabled: true, maxAgeDays: 7, maxItems: 30 };
  }
  return null;
}
