/** Bounded parallelism: keeps IMAP connections and IndexedDB writes predictable. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const results = new Array<R>(items.length);
  let next = 0;

  async function runner() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: size }, () => runner()));
  return results;
}
