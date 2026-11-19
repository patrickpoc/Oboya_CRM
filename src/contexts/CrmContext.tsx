"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CrmAction, CrmModule, CrmUser, ResolvedPermissions } from "@/lib/crm/types";
import { closeEmailDatabases } from "@/lib/crm/email/local-db";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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
  return <UserCrmProvider key={initialUser.id} initialUser={initialUser} initialPermissions={initialPermissions}>{children}</UserCrmProvider>;
}

function UserCrmProvider({ children, initialUser, initialPermissions }: {
  children: React.ReactNode;
  initialUser: CrmUser;
  initialPermissions: ResolvedPermissions;
}) {
  const [user, setUser] = useState<CrmUser>(initialUser);
  const [permissions, setPermissions] = useState<ResolvedPermissions>(initialPermissions);
  const [sessionValid, setSessionValid] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session && session.user.id !== initialUser.id)) {
        closeEmailDatabases();
        setSessionValid(false);
        // A full navigation also drops every component and the old router cache.
        window.location.replace(session ? "/dashboard" : "/login");
      }
    });
    return () => subscription.unsubscribe();
  }, [initialUser.id]);

  const can = useCallback(
    (module: CrmModule, action: CrmAction = "view") =>
      permissions[module]?.includes(action) ?? false,
    [permissions]
  );

  const value = useMemo(
    () => ({ user, setUser, permissions, setPermissions, can }),
    [user, permissions, can]
  );

  return <CrmContext.Provider value={value}>{sessionValid ? children : null}</CrmContext.Provider>;
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
