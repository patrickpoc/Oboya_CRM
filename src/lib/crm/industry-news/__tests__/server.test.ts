import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { bootstrapIndustryNews } from "../server";

describe("bootstrapIndustryNews", () => {
  it("returns the saved config id so follow-up pages and ingest can address it", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configId: "config-123",
        config: { name: "Custom", keywords: [] },
        name: "Custom",
        saved: true,
        updatedAt: "2026-11-16T10:00:00.000Z",
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
    expect(result.config.keywords.length).toBeGreaterThan(0);
  });
});
