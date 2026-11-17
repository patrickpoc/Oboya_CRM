import { z } from "zod";

/** Zod validation for the full config written by the graphical editor. */

const clean = (max: number) => z.string().trim().min(1).max(max);
const wordList = () => z.array(clean(120)).max(50);

export const keywordWordSchema = z.object({
  text: clean(120),
  type: z.enum(["contains", "regex"]).default("contains"),
  alias: z.string().trim().max(80).optional(),
});

export const keywordGroupSchema = z.object({
  id: clean(80),
  name: clean(80),
  alias: z.string().trim().max(80).optional(),
  words: z.array(keywordWordSchema).max(100).default([]),
  required: wordList().default([]),
  exclude: wordList().default([]),
  maxItems: z.number().int().min(0).max(500).default(0),
  industry: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
});

export const newsSourceSchema = z.object({
  id: clean(80),
  name: clean(120),
  type: z.enum(["hotlist", "rss"]),
  url: z.string().trim().max(500).url().optional(),
  expectedDomain: z.string().trim().max(120).optional(),
  enabled: z.boolean().default(true),
  maxAgeDays: z.number().int().min(0).max(365).optional(),
  maxItems: z.number().int().min(1).max(200).optional(),
});

export const industryNewsConfigSchema = z
  .object({
    name: clean(120),
    keywords: z.array(keywordGroupSchema).max(30),
    globalExcludes: wordList(),
    industries: z.array(clean(80)).max(30),
    regions: z.array(clean(80)).max(30),
    sources: z.array(newsSourceSchema).max(50),
    reportMode: z.enum(["daily", "current", "incremental"]),
    displayMode: z.enum(["keyword", "platform"]),
    rankThreshold: z.number().int().min(1).max(50),
    maxNewsPerKeyword: z.number().int().min(0).max(200),
    freshnessDays: z.number().int().min(0).max(365),
    aiEnabled: z.boolean().default(false),
    aiLanguage: z.enum(["en", "zh-CN", "es", "pt-BR"]).default("zh-CN"),
    aiMaxItemsPerRun: z.number().int().min(1).max(20).default(5),
    aiInstructions: z.string().trim().max(400).default(""),
  })
  .superRefine((config, ctx) => {
    config.sources.forEach((source, index) => {
      if (source.type === "rss" && !source.url) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "url"],
          message: "RSS source requires a URL",
        });
      }
      if (source.url) {
        const url = new URL(source.url);
        const host = url.hostname.toLowerCase();
        if (
          url.protocol !== "https:" ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "::1"
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["sources", index, "url"],
            message: "RSS source requires a public HTTPS URL",
          });
        }
      }
    });
    const ids = config.keywords.map((group) => group.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["keywords"], message: "Duplicate keyword group id" });
    }
  });

export const newsQuerySchema = z.object({
  keyword: z.string().trim().max(80).optional(),
  source: z.string().trim().max(80).optional(),
  industry: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  search: z.string().trim().max(200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Load-more pages carry the config id already held by the client, so the
 * server does not read the config row again. RLS remains the real guard. */
export const newsPageQuerySchema = newsQuerySchema.extend({
  configId: z.string().uuid(),
});
