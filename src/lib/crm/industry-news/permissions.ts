import type { CrmUser } from "@/lib/crm/types";

/**
 * Industry News is a shared company feed: only a super admin may change the
 * source list or trigger a fetch. Everyone else has read-only access.
 */
export function canManageIndustryNews(user: Pick<CrmUser, "role">): boolean {
  return user.role === "super_admin";
}
