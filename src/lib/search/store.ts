/**
 * Persistence for the Search agent. The service talks to this interface so it
 * can be tested without a database; `supabaseSearchStore` is the real one.
 *
 * The Supabase client must be the per-request server client (anon key plus the
 * user's session), so Row Level Security limits every read and write to the
 * signed-in user. Never pass a service role client here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobSource, NormalizedJob } from "@/lib/jobs/types";

export interface QueryRecord {
  id: string;
  profile_id: string;
  source: JobSource;
  query_text: string;
  filters: Record<string, unknown>;
  retired: boolean;
  runs: number;
  total_hits: number | null;
}

export interface ProfileNoiseRecord {
  id: string;
  locations: string[];
  scoring_rubric: Record<string, unknown>;
}

export type RunStatus = "running" | "succeeded" | "failed";

export interface SearchStore {
  getQuery(queryId: string): Promise<QueryRecord | null>;
  getProfile(profileId: string): Promise<ProfileNoiseRecord | null>;
  /** Which of these dedupe keys the user already has (soft-deleted rows included). */
  existingDedupeKeys(keys: string[]): Promise<Set<string>>;
  /** Insert new jobs; rows whose key already exists are ignored. Returns the dedupe keys inserted. */
  insertJobs(userId: string, jobs: NormalizedJob[]): Promise<Set<string>>;
  updateQueryStats(
    queryId: string,
    patch: { runs: number; total_hits: number; last_run_at: string },
  ): Promise<void>;
  startRun(userId: string, agent: string, input: Record<string, unknown>): Promise<string | null>;
  finishRun(
    runId: string | null,
    status: RunStatus,
    output: Record<string, unknown> | null,
    error?: string | null,
  ): Promise<void>;
  audit(userId: string, action: string, details: Record<string, unknown>): Promise<void>;
}

/** PostgREST `in` filters go in the URL, so look keys up in chunks. */
const KEY_CHUNK = 100;
const INSERT_CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function supabaseSearchStore(supabase: SupabaseClient): SearchStore {
  return {
    async getQuery(queryId) {
      const { data, error } = await supabase
        .from("queries")
        .select("id, profile_id, source, query_text, filters, retired, runs, total_hits")
        .eq("id", queryId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the query: ${error.message}`);
      return (data as QueryRecord | null) ?? null;
    },

    async getProfile(profileId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, locations, scoring_rubric")
        .eq("id", profileId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`Could not load the profile: ${error.message}`);
      return (data as ProfileNoiseRecord | null) ?? null;
    },

    async existingDedupeKeys(keys) {
      const found = new Set<string>();
      for (const part of chunks([...new Set(keys)], KEY_CHUNK)) {
        const { data, error } = await supabase.from("jobs").select("dedupe_key").in("dedupe_key", part);
        if (error) throw new Error(`Could not check for duplicates: ${error.message}`);
        for (const row of (data ?? []) as { dedupe_key: string }[]) found.add(row.dedupe_key);
      }
      return found;
    },

    async insertJobs(userId, jobs) {
      const inserted = new Set<string>();
      for (const part of chunks(jobs, INSERT_CHUNK)) {
        const rows = part.map((j) => ({ ...j, user_id: userId }));
        const { data, error } = await supabase
          .from("jobs")
          .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
          .select("dedupe_key");
        if (error) throw new Error(`Could not save jobs: ${error.message}`);
        for (const row of (data ?? []) as { dedupe_key: string }[]) inserted.add(row.dedupe_key);
      }
      return inserted;
    },

    async updateQueryStats(queryId, patch) {
      const { error } = await supabase.from("queries").update(patch).eq("id", queryId);
      if (error) throw new Error(`Could not update the query: ${error.message}`);
    },

    async startRun(userId, agent, input) {
      const { data, error } = await supabase
        .from("agent_runs")
        .insert({ user_id: userId, agent, input, status: "running" })
        .select("id")
        .single();
      // A failed run log must not block the work itself.
      if (error) return null;
      return (data as { id: string }).id;
    },

    async finishRun(runId, status, output, error = null) {
      if (!runId) return;
      await supabase
        .from("agent_runs")
        .update({ status, output, error, finished_at: new Date().toISOString() })
        .eq("id", runId);
    },

    async audit(userId, action, details) {
      await supabase
        .from("audit_log")
        .insert({ user_id: userId, actor: "search", action, entity_table: "jobs", details });
    },
  };
}
