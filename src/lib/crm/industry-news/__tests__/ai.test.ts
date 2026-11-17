import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ai.ts is server-only; the guard is meaningless in a Node test runner.
vi.mock("server-only", () => ({}));

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { analysePending } from "../ai";
import { createDefaultConfig } from "../config";
import type { ItemRow, StoredConfig } from "../rows";
import type { IndustryNewsConfig } from "../types";

const fetchMock = vi.fn();

const makeRow = (id: string): ItemRow => ({
  id,
  title: `Story ${id}`,
  url: `https://example.com/${id}`,
  source_id: "rss",
  source_name: "Example",
  source_type: "rss",
  rank: 1,
  ranks: [1],
  rank_timeline: [],
  first_seen_at: "10:00",
  last_seen_at: "10:00",
  seen_count: 1,
  published_at: null,
  summary: "Original summary",
  author: null,
  matched_keywords: [],
  industries: [],
  regions: [],
  is_new: true,
  weight: 42,
  fetched_at: "2026-11-16T10:00:00.000Z",
  news_date: "2026-11-16",
  ai_title: null,
  ai_summary: null,
  ai_language: null,
  ai_model: null,
  ai_analyzed_at: null,
});

const stored = (overrides: Partial<IndustryNewsConfig> = {}): StoredConfig => ({
  id: "config-1",
  name: "Industry news",
  config: { ...createDefaultConfig(), aiEnabled: true, ...overrides },
  updatedAt: "2026-11-16T10:00:00.000Z",
});

const fakeClient = (claimed: ItemRow[] = []) => {
  const rpc = vi.fn(async (name: string) => {
    if (name === "crm_industry_news_ai_claim") return { data: claimed, error: null };
    return { data: null, error: null };
  });
  return { supabase: { rpc } as unknown as CrmSupabaseClient, rpc };
};

const completion = (title: string, summary: string) => ({
  ok: true,
  json: async () => ({
    choices: [
      { message: { content: "```json\n" + JSON.stringify({ title, summary }) + "\n```" } },
    ],
  }),
});

describe("AI enrichment", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing when disabled, unconfigured or pointed at an insecure endpoint", async () => {
    const { supabase, rpc } = fakeClient();

    await expect(analysePending(supabase, stored({ aiEnabled: false }))).resolves.toEqual({
      status: "off",
      analyzed: 0,
      failed: 0,
    });

    vi.stubEnv("CRM_AI_API_KEY", "  ");
    await expect(analysePending(supabase, stored())).resolves.toEqual({
      status: "unconfigured",
      analyzed: 0,
      failed: 0,
    });

    vi.stubEnv("CRM_AI_API_KEY", "key");
    vi.stubEnv("CRM_AI_BASE_URL", "http://insecure.example.com/v1");
    await expect(analysePending(supabase, stored())).resolves.toEqual({
      status: "unconfigured",
      analyzed: 0,
      failed: 0,
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("claims, translates and saves a batch using server-only credentials", async () => {
    vi.stubEnv("CRM_AI_API_KEY", " secret-key ");
    vi.stubEnv("CRM_AI_BASE_URL", "https://llm.example.com/v1/");
    vi.stubEnv("CRM_AI_MODEL", "test-model");
    const { supabase, rpc } = fakeClient([makeRow("item-1")]);
    fetchMock.mockResolvedValueOnce(completion("  Noticia  ", "  Resumen útil.  "));

    await expect(
      analysePending(
        supabase,
        stored({ aiLanguage: "es", aiInstructions: "Focus on prices", aiMaxItemsPerRun: 7 })
      )
    ).resolves.toEqual({ status: "ok", analyzed: 1, failed: 0 });

    expect(rpc).toHaveBeenNthCalledWith(1, "crm_industry_news_ai_claim", {
      p_config_id: "config-1",
      p_limit: 7,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.messages[1].content).toContain("Spanish (es)");
    expect(body.messages[1].content).toContain("Focus on prices");

    expect(rpc).toHaveBeenNthCalledWith(2, "crm_industry_news_ai_save", {
      p_config_id: "config-1",
      p_results: [
        {
          id: "item-1",
          ai_title: "Noticia",
          ai_summary: "Resumen útil.",
          ai_language: "es",
          ai_model: "test-model",
        },
      ],
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("reports partial results and releases the claim only when nothing succeeded", async () => {
    vi.stubEnv("CRM_AI_API_KEY", "key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [makeRow("a"), makeRow("b")];

    const partial = fakeClient(rows);
    fetchMock
      .mockResolvedValueOnce(completion("Localised", "Useful summary"))
      .mockRejectedValueOnce(new Error("network down"));
    await expect(analysePending(partial.supabase, stored())).resolves.toEqual({
      status: "partial",
      analyzed: 1,
      failed: 1,
    });
    expect(partial.rpc).not.toHaveBeenCalledWith("crm_industry_news_ai_release", expect.anything());

    const failed = fakeClient(rows);
    fetchMock.mockReset().mockRejectedValue(new Error("network down"));
    await expect(analysePending(failed.supabase, stored())).resolves.toEqual({
      status: "failed",
      analyzed: 0,
      failed: 2,
    });
    expect(failed.rpc).toHaveBeenCalledWith("crm_industry_news_ai_release", {
      p_config_id: "config-1",
    });
  });

  it("releases claimed items when saving the results fails", async () => {
    vi.stubEnv("CRM_AI_API_KEY", "key");
    const rpc = vi.fn(async (name: string) => {
      if (name === "crm_industry_news_ai_claim") return { data: [makeRow("a")], error: null };
      if (name === "crm_industry_news_ai_save") return { data: null, error: new Error("save failed") };
      return { data: null, error: null };
    });
    fetchMock.mockResolvedValueOnce(completion("Localised", "Useful summary"));

    await expect(
      analysePending({ rpc } as unknown as CrmSupabaseClient, stored())
    ).rejects.toThrow("save failed");
    expect(rpc).toHaveBeenCalledWith("crm_industry_news_ai_release", {
      p_config_id: "config-1",
    });
  });
});
