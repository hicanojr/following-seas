/**
 * The daily run for one person: run their saved LinkedIn and USAJobs queries,
 * score what is new (only when scoring is configured), and store the Brief.
 *
 * Called by the cron route with a service role client, which bypasses Row
 * Level Security. Every query here therefore filters by the explicit userId,
 * and the Search agent is given `userScopedSearchStore`, never the RLS-based
 * store. Indeed, ZipRecruiter, Glassdoor, and Google are run by the JobSpy
 * worker, not here.
 *
 * Nothing here applies, uses Easy Apply, sends email or messages, or notifies
 * anyone. The brief is stored for the person to read in the app.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAllowed } from "@/lib/gates";
import { isJobSpySource } from "@/lib/jobs/types";
import type { SearchDeps, SearchEnv, SearchSummary } from "@/lib/search/service";
import type { ScoreJobsDeps, ScoreJobsInput, ScoreJobsOutcome } from "@/lib/scoring/service";
import { MAX_JOBS_PER_RUN } from "@/lib/scoring/service";
import { buildBrief, briefWindowStart, type Brief } from "./build";
import { dailyRunEnabled, latestBrief, loadBriefInput, saveBrief } from "./load";
import { userScopedSearchStore } from "./scoped-search-store";

export const BRIEF_AGENT = "brief";
export const DEFAULT_DAILY_SEARCH_CAP = 10;
export const MAX_DAILY_SEARCH_CAP = 50;
/** Sources the daily run may search. JobSpy boards are run by the worker, not here. */
export const SCHEDULED_SOURCES = ["linkedin", "usajobs"] as const;

/** DAILY_SEARCH_CAP from the environment, or the default; clamped to 0..50. */
export function dailySearchCap(raw: string | undefined | null): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_SEARCH_CAP;
  return Math.min(MAX_DAILY_SEARCH_CAP, Math.max(0, Math.floor(n)));
}

export interface PlannableQuery {
  id: string;
  profile_id: string;
  source: string;
  query_text?: string;
  retired: boolean;
  quality?: string;
  last_run_at: string | null;
}

export interface SearchPlan<Q extends PlannableQuery> {
  run: Q[];
  skipped: { queryId: string; reason: string }[];
}

/**
 * Which saved queries to run today. Retired queries, noise queries, deleted
 * profiles, import-only sources, and sources without keys are skipped. The rest
 * run stalest first, up to the cap less what already ran today.
 */
export function planDailySearches<Q extends PlannableQuery>(
  queries: readonly Q[],
  opts: {
    cap: number;
    alreadyRunToday: number;
    activeProfileIds: ReadonlySet<string>;
    configured: { linkedin: boolean; usajobs: boolean };
  },
): SearchPlan<Q> {
  const skipped: SearchPlan<Q>["skipped"] = [];
  const eligible: Q[] = [];
  for (const q of queries) {
    if (q.retired) continue;
    if (!opts.activeProfileIds.has(q.profile_id)) continue;
    if (isJobSpySource(q.source)) {
      skipped.push({ queryId: q.id, reason: `${q.source} is run by the JobSpy worker` });
      continue;
    }
    if (q.source !== "linkedin" && q.source !== "usajobs") {
      skipped.push({ queryId: q.id, reason: `${q.source} is import only` });
      continue;
    }
    if (q.quality === "noise") {
      skipped.push({ queryId: q.id, reason: "marked noise" });
      continue;
    }
    if (!opts.configured[q.source]) {
      skipped.push({ queryId: q.id, reason: `${q.source} is not configured` });
      continue;
    }
    eligible.push(q);
  }

  const time = (q: Q) => (q.last_run_at ? Date.parse(q.last_run_at) : -Infinity);
  eligible.sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));

  const remaining = Math.max(0, opts.cap - Math.max(0, opts.alreadyRunToday));
  for (const q of eligible.slice(remaining)) skipped.push({ queryId: q.id, reason: "daily search cap reached" });
  return { run: eligible.slice(0, remaining), skipped };
}

/** Midnight UTC of `now`, as an ISO timestamp. */
export function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export interface DailyRunDeps {
  /** Service role client. Every query must filter by userId. */
  supabase: SupabaseClient;
  now: () => Date;
  searchEnv: SearchEnv;
  cap: number;
  runSearch: (args: { userId: string; profileId?: string | null; queryId: string }, deps: SearchDeps) => Promise<SearchSummary>;
  /** Null when ANTHROPIC_API_KEY is not set: then nothing is scored. */
  scoring: {
    scoreJobs: (input: ScoreJobsInput, deps: ScoreJobsDeps) => Promise<ScoreJobsOutcome>;
    client: ScoreJobsDeps["client"];
    model?: string;
  } | null;
}

export interface DailyRunResult {
  userId: string;
  status: "skipped" | "succeeded" | "failed";
  reason?: string;
  searches: { queryId: string; ok: boolean; imported?: number; error?: string }[];
  skippedQueries: { queryId: string; reason: string }[];
  scored: number;
  scoringErrors: { profileId: string; error: string }[];
  briefSaved: boolean;
  headline?: string;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runDailyForUser(userId: string, deps: DailyRunDeps): Promise<DailyRunResult> {
  const { supabase } = deps;
  const result: DailyRunResult = {
    userId,
    status: "succeeded",
    searches: [],
    skippedQueries: [],
    scored: 0,
    scoringErrors: [],
    briefSaved: false,
  };

  if (!(await dailyRunEnabled(supabase, userId))) {
    return { ...result, status: "skipped", reason: "daily run turned off" };
  }

  const startedAt = deps.now();
  const { data: run } = await supabase
    .from("agent_runs")
    .insert({
      user_id: userId,
      agent: BRIEF_AGENT,
      status: "running",
      input: { kind: "daily", trigger: "cron", cap: deps.cap, scoring: Boolean(deps.scoring) },
    })
    .select("id")
    .single();
  const runId: string | null = (run as { id: string } | null)?.id ?? null;

  try {
    // 1. Searches.
    const profiles = await supabase.from("profiles").select("id").eq("user_id", userId).is("deleted_at", null);
    if (profiles.error) throw new Error(`Could not load profiles: ${profiles.error.message}`);
    const activeProfileIds = new Set((profiles.data ?? []).map((p: { id: string }) => p.id));

    const queries = await supabase
      .from("queries")
      .select("id, profile_id, source, query_text, retired, quality, last_run_at")
      .eq("user_id", userId)
      .eq("retired", false)
      .in("source", [...SCHEDULED_SOURCES]);
    if (queries.error) throw new Error(`Could not load queries: ${queries.error.message}`);

    const ranToday = await supabase
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("agent", "search")
      .contains("input", { kind: "search" })
      .gte("started_at", startOfUtcDay(startedAt));
    if (ranToday.error) throw new Error(`Could not count today's searches: ${ranToday.error.message}`);

    const plan = planDailySearches((queries.data ?? []) as PlannableQuery[], {
      cap: deps.cap,
      alreadyRunToday: ranToday.count ?? 0,
      activeProfileIds,
      configured: {
        linkedin: Boolean(deps.searchEnv.APIFY_TOKEN),
        usajobs: Boolean(deps.searchEnv.USAJOBS_API_KEY && deps.searchEnv.USAJOBS_USER_AGENT),
      },
    });
    result.skippedQueries = plan.skipped;

    if (plan.run.length > 0) assertAllowed("search");
    const store = userScopedSearchStore(supabase, userId);
    for (const q of plan.run) {
      try {
        // runSearch checks the gate again, refuses retired and import-only
        // queries, and clamps LinkedIn to 25..50 results per run.
        const summary = await deps.runSearch(
          { userId, profileId: q.profile_id, queryId: q.id },
          { store, env: deps.searchEnv, now: deps.now },
        );
        result.searches.push({ queryId: q.id, ok: true, imported: summary.imported });
      } catch (err) {
        result.searches.push({ queryId: q.id, ok: false, error: message(err) });
      }
    }

    // 2. Scoring of new jobs, only with a key.
    const previous = await latestBrief(supabase, userId);
    const since = briefWindowStart(previous, startedAt);
    if (deps.scoring && activeProfileIds.size > 0) {
      const fresh = await supabase
        .from("jobs")
        .select("id")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_JOBS_PER_RUN * 2);
      if (fresh.error) throw new Error(`Could not load new jobs: ${fresh.error.message}`);
      const freshIds = (fresh.data ?? []).map((j: { id: string }) => j.id);

      for (const profileId of activeProfileIds) {
        if (freshIds.length === 0) break;
        const done = await supabase
          .from("scores")
          .select("job_id")
          .eq("user_id", userId)
          .eq("profile_id", profileId)
          .in("job_id", freshIds);
        if (done.error) throw new Error(`Could not load scores: ${done.error.message}`);
        const scored = new Set((done.data ?? []).map((s: { job_id: string }) => s.job_id));
        const jobIds = freshIds.filter((id) => !scored.has(id)).slice(0, MAX_JOBS_PER_RUN);
        if (jobIds.length === 0) continue;
        try {
          const outcome = await deps.scoring.scoreJobs(
            { userId, profileId, jobIds },
            { supabase, client: deps.scoring.client, model: deps.scoring.model },
          );
          result.scored += outcome.scored;
        } catch (err) {
          result.scoringErrors.push({ profileId, error: message(err) });
        }
      }
    }

    // 3. The brief.
    const now = deps.now();
    const input = await loadBriefInput(supabase, userId, {
      now: now.toISOString(),
      today: now.toISOString().slice(0, 10),
      since,
    });
    const brief: Brief = buildBrief(input);
    await saveBrief(supabase, userId, brief);
    result.briefSaved = true;
    result.headline = brief.headline;
  } catch (err) {
    result.status = "failed";
    result.reason = message(err);
  }

  const output = {
    searches: result.searches.length,
    searchFailures: result.searches.filter((s) => !s.ok).length,
    imported: result.searches.reduce((n, s) => n + (s.imported ?? 0), 0),
    skippedQueries: result.skippedQueries,
    scored: result.scored,
    scoringErrors: result.scoringErrors,
    briefSaved: result.briefSaved,
  };
  if (runId) {
    await supabase
      .from("agent_runs")
      .update({
        status: result.status === "failed" ? "failed" : "succeeded",
        output,
        error: result.reason ?? null,
        finished_at: deps.now().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);
  }
  await supabase.from("audit_log").insert({
    user_id: userId,
    actor: BRIEF_AGENT,
    action: "daily_brief",
    entity_table: "briefs",
    details: { runId, status: result.status, ...output },
  });

  return result;
}

/**
 * People with at least one active profile. Reads only user ids; each person's
 * run then filters by their own id.
 */
export async function usersWithActiveProfiles(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("profiles").select("user_id").is("deleted_at", null).limit(10000);
  if (error) throw new Error(`Could not list users: ${error.message}`);
  return [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))].sort();
}
