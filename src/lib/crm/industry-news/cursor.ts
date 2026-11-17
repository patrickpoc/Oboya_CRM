import type { NewsItem } from "./types";

/** Opaque keyset cursor: (weight, fetched_at, id) in descending order. */

export type NewsCursor = { weight: number; fetchedAt: string; id: string };

export function encodeCursor(item: NewsItem): string {
  const payload: NewsCursor = { weight: item.weight, fetchedAt: item.fetchedAt, id: item.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(value: string | null | undefined): NewsCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<NewsCursor>;
    if (
      typeof parsed.weight !== "number" ||
      !Number.isFinite(parsed.weight) ||
      typeof parsed.fetchedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.fetchedAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      return null;
    }
    return { weight: parsed.weight, fetchedAt: parsed.fetchedAt, id: parsed.id };
  } catch {
    return null;
  }
}
