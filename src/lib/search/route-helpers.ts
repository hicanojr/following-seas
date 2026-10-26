import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { GateError } from "@/lib/gates";
import { ImportFormatError } from "@/lib/importers";
import { createClient } from "@/lib/supabase/server";
import { SearchError, type SearchEnv } from "./index";

/** Server-only env for search providers. Never expose these to the browser. */
export function searchEnv(): SearchEnv {
  return {
    APIFY_TOKEN: process.env.APIFY_TOKEN || undefined,
    USAJOBS_API_KEY: process.env.USAJOBS_API_KEY || undefined,
    USAJOBS_USER_AGENT: process.env.USAJOBS_USER_AGENT || undefined,
  };
}

export function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * The request's Supabase client and user, or a response to return instead:
 * 503 when Supabase is not configured, 401 when signed out.
 */
export async function requireUser(): Promise<
  { supabase: SupabaseClient; user: User; response?: never } | { response: NextResponse }
> {
  const supabase = await createClient();
  if (!supabase) {
    return {
      response: jsonError(
        503,
        "missing_config",
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      ),
    };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { response: jsonError(401, "unauthorized", "Sign in to continue.") };
  }
  return { supabase, user: data.user };
}

/** Known errors become clear responses; anything else is a 500 without internals. */
export function errorResponse(err: unknown) {
  if (err instanceof SearchError) return jsonError(err.status, err.code, err.message);
  if (err instanceof ImportFormatError) return jsonError(400, "bad_input", err.message);
  if (err instanceof GateError) return jsonError(403, "gate", err.message);
  console.error("search route error", err);
  return jsonError(500, "server_error", "Something went wrong. Try again.");
}
