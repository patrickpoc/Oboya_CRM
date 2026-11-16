import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Cookie-backed, user-scoped client (anon key + the user's JWT). Every CRM read
 * and write goes through it so RLS decides visibility (AGENTS.md rule 7).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll is a no-op when called from a Server Component; the proxy
          // refreshes the session cookies on the next request.
        }
      },
    },
  });
}

export type CrmSupabaseClient = Awaited<ReturnType<typeof createClient>>;
