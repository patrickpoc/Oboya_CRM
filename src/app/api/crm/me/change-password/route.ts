import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clearMustChangePassword } from "@/lib/crm/server/admin-only/auth-metadata";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { getSupabaseEnv } from "@/lib/supabase/env";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
});

/**
 * Checks the current password on a throwaway, non-persisting client so the
 * cookie-bound session (and its AAL2 level) is never replaced.
 */
async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  const { url, anonKey } = getSupabaseEnv();
  const probe = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  // "local" revokes only this probe session; the default "global" would sign
  // the user out everywhere.
  if (!error) await probe.auth.signOut({ scope: "local" });
  return !error;
}

export async function POST(request: Request) {
  const guard = await crmGuard(undefined, "view", { allowPasswordChangePending: true });
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { currentPassword, password } = parsed.data;
  if (currentPassword === password) {
    return NextResponse.json({ error: "same_password" }, { status: 400 });
  }

  // 5 attempts per 15 minutes per user. Fails closed if the RPC is missing.
  const { data: allowed, error: limitError } = await guard.supabase.rpc("crm_rate_limit_hit", {
    p_bucket: "change_password",
    p_max: 5,
    p_window_seconds: 900,
  });
  if (limitError) {
    console.error("crm_rate_limit_hit failed:", limitError.message);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  if (allowed !== true) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!(await verifyCurrentPassword(guard.user.email, currentPassword))) {
    return NextResponse.json({ error: "wrong_current_password" }, { status: 400 });
  }

  const { error } = await guard.supabase.auth.updateUser({ password });
  if (error) {
    console.error("Password update failed:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 400 });
  }

  if (guard.user.mustChangePassword) {
    try {
      await clearMustChangePassword(guard.user.id);
    } catch (clearError) {
      console.error("Failed to clear must_change_password:", clearError);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
