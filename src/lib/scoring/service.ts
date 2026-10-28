/**
 * Scoring service: loads a profile, its jobs, and the person's career facts,
 * scores each job, upserts into scores, and logs an agent_runs row.
 *
 * Uses the caller's Supabase client (anon key + session), so Row Level
 * Security limits every read and write to the signed-in person.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAllowed } from "@/lib/gates";
import type { JobRow, ProfileRow, ScoreResult } from "@/lib/jobs/types";
import { isParsedResume, type ParsedResume } from "@/lib/resume/parsed";
import { callScoringModel, mergeResult, screenedOutResult, type ScoringClient } from "./model";
import { decidePrefilter, type RankedJob } from "./prefilter";
import { runPrechecks } from "./prechecks";
import type { CareerFacts } from "./types";

export const AGENT_NAME = "scoring";
/** Jobs scored at once. Small on purpose to stay under rate limits. */
export const DEFAULT_CONCURRENCY = 3;
/** Most jobs scored in one run when no job ids are given. */
export const MAX_JOBS_PER_RUN = 50;

export interface ScoreJobsInput {
  userId: string;
  profileId: string;
  jobIds?: string[];
}

export interface ScoreJobsDeps {
  supabase: SupabaseClient;
  client: ScoringClient;
  model?: string;
  concurrency?: number;
}

export interface ScoreJobsOutcome {
  runId: string | null;
  scored: number;
  screenedOut: number;
  /** Postings below the similarity cutoff. They were not sent to Claude. */
  prefiltered: number;
  /** Postings with no embedding yet, held until the worker embeds them. */
  awaitingEmbedding: number;
  failed: { jobId: string; error: string }[];
}

export class ScoringServiceError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ScoringServiceError";
    this.status = status;
  }
}

/** Run `fn` over `items`, at most `limit` at a time, keeping input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function toProfileRow(row: Record<string, unknown>): ProfileRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name ?? ""),
    target_titles: stringArray(row.target_titles),
    locations: stringArray(row.locations),
    min_base_pay: typeof row.min_base_pay === "number" ? row.min_base_pay : null,
    must_haves: stringArray(row.must_haves),
    deal_breakers: stringArray(row.deal_breakers),
    plus_factors: stringArray(row.plus_factors),
    scoring_rubric:
      row.scoring_rubric && typeof row.scoring_rubric === "object" && !Array.isArray(row.scoring_rubric)
        ? (row.scoring_rubric as Record<string, unknown>)
        : {},
  };
}

export function toJobRow(row: Record<string, unknown>): JobRow {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const easy = row.easy_apply;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    dedupe_key: String(row.dedupe_key ?? ""),
    source: row.source as JobRow["source"],
    external_id: str(row.external_id),
    url: str(row.url),
    title: String(row.title ?? ""),
    company: str(row.company),
    location: str(row.location),
    salary_min: num(row.salary_min),
    salary_max: num(row.salary_max),
    salary_text: str(row.salary_text),
    description: str(row.description),
    requirements: stringArray(row.requirements),
    easy_apply: easy === "yes" || easy === "no" ? easy : "unknown",
    posted_at: str(row.posted_at),
  };
}

/** Score one job. Deal-breaker hits are screened out without a model call. */
export async function scoreOneJob(
  job: JobRow,
  profile: ProfileRow,
  facts: CareerFacts | null,
  deps: Pick<ScoreJobsDeps, "client" | "model">,
  parsed: ParsedResume | null = null,
): Promise<ScoreResult> {
  const pre = runPrechecks(job, profile, facts);
  if (pre.deal_breaker_hit) return screenedOutResult(pre);
  const modelScore = await callScoringModel(job, profile, facts, pre, { client: deps.client, model: deps.model }, parsed);
  return mergeResult(pre, modelScore);
}

export async function scoreJobs(input: ScoreJobsInput, deps: ScoreJobsDeps): Promise<ScoreJobsOutcome> {
  assertAllowed("score");
  const { supabase } = deps;
  const { userId, profileId } = input;

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (profileError) throw new ScoringServiceError(`Could not load the profile: ${profileError.message}`);
  if (!profileData) throw new ScoringServiceError("Profile not found.", 404);
  const profile = toProfileRow(profileData);

  const { data: factsData, error: factsError } = await supabase
    .from("career_facts")
    .select("credentials, experience, other")
    .eq("user_id", userId)
    .maybeSingle();
  if (factsError) throw new ScoringServiceError(`Could not load career facts: ${factsError.message}`);
  const facts: CareerFacts | null = factsData
    ? {
        credentials: String(factsData.credentials ?? ""),
        experience: String(factsData.experience ?? ""),
        other: String(factsData.other ?? ""),
      }
    : null;

  const resume = await loadResumeCache(supabase, userId);
  const parsed = isParsedResume(resume?.parsed) ? resume.parsed : null;
  const selection = resume?.embeddedAt
    ? await selectEmbeddedJobs(supabase, userId, profileId, input.jobIds)
    : {
        jobs: await loadJobs(supabase, userId, profileId, input.jobIds),
        prefiltered: 0,
        awaitingEmbedding: 0,
      };
  const jobs = selection.jobs;

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      user_id: userId,
      agent: AGENT_NAME,
      status: "running",
      input: {
        profileId,
        jobIds: input.jobIds ?? null,
        jobCount: jobs.length,
        model: deps.model ?? null,
        prefilter: resume?.embeddedAt ? "top_25" : "off",
        parsedResume: Boolean(parsed),
      },
    })
    .select("id")
    .single();
  if (runError) throw new ScoringServiceError(`Could not start the scoring run: ${runError.message}`);
  const runId: string | null = run?.id ?? null;

  const outcome: ScoreJobsOutcome = {
    runId,
    scored: 0,
    screenedOut: 0,
    prefiltered: selection.prefiltered,
    awaitingEmbedding: selection.awaitingEmbedding,
    failed: [],
  };

  try {
    await mapWithConcurrency(jobs, deps.concurrency ?? DEFAULT_CONCURRENCY, async (job) => {
      try {
        const result = await scoreOneJob(job, profile, facts, deps, parsed);
        const { error } = await supabase.from("scores").upsert(
          {
            user_id: userId,
            job_id: job.id,
            profile_id: profileId,
            ...result,
            scored_at: new Date().toISOString(),
          },
          { onConflict: "job_id,profile_id" },
        );
        if (error) throw new Error(error.message);
        outcome.scored += 1;
        if (result.deal_breaker_hit) outcome.screenedOut += 1;
      } catch (err) {
        outcome.failed.push({ jobId: job.id, error: err instanceof Error ? err.message : String(err) });
      }
    });
  } finally {
    const status = outcome.failed.length > 0 && outcome.scored === 0 && jobs.length > 0 ? "failed" : "succeeded";
    await supabase
      .from("agent_runs")
      .update({
        status,
        output: {
          scored: outcome.scored,
          screenedOut: outcome.screenedOut,
          prefiltered: outcome.prefiltered,
          awaitingEmbedding: outcome.awaitingEmbedding,
          failed: outcome.failed,
        },
        error: outcome.failed.length ? `${outcome.failed.length} job(s) could not be scored` : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: AGENT_NAME,
      action: "score",
      entity_table: "profiles",
      entity_id: profileId,
      details: {
        runId,
        scored: outcome.scored,
        screenedOut: outcome.screenedOut,
        prefiltered: outcome.prefiltered,
        awaitingEmbedding: outcome.awaitingEmbedding,
        failed: outcome.failed.length,
      },
    });
  }

  return outcome;
}

/** The given jobs, or the profile's not-yet-scored jobs (newest first, capped). */
async function loadJobs(
  supabase: SupabaseClient,
  userId: string,
  profileId: string,
  jobIds: string[] | undefined,
): Promise<JobRow[]> {
  let query = supabase.from("jobs").select("*").eq("user_id", userId).is("deleted_at", null);

  if (jobIds && jobIds.length > 0) {
    query = query.in("id", jobIds);
  } else {
    const { data: scored, error } = await supabase
      .from("scores")
      .select("job_id")
      .eq("user_id", userId)
      .eq("profile_id", profileId);
    if (error) throw new ScoringServiceError(`Could not load existing scores: ${error.message}`);
    const done = (scored ?? []).map((r: { job_id: string }) => r.job_id);
    if (done.length > 0) query = query.not("id", "in", `(${done.join(",")})`);
    query = query.order("created_at", { ascending: false }).limit(MAX_JOBS_PER_RUN);
  }

  const { data, error } = await query;
  if (error) throw new ScoringServiceError(`Could not load jobs: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => toJobRow(row));
}

interface ResumeCache {
  parsed: unknown;
  embeddedAt: string | null;
}

async function loadResumeCache(supabase: SupabaseClient, userId: string): Promise<ResumeCache | null> {
  const { data, error } = await supabase
    .from("resumes")
    .select("parsed, embedded_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ScoringServiceError(`Could not load the resume: ${error.message}`);
  if (!data) return null;
  const embeddedAt = typeof data.embedded_at === "string" && data.embedded_at ? data.embedded_at : null;
  return { parsed: data.parsed, embeddedAt };
}

async function loadSimilarities(supabase: SupabaseClient, userId: string): Promise<RankedJob[]> {
  const { data, error } = await supabase.from("job_resume_similarity").select("job_id, similarity").eq("user_id", userId);
  if (error) throw new ScoringServiceError(`Could not rank postings: ${error.message}`);
  return (data ?? []).flatMap((row: { job_id?: unknown; similarity?: unknown }) => {
    if (typeof row.job_id !== "string" || typeof row.similarity !== "number" || !Number.isFinite(row.similarity)) return [];
    return [{ jobId: row.job_id, similarity: row.similarity }];
  });
}

/** Unscored job ids, or the ids the caller named. */
async function candidateIds(
  supabase: SupabaseClient,
  userId: string,
  profileId: string,
  jobIds: string[] | undefined,
): Promise<string[]> {
  if (jobIds && jobIds.length > 0) return jobIds;
  const { data: jobRows, error: jobError } = await supabase.from("jobs").select("id").eq("user_id", userId).is("deleted_at", null);
  if (jobError) throw new ScoringServiceError(`Could not load jobs: ${jobError.message}`);
  const { data: scored, error: scoreError } = await supabase
    .from("scores")
    .select("job_id")
    .eq("user_id", userId)
    .eq("profile_id", profileId);
  if (scoreError) throw new ScoringServiceError(`Could not load existing scores: ${scoreError.message}`);
  const done = new Set((scored ?? []).map((row: { job_id: string }) => row.job_id));
  return (jobRows ?? []).map((row: { id: string }) => row.id).filter((id) => !done.has(id));
}

/**
 * Top ~25% of the whole library by resume similarity, among the candidates.
 * Postings without a vector wait. Postings below the cutoff are not sent to Claude.
 */
async function selectEmbeddedJobs(
  supabase: SupabaseClient,
  userId: string,
  profileId: string,
  jobIds: string[] | undefined,
): Promise<{ jobs: JobRow[]; prefiltered: number; awaitingEmbedding: number }> {
  const ranked = await loadSimilarities(supabase, userId);
  const decision = decidePrefilter(await candidateIds(supabase, userId, profileId, jobIds), ranked, MAX_JOBS_PER_RUN);
  if (decision.selectedIds.length === 0) {
    return { jobs: [], prefiltered: decision.prefiltered, awaitingEmbedding: decision.awaitingEmbedding };
  }
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("id", decision.selectedIds);
  if (error) throw new ScoringServiceError(`Could not load jobs: ${error.message}`);
  const order = new Map(decision.selectedIds.map((id, index) => [id, index]));
  const jobs = (data ?? [])
    .map((row: Record<string, unknown>) => toJobRow(row))
    .filter((job) => order.has(job.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { jobs, prefiltered: decision.prefiltered, awaitingEmbedding: decision.awaitingEmbedding };
}
