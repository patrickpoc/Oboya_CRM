"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { CrmAction, CrmModule, CrmUser, ResolvedPermissions } from "@/lib/crm/types";

interface CrmContextValue {
  user: CrmUser;
  setUser: (user: CrmUser) => void;
  permissions: ResolvedPermissions;
  setPermissions: (permissions: ResolvedPermissions) => void;
  can: (module: CrmModule, action?: CrmAction) => boolean;
}

const CrmContext = createContext<CrmContextValue | null>(null);

/**
 * Ported from the reference AdminContext. The (crm) layout resolves the user
 * and their permissions with requireCrmAuth(), so there is no client-side
 * `/me` round-trip and no loading state. The server stays authoritative:
 * `can()` only gates UI.
 */
export function CrmProvider({
  children,
  initialUser,
  initialPermissions,
}: {
  children: React.ReactNode;
  initialUser: CrmUser;
  initialPermissions: ResolvedPermissions;
}) {
  const [user, setUser] = useState<CrmUser>(initialUser);
  const [permissions, setPermissions] = useState<ResolvedPermissions>(initialPermissions);

  const can = useCallback(
    (module: CrmModule, action: CrmAction = "view") =>
      permissions[module]?.includes(action) ?? false,
    [permissions]
  );

  const value = useMemo(
    () => ({ user, setUser, permissions, setPermissions, can }),
    [user, permissions, can]
  );

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error("useCrm must be used within CrmProvider");
  return ctx;
}

export function usePermission(module: CrmModule, action: CrmAction = "view") {
  const { can } = useCrm();
  return can(module, action);
}
