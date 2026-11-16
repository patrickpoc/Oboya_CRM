"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { ChartCard } from "@/components/crm/dashboard/ChartCard";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/crm/setup/shared";
import type { IndustryNewsConfig, NewsItem } from "@/lib/crm/industry-news/types";
import { cn } from "@/lib/utils";

export type NewsFilters = {
  keyword: string;
  source: string;
  industry: string;
  region: string;
  search: string;
};

export const emptyFilters: NewsFilters = { keyword: "", source: "", industry: "", region: "", search: "" };

export function IndustryNewsFeed({
  items,
  config,
  filters,
  onFiltersChange,
  loading,
  error,
  onRetry,
}: {
  items: NewsItem[];
  config: IndustryNewsConfig;
  filters: NewsFilters;
  onFiltersChange: (next: NewsFilters) => void;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslations("industryNews");
  const set = (patch: Partial<NewsFilters>) => onFiltersChange({ ...filters, ...patch });

  const sources = [...new Map(items.map((item) => [item.sourceId, item.sourceName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  const industries = [...new Set(items.flatMap((item) => item.industries))].sort();
  const regions = [...new Set(items.flatMap((item) => item.regions))].sort();
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const keyword of item.matchedKeywords) counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
  }
  const chartData = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatValue label={t("stats.articles")} value={items.length} />
        <StatValue label={t("stats.sources")} value={new Set(items.map((item) => item.sourceId)).size} />
        <StatValue label={t("stats.keywords")} value={counts.size} />
        <StatValue
          label={t("stats.matched")}
          value={items.reduce((sum, item) => sum + item.seenCount, 0)}
        />
      </div>

      {chartData.length > 0 ? (
        <ChartCard
          title={t("news.chartTitle")}
          data={chartData}
          xKey="name"
          yKey="count"
          type="bar"
          color="var(--oboya-blue)"
          height={200}
        />
      ) : null}

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-oboya-blue-dark">{t("news.title")}</CardTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              aria-label={t("filters.search")}
              placeholder={t("filters.search")}
              value={filters.search}
              onChange={(event) => set({ search: event.target.value })}
            />
            <select
              aria-label={t("filters.keyword")}
              className={selectClass}
              value={filters.keyword}
              onChange={(event) => set({ keyword: event.target.value })}
            >
              <option value="">{t("filters.allKeywords")}</option>
              {config.keywords.map((group) => (
                <option key={group.id} value={group.alias || group.name}>
                  {group.alias || group.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("filters.source")}
              className={selectClass}
              value={filters.source}
              onChange={(event) => set({ source: event.target.value })}
            >
              <option value="">{t("filters.allSources")}</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("filters.industry")}
              className={selectClass}
              value={filters.industry}
              onChange={(event) => set({ industry: event.target.value })}
            >
              <option value="">{t("filters.allIndustries")}</option>
              {industries.map((industry) => (
                <option key={industry} value={industry}>
                  {t(`presets.industries.${industry}`)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <select
                aria-label={t("filters.region")}
                className={selectClass}
                value={filters.region}
                onChange={(event) => set({ region: event.target.value })}
              >
                <option value="">{t("filters.allRegions")}</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {t(`presets.regions.${region}`)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={() => onFiltersChange(emptyFilters)}
              >
                {t("filters.clear")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState onRetry={onRetry} />
          ) : loading && items.length === 0 ? (
            <ListSkeleton rows={6} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Newspaper}
              title={t("news.emptyTitle")}
              description={t("news.emptyDescription")}
            />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <NewsRow key={item.id} item={item} threshold={config.rankThreshold} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-oboya-blue-dark">{value}</p>
    </div>
  );
}

function NewsRow({ item, threshold }: { item: NewsItem; threshold: number }) {
  const t = useTranslations("industryNews");
  const hot = item.rank > 0 && item.rank <= threshold;
  return (
    <li className="rounded-lg border border-border/60 bg-white p-3 transition-colors hover:border-oboya-blue/30 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-oboya-soft-white px-2 py-0.5 font-medium text-oboya-blue">
          {item.sourceName}
        </span>
        {item.rank > 0 ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-semibold",
              hot ? "bg-oboya-orange/10 text-oboya-orange" : "bg-oboya-blue/10 text-oboya-blue"
            )}
          >
            #{item.rank}
          </span>
        ) : null}
        {item.isNew ? (
          <span className="rounded-full bg-oboya-green/10 px-2 py-0.5 font-semibold text-oboya-green">
            {t("news.new")}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {item.firstSeenAt}–{item.lastSeenAt} · {t("news.seen", { count: item.seenCount })}
        </span>
        <span className="ml-auto text-muted-foreground">{t("news.weight", { value: item.weight })}</span>
      </div>
      <div className="mt-2 flex items-start gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 text-sm font-medium text-oboya-blue-dark hover:text-oboya-blue hover:underline"
        >
          {item.title}
          <ArrowUpRight className="ml-1 inline size-3.5" aria-hidden />
        </a>
      </div>
      {item.summary ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
      ) : null}
      {item.matchedKeywords.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.matchedKeywords.map((keyword) => (
            <span key={keyword} className="rounded-full bg-oboya-green/10 px-2 py-0.5 text-[11px] text-oboya-green">
              {keyword}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}
