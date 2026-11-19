import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { bootstrapIndustryNews, ingestNews } from "../server";
import { createDefaultConfig } from "../config";
import { fetchSources } from "../feeds";
import { analysePending } from "../ai";

vi.mock("../feeds", () => ({ fetchSources: vi.fn() }));
vi.mock("../ai", () => ({ analysePending: vi.fn(async () => ({ status: "off", analyzed: 0, failed: 0 })) }));

describe("bootstrapIndustryNews", () => {
  it("returns the saved config id so follow-up pages and ingest can address it", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configId: "config-123",
        config: { name: "Custom", keywords: [] },
        name: "Custom",
        saved: true,
        updatedAt: "2026-11-16T10:00:00.000Z",
        lastFetchedAt: "2026-11-19T08:00:00.000Z",
        items: [],
      },
      error: null,
    }));

    const result = await bootstrapIndustryNews(
      { rpc } as unknown as CrmSupabaseClient,
      { limit: 10 }
    );

    expect(result.configId).toBe("config-123");
    expect(result.saved).toBe(true);
    expect(result.name).toBe("Custom");
    expect(result.lastFetchedAt).toBe("2026-11-19T08:00:00.000Z");
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("falls back to a default config when nothing has been saved yet", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configId: null,
        config: null,
        name: "Industry news",
        saved: false,
        updatedAt: null,
        lastFetchedAt: null,
        items: [],
      },
      error: null,
    }));

    const result = await bootstrapIndustryNews(
      { rpc } as unknown as CrmSupabaseClient,
      { limit: 10 }
    );

    expect(result.configId).toBe("");
    expect(result.saved).toBe(false);
    expect(result.lastFetchedAt).toBeNull();
    expect(result.config.keywords.length).toBeGreaterThan(0);
  });
});

describe("ingest success timestamps", () => {
  const stored = {
    id: "config", ownerId: "owner", name: "News", updatedAt: "2026-11-19T08:00:00Z",
    config: { ...createDefaultConfig(), sources: [{ id: "feed", name: "Feed", type: "rss" as const, url: "https://example.com/feed", enabled: true }] },
  };

  it("does not persist or advance the success timestamp when every source fails", async () => {
    vi.mocked(fetchSources).mockResolvedValue({ items: [], errors: [{ sourceId: "feed", message: "timeout" }] });
    const rpc = vi.fn();
    const from = vi.fn();
    const result = await ingestNews({ rpc, from } as unknown as CrmSupabaseClient, "owner", stored);
    expect(result.status).toBe("failed");
    expect(result.lastFetchedAt).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("records a successful empty fetch and distinguishes partial failures", async () => {
    const rpc = vi.fn(async () => ({ data: { lastFetchedAt: "2026-11-19T12:00:00Z" }, error: null }));
    const chain = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(async () => ({ data: [], error: null })) };
    for (const key of ["select", "eq", "is", "order"] as const) chain[key].mockReturnValue(chain);
    const supabase = { rpc, from: vi.fn(() => chain) } as unknown as CrmSupabaseClient;
    vi.mocked(fetchSources).mockResolvedValue({ items: [], errors: [] });
    expect((await ingestNews(supabase, "owner", stored)).status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("crm_industry_news_ingest", expect.objectContaining({ p_inserts: [], p_updates: [] }));
    vi.mocked(fetchSources).mockResolvedValue({ items: [], errors: [{ sourceId: "bad", message: "timeout" }] });
    const partial = await ingestNews(supabase, "owner", { ...stored, config: { ...stored.config, sources: [...stored.config.sources, { ...stored.config.sources[0], id: "bad" }] } });
    expect(partial.status).toBe("partial");
    expect(partial.lastFetchedAt).toBe("2026-11-19T12:00:00Z");
    expect(analysePending).toHaveBeenCalled();
  });
});
