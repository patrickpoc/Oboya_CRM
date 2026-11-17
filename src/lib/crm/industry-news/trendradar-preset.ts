import { HOTLIST_PRESETS } from "./presets";
import type { IndustryNewsConfig, KeywordGroup, NewsSource } from "./types";

/**
 * Preset mirrored from the Oboya TrendRadar server config:
 * config/config.yaml (sources/report) + config/frequency_words.txt (keywords).
 * Webhook URLs, AI API keys and private/local model endpoints are deliberately
 * NOT copied; AI stays off until a server-side CRM_AI_API_KEY is configured.
 */

type PresetKeywordGroup = {
  id: string;
  name: string;
  sourceName: string;
  pattern: string;
  industry?: string;
  region?: string;
};

export const TRENDRADAR_KEYWORD_GROUPS: ReadonlyArray<PresetKeywordGroup> = [
  {
    id: "trade-news",
    name: "国际贸易",
    sourceName: "国际贸易·要闻",
    pattern: "中欧班列|贸易战|贸易摩擦|关税战|加征关税|反倾销|反补贴|贸易救济|出口管制|实体清单|原产地|贸易顺差|贸易逆差|进出口|跨境电商|海运费|集运指数|运价|关税|外贸|世贸组织|贸易协定|自由贸易协定|自贸协定|\\btariffs?\\b|\\btrade wars?\\b|\\btrade friction\\b|\\bdumping\\b|\\bexport controls?\\b|\\btrade deals?\\b|\\btrade agreements?\\b|\\btrade surplus\\b|\\btrade deficit\\b|\\bWTO\\b|\\bcustoms\\b|\\bsanctions?\\b",
  },
  {
    id: "trade-europe",
    name: "欧洲贸易",
    sourceName: "国际贸易·欧洲",
    pattern: "(?=.*(?<![a-zA-Z])(欧盟|欧洲|布鲁塞尔|欧委会|\\bEU\\b|\\bEurope\\b|\\bEuropean\\b|\\bEurozone\\b|\\bBrussels\\b))(?=.*(关税|贸易|出口|进口|反倾销|反补贴|制裁|海关|协定|配额|谈判|调查|\\btariffs?\\b|\\btrades?\\b|\\btrading\\b|\\bexports?\\b|\\bimports?\\b|\\bsanctions?\\b|\\bcustoms\\b|\\bquota\\b|\\bdeals?\\b|\\bdumping\\b)).*",
    region: "europe",
  },
  {
    id: "trade-us",
    name: "美国贸易",
    sourceName: "国际贸易·美国",
    pattern: "(?=.*(?<![a-zA-Z])(美国|美方|华盛顿|\\bUS\\b|\\bU\\.S\\b|\\bUnited States\\b|\\bWashington\\b))(?=.*(关税|贸易|出口|进口|反倾销|制裁|实体清单|海关|协定|配额|调查|\\btariffs?\\b|\\btrades?\\b|\\btrading\\b|\\bexports?\\b|\\bimports?\\b|\\bsanctions?\\b|\\bcustoms\\b|\\bquota\\b|\\bdeals?\\b|\\bdumping\\b)).*",
    region: "northAmerica",
  },
  {
    id: "trade-middle-east",
    name: "中东贸易",
    sourceName: "国际贸易·中东",
    pattern: "(?=.*(沙特|阿联酋|迪拜|阿布扎比|卡塔尔|科威特|阿曼|巴林|埃及|土耳其|伊朗|伊拉克|以色列|约旦|黎巴嫩|海湾|中东|杰贝阿里|\\bSaudi\\b|\\bUAE\\b|\\bQatar\\b|\\bKuwait\\b|\\bOman\\b|\\bBahrain\\b|\\bEgypt\\b|\\bTurkey\\b|\\bIran\\b|\\bIraq\\b|\\bIsrael\\b|\\bJordan\\b|\\bGCC\\b|\\bMiddle East\\b|\\bGulf\\b))(?=.*(关税|贸易|出口|进口|制裁|海关|港口|物流|转运|协定|枢纽|\\btariffs?\\b|\\btrades?\\b|\\btrading\\b|\\bexports?\\b|\\bimports?\\b|\\bsanctions?\\b|\\bcustoms\\b|\\bports?\\b|\\blogistics\\b|\\btransshipment\\b)).*",
  },
  {
    id: "horticulture-flowers",
    name: "园艺花卉",
    sourceName: "园艺·花卉产业",
    pattern: "花卉|鲜花|鲜切花|切花|盆花|种球|种苗|苗木|园林|园艺|温室|大棚|植物工厂|垂直农业|设施农业|花卉拍卖|斗南|花市|花艺|花店|永生花|干花|花展|园博会|园艺疗法|花卉电商|冷链|\\bfloriculture\\b|\\bfloricultural\\b|\\bhorticulture\\b|\\bhorticultural\\b|\\bcut flower\\b|\\bflower auction\\b|\\bbulb\\b|\\bgreenhouse\\b|\\bbotanical garden\\b|\\bflorist\\b|\\bflowers?\\b|\\bgardeners?\\b|\\bedible plants\\b",
    industry: "horticulture",
  },
  {
    id: "flower-varieties",
    name: "花卉品种",
    sourceName: "花卉·品种与市场",
    pattern: "玫瑰|月季|百合|郁金香|菊花|康乃馨|蝴蝶兰|兰花|多肉|牡丹|水仙|向日葵|洋桔梗|满天星|蕨类|观叶|\\btulip\\b|\\borchid\\b|\\bchrysanthemum\\b|\\brose\\b|\\blily\\b|\\bpeony\\b|\\bsunflower\\b|\\bgerbera\\b",
    industry: "horticulture",
  },
  {
    id: "horticulture-companies",
    name: "园艺公司",
    sourceName: "园艺·产业链公司",
    pattern: "先正达|拜耳作物|巴斯夫农业|科迪华|约翰迪尔|普瑞瓦|昕诺飞|橙色多盟|虹越|英茂花卉|缤纷园艺|森禾|云南花卉|荷兰花卉|阿斯米尔|\\bSyngenta\\b|\\bBayer Crop\\b|\\bBASF\\b|\\bCorteva\\b|\\bJohn Deere\\b|\\bPriva\\b|\\bSignify\\b|\\bDümmen\\b|\\bFloraHolland\\b|\\bRoyal FloraHolland\\b|\\bAalsmeer\\b|\\bPlantum\\b",
    industry: "horticulture",
  },
  {
    id: "growing-media",
    name: "栽培基质",
    sourceName: "园艺·基质与无泥炭",
    pattern: "泥炭|草炭|栽培基质|椰糠|无泥炭|腐殖质|\\bpeat\\b|\\bpeatless\\b|\\bno-peat\\b|\\bcoir\\b|\\bgrowing media\\b|\\bsubstrates?\\b|\\bgrow bags?\\b|\\brock wool\\b|\\bstone wool\\b|\\bperlite\\b|\\bvermiculite\\b",
    industry: "horticulture",
  },
  {
    id: "packaging-regulations",
    name: "包装法规",
    sourceName: "园艺·包装与环保法规",
    pattern: "果蔬包装|生鲜包装|鲜花包装|花束包装|可降解包装|堆肥包装|塑料禁令|禁塑|\\bpackaging (?:laws?|rules?|regulations?|waste)\\b|\\bPPWR\\b|\\bEPR\\b|extended producer responsibility|\\brPET\\b|\\bclamshells?\\b|\\bcompostable\\b|\\bbiodegradable (?:packaging|pots?)\\b|\\bocean[- ]bound plastic\\b|\\bplastic waste\\b",
    industry: "horticulture",
  },
  {
    id: "biocontrol",
    name: "绿色防控",
    sourceName: "园艺·绿色防控与智能装备",
    pattern: "生物防治|绿色防控|天敌昆虫|授粉|熊蜂|杀虫灯|防虫网|抗药性|杀菌剂|\\bbiocontrol\\b|\\bbiological control\\b|\\bpollinat(?:or|ors|ing)\\b|\\bbumblebees?\\b|\\bfungicides?\\b|\\bpesticide resistance\\b|\\bUV-C\\b|\\bagribots?\\b|\\bfarm robots?\\b|\\brobotic weeding\\b|\\bintegrated pest management\\b",
    industry: "horticulture",
  },
  {
    id: "agriculture-crops",
    name: "农业种植",
    sourceName: "农业·种植与粮农",
    pattern: "农业|三农|农村|农民|粮食|农作物|播种|春耕|秋收|丰收|收割|耕地|农田|小麦|水稻|玉米|大豆|棉花|油料|糖料|种子(?!轮|基金)|种业|转基因|农药|化肥|灌溉|农机|菜篮子|米面粮油|粮价|农产品|干旱|旱灾|洪涝|\\bagriculture\\b|\\bagricultural\\b|\\bfarming\\b|\\bfarmers?\\b|\\bfarmland\\b|\\bfarm bills?\\b|\\bcrops?\\b|\\bcropping\\b|\\bgrains?\\b|\\bwheat\\b|\\brice\\b|\\bcorn\\b|\\bmaize\\b|\\bsoybeans?\\b|\\bsoya\\b|\\bcotton\\b|\\bcanola\\b|\\brapeseed\\b|\\bsugar beets?\\b|\\bharvests?\\b|\\bplanting\\b|\\bpaddy\\b|\\bpaddies\\b|\\bfood security\\b|\\barable\\b|\\birrigation\\b|\\bfertiliz(?:er|ers)\\b|\\bfertiliser\\b|\\bfertilisers\\b|\\bpesticides?\\b|\\bseeds?\\b(?! funding)(?! round)(?! capital)|\\bagritech\\b|\\bagtech\\b|\\bdrought\\b|\\bGMO\\b|\\bGMOs\\b|\\bpotat(?:o|oes)\\b|马铃薯|土豆|\\bgrowers?\\b",
    industry: "agriculture",
  },
  {
    id: "agriculture-livestock",
    name: "畜牧养殖",
    sourceName: "农业·养殖与畜牧",
    pattern: "畜牧|养殖|畜禽|生猪|猪肉|猪价|家禽|禽肉|禽蛋|禽流感|奶牛|奶业|乳制品|牧场|放牧|饲料|渔业|水产|鱼粉|远洋|捕捞|对虾|龙虾|生猪期货|\\blivestock\\b|\\bcattle\\b|\\bbeef\\b|\\bdairy\\b|\\bmilk\\b|\\bpigs?\\b|\\bpork\\b(?![- ]barrel)|\\bhogs?\\b|\\bswine\\b|\\bpoultry\\b|\\bbroilers?\\b|\\bchicken\\b|\\banimal feed\\b|\\bcattle feed\\b|\\bfeed grains?\\b|\\baquaculture\\b|\\bfishery\\b|\\bfisheries\\b|\\bseafood\\b|\\bshrimp\\b|\\bprawns?\\b|\\bfish meal\\b|\\bfishmeal\\b|\\blobsters?\\b|\\bcrabs?\\b|\\bavian flu\\b|\\bbird flu\\b|\\bH5N1\\b|\\bH7N9\\b",
    industry: "agriculture",
  },
  {
    id: "agriculture-companies",
    name: "农业公司",
    sourceName: "农业·产业链公司",
    pattern: "中化集团|中化化肥|先正达|科迪华|拜耳作物|巴斯夫农业|约翰迪尔|凯斯纽荷兰|爱科|久保田|嘉吉|邦吉|路易达孚|雅苒|丰益国际|泰森|丹麦皇冠|万洲国际|双汇|隆平高科|登海种业|大北农|新希望|海大集团|牧原|温氏|圣农|正大集团|卜蜂|中粮|中储粮|北大荒|苏垦农发|中国一拖|第一拖拉机|象屿农产|袁隆平|\\bSyngenta\\b|\\bCorteva\\b|\\bMonsanto\\b|\\bBayer Crop\\b|\\bBASF\\b|\\bYara\\b|\\bNutrien\\b|\\bMosaic Company\\b|\\bMosaic Co\\b|\\bCargill\\b|\\bADM\\b|\\bBunge\\b|\\bLouis Dreyfus\\b|\\bCOFCO\\b|\\bWilmar\\b|\\bCharoen Pokphand\\b|\\bCP Foods\\b|\\bJohn Deere\\b|\\bCNH\\b|\\bAGCO\\b|\\bKubota\\b|\\bTyson\\b|\\bJBS\\b|\\bBRF\\b|\\bMarfrig\\b|\\bDanish Crown\\b|\\bWH Group\\b|\\bYuan Longping\\b|\\bLongping\\b",
    industry: "agriculture",
  },
];

export const TRENDRADAR_RSS_SOURCES: ReadonlyArray<NewsSource> = [
  { id: "hacker-news", name: "Hacker News", url: "https://hnrss.org/frontpage", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "yahoo-finance", name: "雅虎财经", url: "https://finance.yahoo.com/news/rssindex", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "openai-news", name: "OpenAI 官方", url: "https://openai.com/news/rss.xml", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "google-ai-blog", name: "Google AI 博客", url: "https://blog.google/technology/ai/rss/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "techcrunch-ai", name: "TechCrunch · AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "ars-ai", name: "Ars Technica · AI", url: "https://arstechnica.com/ai/feed/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "theverge", name: "The Verge（科技/AI）", url: "https://www.theverge.com/rss/index.xml", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "supplychaindive", name: "Supply Chain Dive", url: "https://www.supplychaindive.com/feeds/news/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "freightwaves", name: "FreightWaves（货运物流）", url: "https://www.freightwaves.com/news/feed/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "hortidaily", name: "HortiDaily（园艺）", url: "https://www.hortidaily.com/rss.xml", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "floraldaily", name: "Floral Daily（花卉）", url: "https://www.floraldaily.com/rss.xml", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "growingproduce", name: "Growing Produce（果蔬种植）", url: "https://www.growingproduce.com/feed", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "greenhousegrower", name: "Greenhouse Grower（温室种植）", url: "https://www.greenhousegrower.com/feed/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "freshplaza-europe", name: "FreshPlaza · 欧洲", url: "https://www.freshplaza.com/europe/rss.xml/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "freshplaza-asia", name: "FreshPlaza · 亚洲", url: "https://www.freshplaza.com/asia/rss.xml/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "agfundernews", name: "AgFunderNews（农业科技）", url: "https://agfundernews.com/feed", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "potatoes-news", name: "Potato News（马铃薯产业）", url: "https://potatoes.news/feed/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "agrospectrum-india", name: "Agro Spectrum India（印度农业）", url: "https://agrospectrumindia.com/feed", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "kekkila-bvb", name: "Kekkilä-BVB（栽培基质）", url: "https://www.kekkila-bvb.com/feed/", type: "rss", enabled: true, maxAgeDays: 14, maxItems: 30 },
  { id: "packagingdive", name: "Packaging Dive（包装行业）", url: "https://www.packagingdive.com/feeds/news/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
  { id: "produce-blue-book", name: "The Produce Blue Book", url: "https://www.producebluebook.com/feed/", type: "rss", enabled: true, maxAgeDays: 1, maxItems: 30 },
];

export function trendRadarKeywordGroups(): KeywordGroup[] {
  return TRENDRADAR_KEYWORD_GROUPS.map((entry) => ({
    id: "trendradar:" + entry.id,
    name: entry.name,
    alias: entry.name,
    words: [{ text: "/" + entry.pattern + "/", type: "regex" }],
    required: [],
    exclude: [],
    maxItems: 0,
    industry: entry.industry,
    region: entry.region,
  }));
}

/** Ready-to-use configuration that removes the first-run setup step. */
export function createTrendRadarConfig(): IndustryNewsConfig {
  return {
    name: "TrendRadar 新闻预设",
    keywords: trendRadarKeywordGroups(),
    globalExcludes: ["震惊"],
    industries: ["horticulture", "agriculture", "logistics"],
    regions: ["global", "europe", "northAmerica"],
    sources: [
      ...HOTLIST_PRESETS.map((entry) => ({ ...entry, type: "hotlist" as const, enabled: true, maxItems: 50 })),
      ...TRENDRADAR_RSS_SOURCES.map((entry) => ({ ...entry })),
    ],
    reportMode: "current",
    displayMode: "keyword",
    rankThreshold: 5,
    maxNewsPerKeyword: 0,
    freshnessDays: 0,
    aiEnabled: false,
    aiLanguage: "zh-CN",
    aiMaxItemsPerRun: 20,
    aiInstructions: "",
  };
}
