/**
 * Reads and writes for the Brief.
 *
 * Every query here filters by an explicit `userId`, on top of Row Level
 * Security. That matters because the daily cron passes a service role client,
 * which bypasses RLS: the `.eq("user_id", userId)` filters are then the only
 * thing keeping one person's rows out of another person's brief. Do not add a
 * query here without that filter.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryHealthInput } from "./query-health";
import type {
  Brief,
  BriefApplicationRow,
  BriefDecisionRow,
  BriefInput,
  BriefJobRow,
  BriefProfileRow,
  BriefScoreRow,
} from "./build";

/** Rows read per table. A person's search stays well under these. */
export const JOB_LIMIT = 1000;
export const SCORE_LIMIT = 2000;
export const DECISION_LIMIT = 2000;

export interface StoredBrief {
  id: string;
  brief_date: string;
  since: string;
  generated_at: string;
  content: Brief;
}

function fail(what: string, message: string): never {
  throw new Error(`Could not load ${what}: ${message}`);
}

export async function loadBriefInput(
  supabase: SupabaseClient,
  userId: string,
  window: { now: string; today: string; since: string },
): Promise<BriefInput> {
  const profiles = await supabase
    .from("profiles")
    .select("id, name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("name");
  if (profiles.error) fail("profiles", profiles.error.message);

  const [jobs, scores, decisions, applications, queries] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, company, location, url, source, easy_apply, created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(JOB_LIMIT),
    supabase
      .from("scores")
      .select("job_id, profile_id, fit, reason, unmet_must_haves, deal_breaker_hit, scored_at")
      .eq("user_id", userId)
      .order("scored_at", { ascending: false })
      .limit(SCORE_LIMIT),
    supabase
      .from("decisions")
      .select("job_id, profile_id, decision, reason")
      .eq("user_id", userId)
      .order("decided_at", { ascending: false })
      .limit(DECISION_LIMIT),
    supabase
      .from("applications")
      .select("id, job_id, status, applied_on, follow_up_on, job:jobs!inner(title, company, url)")
      .eq("user_id", userId),
    supabase
      .from("queries")
      .select("id, profile_id, source, query_text, quality, runs, relevant_hits, total_hits, retired, notes")
      .eq("user_id", userId),
  ]);
  if (jobs.error) fail("jobs", jobs.error.message);
  if (scores.error) fail("scores", scores.error.message);
  if (decisions.error) fail("decisions", decisions.error.message);
  if (applications.error) fail("applications", applications.error.message);
  if (queries.error) fail("queries", queries.error.message);

  return {
    ...window,
    profiles: (profiles.data ?? []) as BriefProfileRow[],
    jobs: (jobs.data ?? []) as BriefJobRow[],
    scores: (scores.data ?? []) as BriefScoreRow[],
    decisions: (decisions.data ?? []) as BriefDecisionRow[],
    applications: (applications.data ?? []) as unknown as BriefApplicationRow[],
    queries: (queries.data ?? []) as QueryHealthInput[],
  };
}

/** The person's most recent stored brief, or null. */
export async function latestBrief(supabase: SupabaseClient, userId: string): Promise<StoredBrief | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("id, brief_date, since, generated_at, content")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("the latest brief", error.message);
  return (data as StoredBrief | null) ?? null;
}

/** Save today's brief; a second run on the same day replaces it. */
export async function saveBrief(supabase: SupabaseClient, userId: string, brief: Brief): Promise<void> {
  const { error } = await supabase.from("briefs").upsert(
    {
      user_id: userId,
      brief_date: brief.today,
      since: brief.since,
      generated_at: brief.generatedAt,
      content: brief,
    },
    { onConflict: "user_id,brief_date" },
  );
  if (error) throw new Error(`Could not save the brief: ${error.message}`);
}

/** Whether the person wants the daily run. Defaults to on when they never chose. */
export async function dailyRunEnabled(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("brief_settings")
    .select("daily_run")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("brief settings", error.message);
  return data ? data.daily_run !== false : true;
}
