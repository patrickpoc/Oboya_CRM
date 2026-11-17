import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { rowToNewsItem, type ItemRow } from "./rows";
import type { AiLanguage, NewsItem } from "./types";
import type { StoredConfig } from "./rows";

/**
 * Optional AI enrichment. The key is read only on the server and never gets a
 * NEXT_PUBLIC_ prefix. Any OpenAI-compatible chat/completions endpoint works.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;

const LANGUAGE_LABELS: Record<AiLanguage, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese",
};

export type AiRunResult = {
  status: "off" | "unconfigured" | "ok" | "partial" | "failed";
  analyzed: number;
  failed: number;
};

type ProviderSettings = { baseUrl: string; model: string; apiKey: string };

function providerSettings(): ProviderSettings | null {
  const apiKey = process.env.CRM_AI_API_KEY?.trim();
  if (!apiKey) return null;
  const rawBase = process.env.CRM_AI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  if (!/^https:\/\//i.test(rawBase)) return null;
  return {
    apiKey,
    baseUrl: rawBase.replace(/\/+$/, ""),
    model: process.env.CRM_AI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

function cleanJson(content: string): string {
  return content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

async function translateOne(
  item: NewsItem,
  language: AiLanguage,
  instructions: string,
  provider: ProviderSettings
): Promise<{ id: string; ai_title: string; ai_summary: string; ai_language: AiLanguage; ai_model: string }> {
  const body = {
    model: provider.model,
    temperature: 0,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content:
          "You localise industry news for a CRM. Answer with strict JSON only, keys `title` and `summary`. No markdown, no commentary.",
      },
      {
        role: "user",
        content: [
          `Target language: ${LANGUAGE_LABELS[language]} (${language}).`,
          instructions ? `Editor instructions: ${instructions}` : "",
          `Original title: ${item.title.slice(0, 300)}`,
          `Feed summary: ${(item.summary ?? "").slice(0, 1200)}`,
          "Translate the title into the target language. Write one or two neutral business sentences in the target language explaining why this matters to an horticulture business.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI_EMPTY_RESPONSE");

  const parsed = JSON.parse(cleanJson(content)) as { title?: unknown; summary?: unknown };
  if (typeof parsed.title !== "string" || typeof parsed.summary !== "string") {
    throw new Error("AI_BAD_SHAPE");
  }
  return {
    id: item.id,
    ai_title: parsed.title.trim().slice(0, 300) || item.title.slice(0, 300),
    ai_summary: parsed.summary.trim().slice(0, 600),
    ai_language: language,
    ai_model: provider.model,
  };
}

/** Claim, analyse in small concurrent batches, then persist all results in one call. */
export async function analysePending(
  supabase: CrmSupabaseClient,
  stored: StoredConfig
): Promise<AiRunResult> {
  const config = stored.config;
  if (!config.aiEnabled) return { status: "off", analyzed: 0, failed: 0 };
  const provider = providerSettings();
  if (!provider) return { status: "unconfigured", analyzed: 0, failed: 0 };

  const { data: claimed, error: claimError } = await supabase.rpc("crm_industry_news_ai_claim", {
    p_config_id: stored.id,
    p_limit: config.aiMaxItemsPerRun,
  });
  if (claimError) throw claimError;
  const items = ((claimed ?? []) as ItemRow[]).map(rowToNewsItem);
  if (items.length === 0) return { status: "ok", analyzed: 0, failed: 0 };

  const results: Array<{
    id: string;
    ai_title: string;
    ai_summary: string;
    ai_language: AiLanguage;
    ai_model: string;
  }> = [];
  let failed = 0;

  for (let index = 0; index < items.length; index += CONCURRENCY) {
    const batch = items.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((item) =>
        translateOne(item, config.aiLanguage, config.aiInstructions.slice(0, 400), provider)
      )
    );
    settled.forEach((result) => {
      if (result.status === "fulfilled") results.push(result.value);
      else {
        failed += 1;
        if (result.reason instanceof Error) console.error("industry news AI call failed:", result.reason.message);
      }
    });
  }

  if (results.length > 0) {
    const { error: saveError } = await supabase.rpc("crm_industry_news_ai_save", {
      p_config_id: stored.id,
      p_results: results,
    });
    if (saveError) {
      await supabase.rpc("crm_industry_news_ai_release", { p_config_id: stored.id });
      throw saveError;
    }
  }
  if (failed > 0 && results.length === 0) {
    await supabase.rpc("crm_industry_news_ai_release", { p_config_id: stored.id });
  }

  return {
    status: failed === 0 ? "ok" : results.length > 0 ? "partial" : "failed",
    analyzed: results.length,
    failed,
  };
}
