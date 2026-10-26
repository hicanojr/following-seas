import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client with the SERVICE ROLE key. It bypasses Row Level Security.
 *
 * Use it ONLY from src/app/api/cron/daily/route.ts, after the CRON_SECRET check,
 * and only through code that filters every query by an explicit user id
 * (src/lib/brief/daily.ts, load.ts, scoped-search-store.ts, and the scoring
 * service, which already filters by user_id). Never import it from a page, a
 * component, or a route that acts for a signed-in person. A test enforces this.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY or the URL is missing.
 */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
