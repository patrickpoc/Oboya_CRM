"use client";

import type { CrmAction, CrmModule } from "@/lib/crm/types";
import { usePermission } from "@/contexts/CrmContext";

/** UI gate only: the server (crmGuard + RLS) stays authoritative. */
export function Can({
  module,
  action = "view",
  children,
  fallback = null,
}: {
  module: CrmModule;
  action?: CrmAction;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const allowed = usePermission(module, action);
  return allowed ? children : fallback;
}
