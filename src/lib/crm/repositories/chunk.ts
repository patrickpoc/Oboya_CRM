/**
 * PostgREST sends `.in("id", ids)` in the URL, so long id lists (export up to
 * 5000 rows, kanban up to 500) must be split to stay under URL length limits.
 */
export const IN_CHUNK_SIZE = 200;

export function chunk<T>(items: readonly T[], size: number = IN_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs `fetch` once per chunk of distinct ids (in parallel) and concatenates
 * the rows. `fetch` should throw on error.
 */
export async function fetchInChunks<Id, Row>(
  ids: Iterable<Id>,
  fetch: (part: Id[]) => Promise<Row[]>,
  size: number = IN_CHUNK_SIZE
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const parts = await Promise.all(chunk(unique, size).map(fetch));
  return parts.flat();
}
