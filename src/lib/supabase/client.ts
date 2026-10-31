"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./env";

/**
 * Browser Supabase client, or null when Supabase is not configured. It uses the
 * PKCE flow, so a sign-in link only works in the browser that asked for it.
 * Sign-in from another browser (the iPhone mail app) uses the emailed code
 * typed into the login page instead; never install a session from a URL.
 */
export function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.anonKey);
}
