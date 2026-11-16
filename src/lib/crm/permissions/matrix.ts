import type { CrmAction, CrmModule, CrmUser, ResolvedPermissions } from "@/lib/crm/types";
import { canAccessUser, resolvePermissions, userActions } from "./access-resolve";
import { getAccessSnapshot } from "./access-store";

/*
 * CLIENT-SIDE helpers over the hydrated snapshot (see access-store). Server
 * code must not use these: it calls ./access-resolve with `session.matrix`.
 */

type UserLike = Pick<CrmUser, "role" | "permissionOverrides"> | null | undefined;

export function getPermissions(role: string, module: CrmModule): CrmAction[] {
  return userActions({ role, permissionOverrides: {} }, module, getAccessSnapshot().matrix);
}

export function canAccessUserClient(
  user: UserLike,
  module: CrmModule,
  action: CrmAction = "view"
): boolean {
  return canAccessUser(user, module, action, getAccessSnapshot().matrix);
}

export function resolvePermissionsClient(user: UserLike): ResolvedPermissions {
  return resolvePermissions(user, getAccessSnapshot().matrix);
}
