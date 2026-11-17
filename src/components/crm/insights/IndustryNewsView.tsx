"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw, Save } from "lucide-react";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { useCrm } from "@/contexts/CrmContext";
import { apiFetch, ApiError, useApiErrorMessage } from "@/components/crm/common/api";
import { ErrorState } from "@/components/crm/common/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cachedFetch,
  cacheKey,
  invalidateIndustryNewsCache,
} from "@/lib/crm/industry-news/client-cache";
import { canManageIndustryNews } from "@/lib/crm/industry-news/permissions";
import type { IndustryNewsConfig, NewsItem } from "@/lib/crm/industry-news/types";
import { capPerKeyword, sortNewsItems } from "@/lib/crm/industry-news/matching";
import { IndustryNewsConfigEditor } from "./IndustryNewsConfigEditor";
import { emptyFilters, IndustryNewsFeed, type NewsFilters } from "./IndustryNewsFeed";

type ConfigResponse = { configId: string; config: IndustryNewsConfig; name: string; saved: boolean; updatedAt: string | null };
type BootstrapResponse = ConfigResponse & { items: NewsItem[]; nextCursor: string | null };
type PageResponse = { items: NewsItem[]; nextCursor: string | null };
type IngestResponse = {
  fetched: number;
  added: number;
  updated: number;
  matched: number;
  purged: number;
  errors: Array<{ sourceId: string; message: string }>;
  ai: { status: "off" | "unconfigured" | "ok" | "partial" | "failed"; analyzed: number; failed: number };
};

const PAGE_SIZE = 50;
const CACHE_TTL = 45_000;

function queryString(filters: NewsFilters, cursor?: string | null, configId?: string) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set("limit", String(PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  if (configId) params.set("configId", configId);
  return params.toString();
}

function cacheParams(filters: NewsFilters, cursor?: string | null) {
  return { ...filters, cursor: cursor ?? undefined, limit: PAGE_SIZE };
}

/** Main screen: a cached news feed and a graphical configuration editor. */
export function IndustryNewsView() {
  const t = useTranslations("industryNews");
  const errorMessage = useApiErrorMessage("setup");
  const { user } = useCrm();
  const canEdit = canManageIndustryNews(user);

  const [config, setConfig] = useState<IndustryNewsConfig | null>(null);
  const [configId, setConfigId] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<NewsFilters>(emptyFilters);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("news");
  const activeTab = canEdit ? tab : "news";

  /** Config + first page arrive together; repeat views come from session cache. */
  const loadInitial = useCallback(async () => {
    setLoading(true);
    const qs = queryString(filters);
    const key = cacheKey(user.id, "bootstrap", cacheParams(filters));
    try {
      const response = await cachedFetch<BootstrapResponse>(key, CACHE_TTL, () =>
        apiFetch(`/api/crm/industry-news/bootstrap?${qs}`)
      );
      setConfig(response.config);
      setConfigId(response.configId);
      setUpdatedAt(response.updatedAt);
      setItems(response.items);
      setNextCursor(response.nextCursor);
      setDirty(false);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [filters, user.id]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || !configId || !config) return;
    setLoadingMore(true);
    const qs = queryString(filters, nextCursor, configId);
    const key = cacheKey(user.id, "items", { ...cacheParams(filters, nextCursor), configId });
    try {
      const response = await cachedFetch<PageResponse>(key, CACHE_TTL, () =>
        apiFetch(`/api/crm/industry-news/items?${qs}`)
      );
      const shaped = capPerKeyword(
        sortNewsItems(response.items, config.displayMode),
        config.maxNewsPerKeyword
      );
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...shaped.filter((item) => !ids.has(item.id))];
      });
      setNextCursor(response.nextCursor);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoadingMore(false);
    }
  }, [config, configId, filters, nextCursor, user.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/filter change; the loader sets loading state before awaiting the API
    void loadInitial();
  }, [loadInitial]);

  const save = async () => {
    if (!config) return;
    setBusy(true);
    try {
      const response = await apiFetch<ConfigResponse>("/api/crm/industry-news/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      invalidateIndustryNewsCache();
      setConfig(response.config);
      setConfigId(response.configId);
      setUpdatedAt(response.updatedAt);
      setDirty(false);
      toast.success(t("config.saved"));
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields) {
        const first = Object.values(caught.fields)[0];
        toast.error(first ?? errorMessage(caught));
      } else {
        toast.error(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const ingest = async () => {
    setBusy(true);
    try {
      const response = await apiFetch<IngestResponse>("/api/crm/industry-news/ingest", { method: "POST" });
      invalidateIndustryNewsCache();
      toast.success(
        t("ingest.done", { added: response.added, updated: response.updated, purged: response.purged })
      );
      if (response.ai.status === "unconfigured") toast.error(t("ingest.aiUnconfigured"));
      else if (response.ai.analyzed > 0) {
        toast.success(t("ingest.aiDone", { count: response.ai.analyzed, language: config?.aiLanguage ?? "" }));
      }
      await loadInitial();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <span>{t("description")}</span>
            {updatedAt ? (
              <span className="text-xs text-muted-foreground">
                {t("stats.updated", { time: new Date(updatedAt).toLocaleString() })}
              </span>
            ) : null}
            {!canEdit ? (
              <span className="text-xs text-muted-foreground">{t("config.readOnlyHint")}</span>
            ) : null}
          </div>
        }
        actions={
          <>
            {canEdit ? (
              <Button
                size="sm"
                className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
                disabled={busy || loading}
                onClick={() => void ingest()}
              >
                <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} /> {t("actions.fetch")}
              </Button>
            ) : null}
            {canEdit && dirty ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full border-oboya-blue text-oboya-blue"
                disabled={busy}
                onClick={() => void save()}
              >
                <Save className="size-4" /> {t("common.save")}
              </Button>
            ) : null}
          </>
        }
      />

      {error && !config ? (
        <ErrorState onRetry={() => void loadInitial()} />
      ) : !config ? null : (
        <Tabs value={activeTab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="news">{t("tabs.news")}</TabsTrigger>
            {canEdit ? <TabsTrigger value="config">{t("tabs.config")}</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="news">
            <IndustryNewsFeed
              items={items}
              config={config}
              filters={filters}
              onFiltersChange={(next) => {
                setItems([]);
                setNextCursor(null);
                setFilters(next);
              }}
              loading={loading}
              error={error}
              onRetry={() => void loadInitial()}
              nextCursor={nextCursor}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMore()}
            />
          </TabsContent>
          {canEdit ? (
            <TabsContent value="config">
              <IndustryNewsConfigEditor
                value={config}
                disabled={busy}
                onChange={(next) => {
                  setConfig(next);
                  setDirty(true);
                }}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </>
  );
}
