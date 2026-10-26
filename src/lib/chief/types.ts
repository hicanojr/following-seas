/**
 * Shapes shared by the Chief of Staff agent, its tools, the API route, and
 * the chat UI. The services interface is injected so tests run without a
 * database or the network.
 */

import type { AllowedAction } from "@/lib/gates";
import type { JobSource } from "@/lib/jobs/types";
import type { ApplicationStatus } from "@/lib/tracker/types";

export type EasyApplyLabel = "Yes" | "No" | "Unknown";

export const JOB_FILTERS = ["to_review", "kept", "skipped", "screened_out"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

export interface ProfileSummary {
  id: string;
  name: string;
  target_titles: string[];
  locations: string[];
  min_base_pay: number | null;
  must_haves: string[];
  deal_breakers: string[];
}

export interface QuerySummary {
  id: string;
  profile_id: string;
  source: JobSource;
  query_text: string;
  quality: string;
  retired: boolean;
  runs: number;
  last_run_at: string | null;
}

/** A scored job as the Chief shows it: always with link and Easy Apply status. */
export interface ChiefJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  fit: number;
  reason: string | null;
  gaps: string[];
  unmet_must_haves: string[];
  deal_breaker: string | null;
  easy_apply: EasyApplyLabel;
  url: string | null;
}

export interface SearchRunSummary {
  source: JobSource;
  received: number;
  imported: number;
  duplicates: number;
  noise: number;
}

export interface ScoreRunSummary {
  scored: number;
  screenedOut: number;
  failed: number;
}

export interface TrackerSummary {
  counts: Record<ApplicationStatus, number>;
  /** Most recent applications the person made, newest first. */
  recentlyApplied: { company: string; title: string; applied_on: string | null; url: string | null; status: ApplicationStatus }[];
}

export interface FollowUpItem {
  application_id: string;
  company: string | null;
  title: string;
  status: ApplicationStatus;
  applied_on: string | null;
  follow_up_on: string | null;
  url: string | null;
}

export interface FollowUpSummary {
  overdue: FollowUpItem[];
  dueToday: FollowUpItem[];
  upcoming: FollowUpItem[];
}

export interface JobForDraft {
  id: string;
  title: string;
  company: string | null;
  url: string | null;
  application: { status: ApplicationStatus; applied_on: string | null } | null;
}

/** A row on the running list of applications: company, title, date, link. */
export interface AppliedEntry {
  company: string | null;
  title: string;
  applied_on: string;
  url: string | null;
}

/**
 * The specialist services the Chief dispatches. Each is a thin wrapper over
 * an existing service (search, scoring, tracker) or a read-only query. There
 * is deliberately no method that writes decisions, submits applications,
 * uses Easy Apply, sends anything, or logs in anywhere.
 */
export interface ChiefServices {
  listProfiles(): Promise<ProfileSummary[]>;
  listQueries(profileId: string): Promise<QuerySummary[]>;
  getQuery(queryId: string): Promise<QuerySummary | null>;
  runSearch(queryId: string): Promise<SearchRunSummary>;
  scoreJobs(profileId: string, jobIds?: string[]): Promise<ScoreRunSummary>;
  listJobs(profileId: string, filter: JobFilter, minFit?: number): Promise<ChiefJob[]>;
  trackerSummary(): Promise<TrackerSummary>;
  followUps(today: string): Promise<FollowUpSummary>;
  getJobForDraft(jobId: string): Promise<JobForDraft | null>;
  markApplied(jobId: string, appliedOn: string, today: string): Promise<AppliedEntry>;
}

/** One tool call, for agent_runs (every call) and audit_log (side effects). */
export interface ToolCallRecord {
  tool: string;
  action: AllowedAction | null;
  input: unknown;
  ok: boolean;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface ChiefLogger {
  toolCall(record: ToolCallRecord): Promise<void>;
}

export interface ChiefDraft {
  kind: "follow_up_email" | "thank_you";
  jobId: string;
  label: string;
  text: string;
}

/** What one chat turn returns to the route and the UI. */
export interface ChiefReply {
  reply: string;
  jobs: ChiefJob[];
  drafts: ChiefDraft[];
  toolCalls: { name: string; ok: boolean }[];
  stopped: "done" | "max_rounds" | "timeout" | "refusal" | "error";
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
