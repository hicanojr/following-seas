import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * The request's Supabase client (anon key, so RLS applies) and user, or a
 * response to return instead: 503 when Supabase is not configured, 401 when signed out.
 */
export async function requireUser(): Promise<
  { supabase: SupabaseClient; user: User; response?: never } | { response: NextResponse }
> {
  const supabase = await createClient();
  if (!supabase) {
    return { response: jsonError(503, "missing_config", "Supabase is not configured on this server.") };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { response: jsonError(401, "unauthorized", "Sign in to continue.") };
  }
  return { supabase, user: data.user };
}

/**
 * Append a row to audit_log for something the person did themselves.
 * A failed audit write is logged but never undoes the person's change.
 */
export async function auditUserAction(
  supabase: SupabaseClient,
  entry: { action: string; entityTable: string; entityId: string | null; details?: Record<string, unknown> },
) {
  const { error } = await supabase.from("audit_log").insert({
    actor: "user",
    action: entry.action,
    entity_table: entry.entityTable,
    entity_id: entry.entityId,
    details: entry.details ?? {},
  });
  if (error) console.error("audit_log insert failed", entry.action, error.message);
}
