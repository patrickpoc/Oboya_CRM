import type { User } from "@supabase/supabase-js";
import type { CrmSupabaseClient } from "@/lib/supabase/server";

/**
 * A Casdoor back-channel logout records the time of the logout against the
 * Casdoor `sub`. A Supabase session created before that instant is no longer
 * accepted, even though Supabase access tokens are stateless.
 */
export async function isCasdoorSessionRevoked(
  supabase: CrmSupabaseClient,
  user: User
): Promise<boolean> {
  const metadata = user.user_metadata ?? {};
  const sub = typeof metadata.casdoor_sub === "string" ? metadata.casdoor_sub : "";
  if (!sub) return false;

  const authAt = Number(metadata.casdoor_auth_at);
  if (!Number.isFinite(authAt) || authAt <= 0) return false;

  const { data, error } = await supabase
    .from("crm_casdoor_sessions")
    .select("logout_at")
    .eq("sub", sub)
    .maybeSingle<{ logout_at: string | null }>();
  if (error || !data?.logout_at) return false;

  const loggedOutAt = Date.parse(data.logout_at);
  return Number.isFinite(loggedOutAt) && loggedOutAt > authAt;
}
