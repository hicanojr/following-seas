import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./env";

/**
 * Server Supabase client bound to the request cookies, or null when Supabase
 * is not configured. Uses the anon key so Row Level Security applies.
 * Never use the service role key here.
 */
export async function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
