import { buildSearchFilter } from "@/lib/crm/objects/query";
import type { CrmObject, RecordConfig } from "@/lib/crm/objects/types";

/**
 * Global search (topbar ⌘K). Pure: query normalisation and the per-object
 * PostgREST filter (ilike, LIKE metacharacters escaped by objects/query.ts).
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_LIMIT = 5;
export const SEARCH_DEBOUNCE_MS = 200;
/** Objects searched, in display order. */
export const SEARCH_OBJECTS = ["lead", "account", "contact", "opportunity"] as const satisfies readonly CrmObject[];
export type SearchObject = (typeof SEARCH_OBJECTS)[number];

/**
 * Trims, drops control characters and PostgREST's `*` wildcard, collapses
 * whitespace and caps the length. Null when shorter than the minimum.
 */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw
    .replace(/[*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH)
    .trim();
  return q.length >= SEARCH_MIN_LENGTH ? q : null;
}

/** `or=(...)` filter over the config's searchable columns (null: nothing to search). */
export function searchFilter(config: RecordConfig, q: string): string | null {
  return buildSearchFilter(config, q);
}

export type SearchHit = { id: string; name: string; secondary: string };
export type SearchGroup = { object: SearchObject; hits: SearchHit[] };

/** Secondary line: non-empty parts joined with " · ". */
export function joinSecondary(parts: unknown[]): string {
  return parts
    .filter((p): p is string | number => (typeof p === "string" && p.trim() !== "") || typeof p === "number")
    .map(String)
    .join(" · ");
}

/** Link to an object's list view filtered by `q` (all visible records, not only mine). */
export function seeAllHref(basePath: string, q: string): string {
  return `${basePath}?${new URLSearchParams({ view: "all", q }).toString()}`;
}
