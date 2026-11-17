"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/crm/setup/shared";
import {
  HOTLIST_PRESETS,
  INDUSTRY_PRESETS,
  REGION_PRESETS,
  RSS_PRESETS,
  industryGroup,
  regionGroup,
} from "@/lib/crm/industry-news/presets";
import type { IndustryNewsConfig, KeywordGroup, KeywordWord, NewsSource } from "@/lib/crm/industry-news/types";
import { cn } from "@/lib/utils";

/** Graphical editor for the whole TrendRadar-style monitoring config. */
export function IndustryNewsConfigEditor({
  value,
  onChange,
  disabled,
}: {
  value: IndustryNewsConfig;
  onChange: (next: IndustryNewsConfig) => void;
  disabled: boolean;
}) {
  const t = useTranslations("industryNews");
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const set = (patch: Partial<IndustryNewsConfig>) => onChange({ ...value, ...patch });

  const addFeed = () => {
    const url = feedUrl.trim();
    if (!url) return;
    set({
      sources: [
        ...value.sources,
        {
          id: `custom-feed-${Date.now().toString(36)}`,
          name: feedName.trim() || url,
          url,
          type: "rss",
          enabled: true,
          maxAgeDays: 7,
          maxItems: 30,
        },
      ],
    });
    setFeedName("");
    setFeedUrl("");
  };

  const patchGroup = (id: string, patch: Partial<KeywordGroup>) =>
    set({ keywords: value.keywords.map((group) => (group.id === id ? { ...group, ...patch } : group)) });

  const addGroup = () => {
    const id = `custom-${Date.now().toString(36)}`;
    set({
      keywords: [
        ...value.keywords,
        { id, name: t("config.keywords.newGroup"), words: [], required: [], exclude: [], maxItems: 0 },
      ],
    });
  };

  const toggleTag = (kind: "industries" | "regions", id: string) => {
    const active = value[kind].includes(id);
    const nextIds = active ? value[kind].filter((entry) => entry !== id) : [...value[kind], id];
    const prefix = kind === "industries" ? "industry:" : "region:";
    const groups = value.keywords.filter((group) => !group.id.startsWith(prefix));
    if (!active) {
      const group = kind === "industries" ? industryGroup(id) : regionGroup(id);
      if (group) groups.push(group);
    }
    set({ [kind]: nextIds, keywords: groups } as Partial<IndustryNewsConfig>);
  };

  const toggleSource = (source: NewsSource) => {
    const exists = value.sources.some((entry) => entry.id === source.id);
    set({
      sources: exists
        ? value.sources.map((entry) => (entry.id === source.id ? { ...entry, enabled: !entry.enabled } : entry))
        : [...value.sources, { ...source, enabled: true }],
    });
  };

  const patchSource = (id: string, patch: Partial<NewsSource>) =>
    set({ sources: value.sources.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) });

  const removeSource = (id: string) =>
    set({ sources: value.sources.filter((entry) => entry.id !== id) });

  const sourceById = new Map(value.sources.map((entry) => [entry.id, entry]));
  const allSources: NewsSource[] = [
    ...HOTLIST_PRESETS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      expectedDomain: entry.expectedDomain,
      type: "hotlist" as const,
      ...sourceById.get(entry.id),
      enabled: Boolean(sourceById.get(entry.id)?.enabled),
    })),
    ...RSS_PRESETS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      url: entry.url,
      type: "rss" as const,
      maxAgeDays: 7,
      maxItems: 30,
      ...sourceById.get(entry.id),
      enabled: Boolean(sourceById.get(entry.id)?.enabled),
    })),
  ];
  // Keep custom feeds the user added in the editor.
  for (const source of value.sources) {
    if (!allSources.some((entry) => entry.id === source.id)) allSources.push(source);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-oboya-blue-dark">{t("config.industries.title")}</CardTitle>
            <CardDescription>{t("config.industries.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {INDUSTRY_PRESETS.map((preset) => (
              <TagChip
                key={preset.id}
                active={value.industries.includes(preset.id)}
                disabled={disabled}
                label={t(`presets.industries.${preset.id}`)}
                onClick={() => toggleTag("industries", preset.id)}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-oboya-blue-dark">{t("config.regions.title")}</CardTitle>
            <CardDescription>{t("config.regions.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {REGION_PRESETS.map((preset) => (
              <TagChip
                key={preset.id}
                active={value.regions.includes(preset.id)}
                disabled={disabled}
                label={t(`presets.regions.${preset.id}`)}
                onClick={() => toggleTag("regions", preset.id)}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base text-oboya-blue-dark">{t("config.keywords.title")}</CardTitle>
            <CardDescription>{t("config.keywords.description")}</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={disabled}
            onClick={addGroup}
          >
            <Plus className="size-4" /> {t("config.keywords.addGroup")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {value.keywords.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              {t("config.keywords.empty")}
            </p>
          ) : (
            value.keywords.map((group, index) => (
              <KeywordGroupCard
                key={group.id}
                index={index}
                group={group}
                disabled={disabled}
                onChange={(patch) => patchGroup(group.id, patch)}
                onRemove={() => set({ keywords: value.keywords.filter((entry) => entry.id !== group.id) })}
              />
            ))
          )}
          <div className="space-y-1.5 rounded-lg bg-oboya-soft-white/70 p-3">
            <Label className="text-xs text-oboya-blue-dark">{t("config.globalExcludes.title")}</Label>
            <Input
              disabled={disabled}
              placeholder={t("config.globalExcludes.placeholder")}
              value={value.globalExcludes.join(", ")}
              onChange={(event) =>
                set({
                  globalExcludes: event.target.value
                    .split(",")
                    .map((word) => word.trim())
                    .filter(Boolean),
                })
              }
            />
            <p className="text-xs text-muted-foreground">{t("config.globalExcludes.description")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-oboya-blue-dark">{t("config.sources.title")}</CardTitle>
          <CardDescription>{t("config.sources.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SourceGroup
            title={t("config.sources.hotlists")}
            sources={allSources.filter((source) => source.type === "hotlist")}
            enabledIds={new Set(value.sources.filter((entry) => entry.enabled).map((entry) => entry.id))}
            disabled={disabled}
            editableIds={new Set(value.sources.map((entry) => entry.id))}
            onToggle={toggleSource}
            onPatch={patchSource}
            onRemove={removeSource}
          />
          <SourceGroup
            title={t("config.sources.rss")}
            sources={allSources.filter((source) => source.type === "rss")}
            enabledIds={new Set(value.sources.filter((entry) => entry.enabled).map((entry) => entry.id))}
            disabled={disabled}
            editableIds={new Set(value.sources.map((entry) => entry.id))}
            onToggle={toggleSource}
            onPatch={patchSource}
            onRemove={removeSource}
          />
          <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label className="text-xs text-oboya-blue-dark">{t("config.sources.feedName")}</Label>
              <Input disabled={disabled} value={feedName} onChange={(event) => setFeedName(event.target.value)} />
            </div>
            <div className="min-w-52 flex-[2] space-y-1.5">
              <Label className="text-xs text-oboya-blue-dark">{t("config.sources.feedUrl")}</Label>
              <Input
                type="url"
                disabled={disabled}
                placeholder="https://example.com/feed.xml"
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
              />
            </div>
            <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={disabled} onClick={addFeed}>
              <Plus className="size-4" /> {t("config.sources.addFeed")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-oboya-blue-dark">{t("config.report.title")}</CardTitle>
          <CardDescription>{t("config.report.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label={t("config.report.mode")}
            value={value.reportMode}
            disabled={disabled}
            onChange={(next) => set({ reportMode: next as IndustryNewsConfig["reportMode"] })}
            options={[
              { value: "daily", label: t("config.report.modeDaily") },
              { value: "current", label: t("config.report.modeCurrent") },
              { value: "incremental", label: t("config.report.modeIncremental") },
            ]}
          />
          <SelectField
            label={t("config.report.displayMode")}
            value={value.displayMode}
            disabled={disabled}
            onChange={(next) => set({ displayMode: next as IndustryNewsConfig["displayMode"] })}
            options={[
              { value: "keyword", label: t("config.report.displayKeyword") },
              { value: "platform", label: t("config.report.displayPlatform") },
            ]}
          />
          <NumberField
            label={t("config.report.rankThreshold")}
            value={value.rankThreshold}
            min={1}
            max={50}
            disabled={disabled}
            onChange={(rankThreshold) => set({ rankThreshold })}
          />
          <NumberField
            label={t("config.report.maxNews")}
            value={value.maxNewsPerKeyword}
            min={0}
            max={200}
            disabled={disabled}
            onChange={(maxNewsPerKeyword) => set({ maxNewsPerKeyword })}
          />
          <NumberField
            label={t("config.report.freshness")}
            value={value.freshnessDays}
            min={0}
            max={365}
            disabled={disabled}
            onChange={(freshnessDays) => set({ freshnessDays })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-oboya-blue-dark">{t("config.ai.title")}</CardTitle>
          <CardDescription>{t("config.ai.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex min-h-9 items-center gap-2 text-sm text-oboya-blue-dark">
            <input
              type="checkbox"
              className="size-4 accent-[#4DAF4E]"
              disabled={disabled}
              checked={value.aiEnabled}
              onChange={(event) => set({ aiEnabled: event.target.checked })}
            />
            {t("config.ai.enabled")}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={t("config.ai.language")}
              value={value.aiLanguage}
              disabled={disabled || !value.aiEnabled}
              onChange={(next) => set({ aiLanguage: next as IndustryNewsConfig["aiLanguage"] })}
              options={[
                { value: "zh-CN", label: t("config.ai.langZh") },
                { value: "en", label: t("config.ai.langEn") },
                { value: "es", label: t("config.ai.langEs") },
                { value: "pt-BR", label: t("config.ai.langPt") },
              ]}
            />
            <NumberField
              label={t("config.ai.maxItems")}
              value={value.aiMaxItemsPerRun}
              min={1}
              max={20}
              disabled={disabled || !value.aiEnabled}
              onChange={(aiMaxItemsPerRun) => set({ aiMaxItemsPerRun })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-oboya-blue-dark">{t("config.ai.instructions")}</Label>
            <textarea
              className="min-h-20 w-full rounded-lg border border-border/70 bg-white p-2 text-sm text-oboya-blue-dark placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-oboya-blue"
              disabled={disabled || !value.aiEnabled}
              maxLength={400}
              placeholder={t("config.ai.instructionsPlaceholder")}
              value={value.aiInstructions}
              onChange={(event) => set({ aiInstructions: event.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("config.ai.hint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TagChip({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full border px-3 text-sm transition-colors disabled:opacity-50",
        active
          ? "border-oboya-green bg-oboya-green/10 text-oboya-green"
          : "border-border/70 bg-white text-muted-foreground hover:border-oboya-blue/40 hover:text-oboya-blue"
      )}
    >
      {label}
    </button>
  );
}

function KeywordGroupCard({
  group,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  group: KeywordGroup;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<KeywordGroup>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("industryNews");
  const [draft, setDraft] = useState("");
  const addWord = () => {
    const text = draft.trim();
    if (!text) return;
    const word: KeywordWord = { text, type: "contains" };
    onChange({ words: [...group.words, word] });
    setDraft("");
  };
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-oboya-blue/10 text-xs font-semibold text-oboya-blue">
          {index + 1}
        </span>
        <Input
          aria-label={t("config.keywords.groupName")}
          disabled={disabled}
          className="max-w-48"
          value={group.name}
          placeholder={t("config.keywords.groupName")}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t("common.remove")}
          className="ml-auto text-oboya-orange"
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {group.words.map((word, wordIndex) => (
          <span
            key={`${word.text}-${wordIndex}`}
            className="inline-flex items-center gap-1 rounded-full bg-oboya-soft-white px-2.5 py-1 text-xs text-oboya-blue-dark"
          >
            {word.type === "regex" ? `/${word.text}/` : word.text}
            {!disabled ? (
              <button
                type="button"
                aria-label={t("common.remove")}
                className="text-oboya-orange"
                onClick={() => onChange({ words: group.words.filter((_, i) => i !== wordIndex) })}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          disabled={disabled}
          className="max-w-64"
          placeholder={t("config.keywords.wordPlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addWord();
            }
          }}
        />
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={disabled} onClick={addWord}>
          <Plus className="size-4" /> {t("common.add")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          disabled={disabled}
          placeholder={t("config.keywords.required")}
          value={group.required.join(", ")}
          onChange={(event) =>
            onChange({ required: event.target.value.split(",").map((word) => word.trim()).filter(Boolean) })
          }
        />
        <Input
          disabled={disabled}
          placeholder={t("config.keywords.exclude")}
          value={group.exclude.join(", ")}
          onChange={(event) =>
            onChange({ exclude: event.target.value.split(",").map((word) => word.trim()).filter(Boolean) })
          }
        />
        <Input
          disabled={disabled}
          type="number"
          min={0}
          placeholder={t("config.keywords.maxItems")}
          value={group.maxItems}
          onChange={(event) => onChange({ maxItems: Number(event.target.value) || 0 })}
        />
      </div>
    </div>
  );
}

function SourceGroup({
  title,
  sources,
  enabledIds,
  editableIds,
  disabled,
  onToggle,
  onPatch,
  onRemove,
}: {
  title: string;
  sources: NewsSource[];
  enabledIds: Set<string>;
  editableIds: Set<string>;
  disabled: boolean;
  onToggle: (source: NewsSource) => void;
  onPatch: (id: string, patch: Partial<NewsSource>) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("industryNews");
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-oboya-blue">{title}</p>
      <div className="grid gap-2 lg:grid-cols-2">
        {sources.map((source) => {
          const editable = editableIds.has(source.id);
          return (
            <div
              key={source.id}
              className={cn(
                "rounded-lg border p-3",
                enabledIds.has(source.id)
                  ? "border-oboya-green/50 bg-oboya-green/5"
                  : "border-border/60 bg-white"
              )}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={source.name}
                  className="size-4 accent-[#4DAF4E]"
                  disabled={disabled}
                  checked={enabledIds.has(source.id)}
                  onChange={() => onToggle(source)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-oboya-blue-dark">{source.name}</span>
                {editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={t("config.sources.remove")}
                    className="text-oboya-orange"
                    onClick={() => onRemove(source.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
              {editable && enabledIds.has(source.id) ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Input
                    aria-label={t("config.sources.editName")}
                    disabled={disabled}
                    className="h-9 text-xs"
                    value={source.name}
                    onChange={(event) => onPatch(source.id, { name: event.target.value })}
                  />
                  {source.type === "rss" ? (
                    <Input
                      aria-label={t("config.sources.feedUrl")}
                      type="url"
                      disabled={disabled}
                      className="h-9 text-xs sm:col-span-2"
                      value={source.url ?? ""}
                      onChange={(event) => onPatch(source.id, { url: event.target.value })}
                    />
                  ) : null}
                  <NumberField
                    label={t("config.sources.maxItems")}
                    value={source.maxItems ?? (source.type === "rss" ? 30 : 50)}
                    min={1}
                    max={200}
                    disabled={disabled}
                    onChange={(maxItems) => onPatch(source.id, { maxItems })}
                  />
                  {source.type === "rss" ? (
                    <NumberField
                      label={t("config.sources.maxAge")}
                      value={source.maxAgeDays ?? 7}
                      min={0}
                      max={365}
                      disabled={disabled}
                      onChange={(maxAgeDays) => onPatch(source.id, { maxAgeDays })}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("config.sources.hint")}</p>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-oboya-blue-dark">{label}</Label>
      <select className={selectClass} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-oboya-blue-dark">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}
      />
    </div>
  );
}

