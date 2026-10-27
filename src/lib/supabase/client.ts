"use client";

import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./env";

/** Browser Supabase client, or null when Supabase is not configured. */
export function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.anonKey);
}

/**
 * Client used only to request the sign-in email. It uses the implicit flow, so
 * the link returns tokens in the URL hash instead of a PKCE code. A PKCE code
 * can only be exchanged in the browser that asked for the email, and on iPhone
 * the mail app often opens the link somewhere else. /auth/confirm turns the
 * tokens into the normal cookie session.
 */
export function createEmailLinkClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createSupabaseClient(config.url, config.anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
