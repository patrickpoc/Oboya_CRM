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
import { IndustryNewsConfigEditor } from "./IndustryNewsConfigEditor";
import { emptyFilters, IndustryNewsFeed, type NewsFilters } from "./IndustryNewsFeed";
import type { IndustryNewsConfig, NewsItem } from "@/lib/crm/industry-news/types";

type ConfigResponse = {
  config: IndustryNewsConfig;
  name: string;
  saved: boolean;
  updatedAt: string | null;
};
type ItemsResponse = { items: NewsItem[] };
type IngestResponse = { fetched: number; added: number; updated: number; matched: number };

/** Main screen: a news feed and a graphical configuration editor. */
export function IndustryNewsView() {
  const t = useTranslations("industryNews");
  const errorMessage = useApiErrorMessage("setup");
  const { can } = useCrm();
  const canEdit = can("industry_news", "edit");

  const [config, setConfig] = useState<IndustryNewsConfig | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [filters, setFilters] = useState<NewsFilters>(emptyFilters);
  const [configError, setConfigError] = useState<unknown>(null);
  const [itemsError, setItemsError] = useState<unknown>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("news");

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const response = await apiFetch<ConfigResponse>("/api/crm/industry-news/config");
      setConfig(response.config);
      setUpdatedAt(response.updatedAt);
      setDirty(false);
      setConfigError(null);
    } catch (error) {
      setConfigError(error);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("limit", "100");
    try {
      const response = await apiFetch<ItemsResponse>(`/api/crm/industry-news/items?${params}`);
      setItems(response.items);
      setItemsError(null);
    } catch (error) {
      setItemsError(error);
    } finally {
      setLoadingItems(false);
    }
  }, [filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; the loader sets loading state before awaiting the API
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when the config arrives; the loader sets loading state before awaiting the API
      void loadItems();
    }
  }, [config, loadItems]);

  const save = async () => {
    if (!config) return;
    setBusy(true);
    try {
      const response = await apiFetch<ConfigResponse>("/api/crm/industry-news/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(response.config);
      setUpdatedAt(response.updatedAt);
      setDirty(false);
      toast.success(t("config.saved"));
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        const first = Object.values(error.fields)[0];
        toast.error(first ?? errorMessage(error));
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const ingest = async () => {
    setBusy(true);
    try {
      const response = await apiFetch<IngestResponse>("/api/crm/industry-news/ingest", { method: "POST" });
      toast.success(t("ingest.done", { added: response.added, updated: response.updated }));
      await loadItems();
    } catch (error) {
      toast.error(errorMessage(error));
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
          </div>
        }
        actions={
          <>
            {canEdit ? (
              <Button
                size="sm"
                className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
                disabled={busy || loadingConfig}
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

      {configError && !config ? (
        <ErrorState onRetry={() => void loadConfig()} />
      ) : !config ? null : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="news">{t("tabs.news")}</TabsTrigger>
            <TabsTrigger value="config">{t("tabs.config")}</TabsTrigger>
          </TabsList>
          <TabsContent value="news">
            <IndustryNewsFeed
              items={items}
              config={config}
              filters={filters}
              onFiltersChange={setFilters}
              loading={loadingItems}
              error={itemsError}
              onRetry={() => void loadItems()}
            />
          </TabsContent>
          <TabsContent value="config">
            <IndustryNewsConfigEditor
              value={config}
              disabled={!canEdit || busy}
              onChange={(next) => {
                setConfig(next);
                setDirty(true);
              }}
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
