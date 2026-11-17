/** Pure UID window helper shared by IMAP sync and its unit tests. */
export function uidWindow(
  sinceUid: number | null | undefined,
  highUid: number,
  batchSize: number
): { range: string; nextUid: number | null } {
  const size = Math.min(Math.max(batchSize, 1), 200);
  if (sinceUid && sinceUid > 0) {
    return { range: `${sinceUid + 1}:*`, nextUid: sinceUid };
  }
  if (highUid <= 0) {
    return { range: "1:*", nextUid: null };
  }
  return { range: `${Math.max(1, highUid - size + 1)}:${highUid}`, nextUid: null };
}

/** Highest UID in a fetched batch; keeps the cursor monotonic. */
export function nextUidAfterBatch(items: readonly { uid: number }[], fallback: number | null): number | null {
  if (items.length === 0) return fallback;
  return items.reduce((max, item) => Math.max(max, item.uid), 0);
}
