/**
 * A SearchStore for the daily cron, which runs with the service role key.
 *
 * WHY THIS EXISTS: `supabaseSearchStore` in src/lib/search/store.ts relies on
 * Row Level Security to limit reads and writes to the signed-in person; several
 * of its queries (getQuery, existingDedupeKeys, updateQueryStats) do not filter
 * by user_id themselves. The service role bypasses RLS, so passing it there
 * would let one person's dedupe check see another person's jobs.
 *
 * This adapter is the same store with an explicit `.eq("user_id", userId)` on
 * every read and update, and `user_id: userId` on every insert. It is tested in
 * __tests__/scoped-search-store.test.ts. Use it only from the cron route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileNoiseRecord, QueryRecord, SearchStore } from "@/lib/search/store";

const KEY_CHUNK = 100;
const INSERT_CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function userScopedSearchStore(supabase: SupabaseClient, userId: string): SearchStore {
  if (!userId) throw new Error("userScopedSearchStore needs a user id.");

  const own = (id: string) => {
    if (id !== userId) throw new Error("This store only writes for its own user.");
  };

  return {
    async getQuery(queryId) {
      const { data, error } = await supabase
        .from("queries")
        .select("id, profile_id, source, query_text, filters, retired, runs, total_hits")
        .eq("id", queryId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the query: ${error.message}`);
      return (data as QueryRecord | null) ?? null;
    },

    async getProfile(profileId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, locations, scoring_rubric")
        .eq("id", profileId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`Could not load the profile: ${error.message}`);
      return (data as ProfileNoiseRecord | null) ?? null;
    },

    async existingDedupeKeys(keys) {
      const found = new Set<string>();
      for (const part of chunks([...new Set(keys)], KEY_CHUNK)) {
        const { data, error } = await supabase
          .from("jobs")
          .select("dedupe_key")
          .eq("user_id", userId)
          .in("dedupe_key", part);
        if (error) throw new Error(`Could not check for duplicates: ${error.message}`);
        for (const row of (data ?? []) as { dedupe_key: string }[]) found.add(row.dedupe_key);
      }
      return found;
    },

    async insertJobs(forUser, jobs) {
      own(forUser);
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
      const { error } = await supabase.from("queries").update(patch).eq("id", queryId).eq("user_id", userId);
      if (error) throw new Error(`Could not update the query: ${error.message}`);
    },

    async startRun(forUser, agent, input) {
      own(forUser);
      const { data, error } = await supabase
        .from("agent_runs")
        .insert({ user_id: userId, agent, input: { ...input, trigger: "cron" }, status: "running" })
        .select("id")
        .single();
      if (error) return null;
      return (data as { id: string }).id;
    },

    async finishRun(runId, status, output, error = null) {
      if (!runId) return;
      await supabase
        .from("agent_runs")
        .update({ status, output, error, finished_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("user_id", userId);
    },

    async audit(forUser, action, details) {
      own(forUser);
      await supabase
        .from("audit_log")
        .insert({ user_id: userId, actor: "search", action, entity_table: "jobs", details: { ...details, trigger: "cron" } });
    },
  };
}
