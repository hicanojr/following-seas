/**
 * The daily Brief. `buildBrief` is a pure function: it takes rows the loader
 * read for one person and returns a structured Brief. No model call, so a
 * brief costs nothing to make. It reports and suggests; it never acts.
 */

import { classifyFollowUps } from "@/lib/tracker/followups";
import { addDays, isIsoDate } from "@/lib/tracker/dates";
import type { ApplicationStatus } from "@/lib/tracker/types";
import { measureThreshold, type DecisionHistoryItem, type ThresholdResult } from "@/lib/shortlist/stats";
import { querySuggestions, type QueryHealth, type QueryHealthInput } from "./query-health";

export const BRIEF_VERSION = 1;
/** Fit at or above this is "worth a look first". */
export const STRONG_FIT = 7;
/** Most job rows shown in each list. */
export const LIST_LIMIT = 10;

export type EasyApply = "yes" | "no" | "unknown";

// ---------------------------------------------------------------------------
// Input rows (column names match the tables)
// ---------------------------------------------------------------------------

export interface BriefProfileRow {
  id: string;
  name: string;
}

export interface BriefJobRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  source: string;
  easy_apply: EasyApply | string;
  created_at: string;
}

export interface BriefScoreRow {
  job_id: string;
  profile_id: string;
  fit: number;
  reason: string | null;
  unmet_must_haves: unknown;
  deal_breaker_hit: string | null;
  scored_at: string;
}

export interface BriefDecisionRow {
  job_id: string;
  profile_id: string;
  decision: "keep" | "skip";
  reason: string | null;
}

export interface BriefApplicationRow {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  applied_on: string | null;
  follow_up_on: string | null;
  job: { title: string; company: string | null; url: string | null } | null;
}

export interface BriefInput {
  /** When this brief is made (ISO timestamp). */
  now: string;
  /** The calendar day the brief is for, YYYY-MM-DD. */
  today: string;
  /** Start of the "new since" window (ISO timestamp). */
  since: string;
  profiles: BriefProfileRow[];
  jobs: BriefJobRow[];
  scores: BriefScoreRow[];
  decisions: BriefDecisionRow[];
  applications: BriefApplicationRow[];
  queries: QueryHealthInput[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface BriefJob {
  jobId: string;
  profileId: string | null;
  profileName: string | null;
  title: string;
  company: string | null;
  location: string | null;
  /** Fit 1 to 10, or null when not scored yet. */
  fit: number | null;
  /** One line. */
  reason: string | null;
  easyApply: EasyApply;
  /** http(s) only, or null. */
  url: string | null;
  unmetMustHaves: string[];
  isNew: boolean;
}

export interface BriefFollowUp {
  applicationId: string;
  title: string;
  company: string | null;
  followUpOn: string;
  url: string | null;
}

export interface BriefQuerySuggestion extends QueryHealth {
  profileName: string | null;
}

export interface BriefShortlist {
  profileId: string;
  profileName: string;
  /** Auto shortlist is always off; a measured threshold is only a suggestion. */
  autoShortlist: "off";
  threshold: ThresholdResult;
}

export interface Brief {
  version: typeof BRIEF_VERSION;
  generatedAt: string;
  today: string;
  since: string;
  headline: string;
  counts: {
    newJobs: number;
    toReview: number;
    strongFit: number;
    unscored: number;
    unmetMustHaves: number;
    screenedOut: number;
    followUpsOverdue: number;
    followUpsDueToday: number;
    followUpsUpcoming: number;
    appliedThisWeek: number;
    querySuggestions: number;
  };
  newJobs: BriefJob[];
  toReview: BriefJob[];
  unmetMustHaves: BriefJob[];
  screenedOut: { count: number; reasons: { reason: string; count: number }[] };
  followUps: { overdue: BriefFollowUp[]; dueToday: BriefFollowUp[]; upcoming: BriefFollowUp[] };
  appliedThisWeek: number;
  querySuggestions: BriefQuerySuggestion[];
  shortlist: BriefShortlist[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Only http(s) links, so a stored URL can never run script. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" && "label" in v ? String(v.label) : null))
    .filter((v): v is string => Boolean(v && v.trim()));
}

/** First sentence or line of a reason, kept short. */
export function oneLine(text: string | null | undefined, max = 140): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const sentence = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  return sentence.length > max ? `${sentence.slice(0, max - 3).trimEnd()}...` : sentence;
}

function easy(value: string): EasyApply {
  return value === "yes" || value === "no" ? value : "unknown";
}

function after(ts: string, since: string): boolean {
  const a = Date.parse(ts);
  const b = Date.parse(since);
  return Number.isFinite(a) && Number.isFinite(b) && a >= b;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Where "new since the last brief" starts. With no earlier brief, the last 24
 * hours. When the latest brief is under a day old, its own window is reused,
 * so reopening the page later the same day shows the same new jobs.
 */
export function briefWindowStart(
  latest: { generated_at: string; since: string } | null,
  now: Date,
): string {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  if (!latest) return dayAgo.toISOString();
  const generated = Date.parse(latest.generated_at);
  if (!Number.isFinite(generated)) return dayAgo.toISOString();
  if (now.getTime() - generated < 86_400_000 && Number.isFinite(Date.parse(latest.since))) {
    return new Date(latest.since).toISOString();
  }
  return new Date(generated).toISOString();
}

export function headlineFor(counts: Brief["counts"]): string {
  const parts: string[] = [];
  if (counts.newJobs > 0) parts.push(`${plural(counts.newJobs, "new job")}`);
  if (counts.strongFit > 0) parts.push(`${counts.strongFit} with fit ${STRONG_FIT}+ to review`);
  else if (counts.toReview > 0) parts.push(`${counts.toReview} to review`);
  const due = counts.followUpsOverdue + counts.followUpsDueToday;
  if (due > 0) parts.push(`${plural(due, "follow-up")} due`);
  if (counts.querySuggestions > 0) parts.push(`${plural(counts.querySuggestions, "query suggestion")}`);
  if (parts.length === 0) return "All quiet. Nothing new and nothing due today.";
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildBrief(input: BriefInput): Brief {
  if (!isIsoDate(input.today)) throw new RangeError(`Not a date: ${input.today}`);

  const profileName = new Map(input.profiles.map((p) => [p.id, p.name]));
  const activeProfiles = new Set(profileName.keys());
  const jobsById = new Map(input.jobs.map((j) => [j.id, j]));

  const decided = new Set(input.decisions.map((d) => `${d.job_id}|${d.profile_id}`));
  const decidedJob = new Set(input.decisions.map((d) => d.job_id));
  const appliedJob = new Set(input.applications.map((a) => a.job_id));

  // Best undecided score per job, among active profiles.
  const scores = input.scores.filter((s) => activeProfiles.has(s.profile_id) && jobsById.has(s.job_id));
  const bestByJob = new Map<string, BriefScoreRow>();
  for (const s of scores) {
    if (decided.has(`${s.job_id}|${s.profile_id}`)) continue;
    const prev = bestByJob.get(s.job_id);
    if (!prev || s.fit > prev.fit) bestByJob.set(s.job_id, s);
  }
  const anyScore = new Set(scores.map((s) => s.job_id));

  const toJob = (job: BriefJobRow, score: BriefScoreRow | undefined): BriefJob => ({
    jobId: job.id,
    profileId: score?.profile_id ?? null,
    profileName: score ? (profileName.get(score.profile_id) ?? null) : null,
    title: job.title,
    company: job.company,
    location: job.location,
    fit: score?.fit ?? null,
    reason: oneLine(score?.deal_breaker_hit ? `Screened out: ${score.deal_breaker_hit}` : score?.reason),
    easyApply: easy(job.easy_apply),
    url: safeUrl(job.url),
    unmetMustHaves: strings(score?.unmet_must_haves),
    isNew: after(job.created_at, input.since),
  });

  const byFitThenNewest = (a: BriefJob, b: BriefJob) =>
    (b.fit ?? 0) - (a.fit ?? 0) ||
    (Number(b.isNew) - Number(a.isNew)) ||
    a.title.localeCompare(b.title);

  // New jobs since the window start.
  const newJobRows = input.jobs.filter((j) => after(j.created_at, input.since));
  const newJobs = newJobRows.map((j) => toJob(j, bestByJob.get(j.id))).sort(byFitThenNewest);

  // To review: scored, undecided for that profile, not screened out, not on the tracker yet.
  const reviewable: BriefJob[] = [];
  const screened: BriefScoreRow[] = [];
  for (const [jobId, score] of bestByJob) {
    if (appliedJob.has(jobId)) continue;
    if (score.deal_breaker_hit) {
      screened.push(score);
      continue;
    }
    reviewable.push(toJob(jobsById.get(jobId)!, score));
  }
  reviewable.sort(byFitThenNewest);
  const strong = reviewable.filter((j) => (j.fit ?? 0) >= STRONG_FIT);
  const unmet = reviewable.filter((j) => j.unmetMustHaves.length > 0);

  // Screened out since the window start, grouped by the deal-breaker hit.
  const screenedNew = screened.filter((s) => after(s.scored_at, input.since));
  const reasonCounts = new Map<string, { reason: string; count: number }>();
  for (const s of screenedNew) {
    const reason = oneLine(s.deal_breaker_hit, 80) ?? "Deal-breaker";
    const key = reason.toLowerCase();
    const row = reasonCounts.get(key);
    if (row) row.count += 1;
    else reasonCounts.set(key, { reason, count: 1 });
  }

  // Follow-ups, using the tracker's own rules.
  const groups = classifyFollowUps(input.applications, input.today);
  const toFollowUp = (a: BriefApplicationRow): BriefFollowUp => ({
    applicationId: a.id,
    title: a.job?.title ?? "Untitled job",
    company: a.job?.company ?? null,
    followUpOn: a.follow_up_on ?? "",
    url: safeUrl(a.job?.url),
  });

  // Applied in the last 7 days, today included.
  const weekStart = addDays(input.today, -6);
  const appliedThisWeek = input.applications.filter(
    (a) => isIsoDate(a.applied_on) && a.applied_on >= weekStart && a.applied_on <= input.today,
  ).length;

  const suggestions: BriefQuerySuggestion[] = querySuggestions(
    input.queries.filter((q) => activeProfiles.has(q.profile_id)),
  ).map((h) => ({ ...h, profileName: profileName.get(h.profileId) ?? null }));

  // Auto shortlist status per profile. Stays off; the threshold is a suggestion.
  const fitFor = new Map(input.scores.map((s) => [`${s.job_id}|${s.profile_id}`, s.fit]));
  const shortlist: BriefShortlist[] = input.profiles.map((p) => {
    const history: DecisionHistoryItem[] = input.decisions
      .filter((d) => d.profile_id === p.id)
      .map((d) => ({ decision: d.decision, fit: fitFor.get(`${d.job_id}|${d.profile_id}`) ?? null, reason: d.reason }));
    return { profileId: p.id, profileName: p.name, autoShortlist: "off", threshold: measureThreshold(history) };
  });

  const counts: Brief["counts"] = {
    newJobs: newJobs.length,
    toReview: reviewable.length,
    strongFit: strong.length,
    unscored: input.jobs.filter((j) => !anyScore.has(j.id) && !decidedJob.has(j.id) && !appliedJob.has(j.id)).length,
    unmetMustHaves: unmet.length,
    screenedOut: screenedNew.length,
    followUpsOverdue: groups.overdue.length,
    followUpsDueToday: groups.dueToday.length,
    followUpsUpcoming: groups.upcoming.length,
    appliedThisWeek,
    querySuggestions: suggestions.length,
  };

  return {
    version: BRIEF_VERSION,
    generatedAt: input.now,
    today: input.today,
    since: input.since,
    headline: headlineFor(counts),
    counts,
    newJobs: newJobs.slice(0, LIST_LIMIT),
    // Fit 7+ first (already sorted by fit), then the rest.
    toReview: reviewable.slice(0, LIST_LIMIT),
    unmetMustHaves: unmet.slice(0, LIST_LIMIT),
    screenedOut: {
      count: screenedNew.length,
      reasons: [...reasonCounts.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    },
    followUps: {
      overdue: groups.overdue.map(toFollowUp),
      dueToday: groups.dueToday.map(toFollowUp),
      upcoming: groups.upcoming.map(toFollowUp),
    },
    appliedThisWeek,
    querySuggestions: suggestions,
    shortlist,
  };
}
