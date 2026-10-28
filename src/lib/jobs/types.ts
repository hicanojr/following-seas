/**
 * Shared shapes for Phase 2. The Search agent produces NormalizedJob rows;
 * the Scoring agent consumes JobRow + ProfileRow and produces ScoreResult.
 * Column names match supabase/migrations/0001_init.sql.
 */

export const JOB_SOURCES = ["indeed", "ziprecruiter", "glassdoor", "google", "linkedin", "usajobs", "manual"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

/** Boards the JobSpy worker searches. The app does not run these, and JobSpy never searches LinkedIn. */
export const JOBSPY_SOURCES = ["indeed", "ziprecruiter", "glassdoor", "google"] as const;
export type JobSpySource = (typeof JOBSPY_SOURCES)[number];

const JOBSPY_LABEL: Record<JobSpySource, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  glassdoor: "Glassdoor",
  google: "Google Jobs",
};

export function isJobSpySource(source: string): source is JobSpySource {
  return (JOBSPY_SOURCES as readonly string[]).includes(source);
}

export function jobSpySourceLabel(source: JobSpySource): string {
  return JOBSPY_LABEL[source];
}

export type EasyApply = "yes" | "no" | "unknown";

/** A posting as the Search agent hands it over, before it has a database id. */
export interface NormalizedJob {
  source: JobSource;
  external_id: string | null;
  url: string | null;
  title: string;
  company: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_text: string | null;
  description: string | null;
  requirements: string[];
  easy_apply: EasyApply;
  posted_at: string | null;
}

export interface JobRow extends NormalizedJob {
  id: string;
  user_id: string;
  dedupe_key: string;
}

export interface ProfileRow {
  id: string;
  user_id: string;
  name: string;
  target_titles: string[];
  locations: string[];
  min_base_pay: number | null;
  must_haves: string[];
  deal_breakers: string[];
  plus_factors: string[];
  scoring_rubric: Record<string, unknown>;
}

/** Matches the scores table. */
export interface ScoreResult {
  fit: number;
  reason: string;
  requirements_met: string[];
  gaps: string[];
  unmet_must_haves: string[];
  deal_breaker_hit: string | null;
}
