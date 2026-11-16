"use client";

import { ApiError, apiFetch } from "@/components/crm/common/api";
import { createSharedPoller } from "@/components/crm/common/shared-poll";
import { browserTimeZone } from "@/lib/crm/activities/due";
import type { NavBadgeKey, NavCounts } from "@/lib/crm/navigation";

const KEYS: NavBadgeKey[] = ["leadsNew", "tasksDue"];

/** Set once the endpoint answers 404 so a missing route is not polled again. */
let unavailable = false;

function toCounts(data: unknown): NavCounts {
  const out: NavCounts = {};
  if (!data || typeof data !== "object") return out;
  for (const key of KEYS) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

const poller = createSharedPoller<NavCounts>({
  initial: {},
  intervalMs: 60_000,
  refreshEvent: "crm:nav-counts",
  fetch: async () => {
    if (unavailable) return null;
    try {
      return toCounts(
        await apiFetch<unknown>(`/api/crm/nav-counts?tz=${encodeURIComponent(browserTimeZone())}`, { quiet: true })
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) unavailable = true;
      return null;
    }
  },
});

/**
 * Sidebar badge counts from `/api/crm/nav-counts` ({ leadsNew, tasksDue }).
 * Optional: a 404 or error leaves the badges empty. Dispatch
 * `window.dispatchEvent(new Event("crm:nav-counts"))` to refresh after a change.
 */
export function useNavCounts(): NavCounts {
  return poller.use().value;
}
