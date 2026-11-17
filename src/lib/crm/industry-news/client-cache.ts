/**
 * Short-lived per-tab cache for read-only Industry News responses.
 * Session storage survives a route change but not a new browser session, and
 * the in-flight map de-duplicates identical requests fired in the same tick.
 */

const PREFIX = "oboya:industry-news:";
const memory = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function cacheKey(userId: string, kind: string, params: Record<string, string | number | undefined>) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  return `${PREFIX}${userId}:${kind}:${query}`;
}

function read<T>(key: string, ttlMs: number): T | null {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && now - mem.at < ttlMs) return mem.value as T;
  const raw = storage()?.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { at: number; value: T };
      if (now - parsed.at < ttlMs) {
        memory.set(key, parsed);
        return parsed.value;
      }
    } catch {
      // Ignore a malformed/stale entry; the network loader repopulates it.
    }
  }
  return null;
}

function write<T>(key: string, value: T) {
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  try {
    storage()?.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota errors must never break the UI.
  }
}

export async function cachedFetch<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = read<T>(key, ttlMs);
  if (hit !== null) return hit;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const request = loader()
    .then((value) => {
      write(key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

export function invalidateIndustryNewsCache() {
  for (const key of memory.keys()) if (key.startsWith(PREFIX)) memory.delete(key);
  const store = storage();
  if (!store) return;
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}
