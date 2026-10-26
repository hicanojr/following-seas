import "server-only";

/**
 * The real services behind the Chief's tools, built from the request's
 * Supabase client (anon key plus the person's session), so Row Level
 * Security limits every read and write to the signed-in person. Each method
 * delegates to an existing service: search, scoring, or tracker.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EasyApply } from "@/lib/jobs/types";
import { formatUsd } from "@/lib/scoring/prechecks";
import { createScoringClient, scoringModel } from "@/lib/scoring/client";
import { scoreJobs } from "@/lib/scoring/service";
import { runSearch, supabaseSearchStore } from "@/lib/search";
import { searchEnv } from "@/lib/search/route-helpers";
import { groupJobs, type DecisionLike, type JobView } from "@/lib/shortlist/views";
import {
  APPLICATION_STATUSES,
  classifyFollowUps,
  runningList,
  supabaseTrackerStore,
  trackJob,
  updateApplication,
  type ApplicationStatus,
  type TrackedApplication,
} from "@/lib/tracker";
import { AGENT_NAME } from "./agent";
import type {
  ChiefJob,
  ChiefLogger,
  ChiefServices,
  EasyApplyLabel,
  FollowUpItem,
  JobFilter,
  ProfileSummary,
  QuerySummary,
} from "./types";

const VIEW_FOR: Record<JobFilter, JobView> = {
  to_review: "review",
  kept: "kept",
  skipped: "skipped",
  screened_out: "screened",
};

const EASY_LABEL: Record<EasyApply, EasyApplyLabel> = { yes: "Yes", no: "No", unknown: "Unknown" };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function salaryLabel(row: Record<string, unknown>): string | null {
  const text = str(row.salary_text);
  if (text) return text;
  const parts = [row.salary_min, row.salary_max].filter((n): n is number => typeof n === "number");
  return parts.length ? parts.map(formatUsd).join(" to ") : null;
}

const QUERY_COLUMNS = "id, profile_id, source, query_text, quality, retired, runs, last_run_at";

function toQuery(row: Record<string, unknown>): QuerySummary {
  return {
    id: String(row.id),
    profile_id: String(row.profile_id),
    source: row.source as QuerySummary["source"],
    query_text: String(row.query_text ?? ""),
    quality: String(row.quality ?? "untested"),
    retired: Boolean(row.retired),
    runs: typeof row.runs === "number" ? row.runs : 0,
    last_run_at: str(row.last_run_at),
  };
}

function followUpItem(app: TrackedApplication): FollowUpItem {
  return {
    application_id: app.id,
    company: app.job.company,
    title: app.job.title,
    status: app.status,
    applied_on: app.applied_on,
    follow_up_on: app.follow_up_on,
    url: app.job.url,
  };
}

export function supabaseChiefServices(supabase: SupabaseClient, userId: string): ChiefServices {
  const tracker = supabaseTrackerStore(supabase);

  return {
    async listProfiles() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, target_titles, locations, min_base_pay, must_haves, deal_breakers")
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`Could not load profiles: ${error.message}`);
      return (data ?? []).map(
        (p): ProfileSummary => ({
          id: String(p.id),
          name: String(p.name ?? ""),
          target_titles: strings(p.target_titles),
          locations: strings(p.locations),
          min_base_pay: typeof p.min_base_pay === "number" ? p.min_base_pay : null,
          must_haves: strings(p.must_haves),
          deal_breakers: strings(p.deal_breakers),
        }),
      );
    },

    async listQueries(profileId) {
      const { data, error } = await supabase
        .from("queries")
        .select(QUERY_COLUMNS)
        .eq("profile_id", profileId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`Could not load queries: ${error.message}`);
      return (data ?? []).map(toQuery);
    },

    async getQuery(queryId) {
      const { data, error } = await supabase.from("queries").select(QUERY_COLUMNS).eq("id", queryId).maybeSingle();
      if (error) throw new Error(`Could not load the query: ${error.message}`);
      return data ? toQuery(data) : null;
    },

    async runSearch(queryId) {
      const summary = await runSearch(
        { userId, queryId },
        { store: supabaseSearchStore(supabase), env: searchEnv() },
      );
      return {
        source: summary.source,
        received: summary.received,
        imported: summary.imported,
        duplicates: summary.duplicates.length,
        noise: summary.noise.length,
      };
    },

    async scoreJobs(profileId, jobIds) {
      const client = createScoringClient();
      if (!client) throw new Error("Scoring is not set up: ANTHROPIC_API_KEY is missing on the server.");
      const outcome = await scoreJobs({ userId, profileId, jobIds }, { supabase, client, model: scoringModel() });
      return { scored: outcome.scored, screenedOut: outcome.screenedOut, failed: outcome.failed.length };
    },

    async listJobs(profileId, filter, minFit) {
      const { data: scoreRows, error } = await supabase
        .from("scores")
        .select("job_id, fit, reason, gaps, unmet_must_haves, deal_breaker_hit")
        .eq("profile_id", profileId)
        .order("fit", { ascending: false });
      if (error) throw new Error(`Could not load scores: ${error.message}`);
      const scores = scoreRows ?? [];
      const ids = scores.map((s) => String(s.job_id));
      if (ids.length === 0) return [];

      const [{ data: jobRows, error: jobsError }, { data: decisionRows, error: decisionsError }] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, title, company, location, salary_min, salary_max, salary_text, url, easy_apply")
          .in("id", ids)
          .is("deleted_at", null),
        supabase.from("decisions").select("job_id, decision, reason").eq("profile_id", profileId).in("job_id", ids),
      ]);
      if (jobsError) throw new Error(`Could not load jobs: ${jobsError.message}`);
      if (decisionsError) throw new Error(`Could not load decisions: ${decisionsError.message}`);

      const jobsById = new Map((jobRows ?? []).map((j) => [String(j.id), j as Record<string, unknown>]));
      const jobs: (ChiefJob & { jobId: string; dealBreakerHit: string | null })[] = [];
      for (const s of scores) {
        const j = jobsById.get(String(s.job_id));
        if (!j) continue;
        const easy = j.easy_apply === "yes" || j.easy_apply === "no" ? j.easy_apply : "unknown";
        const dealBreaker = str(s.deal_breaker_hit);
        jobs.push({
          id: String(j.id),
          jobId: String(j.id),
          title: String(j.title ?? ""),
          company: str(j.company),
          location: str(j.location),
          salary: salaryLabel(j),
          fit: Number(s.fit),
          reason: str(s.reason),
          gaps: strings(s.gaps),
          unmet_must_haves: strings(s.unmet_must_haves),
          deal_breaker: dealBreaker,
          dealBreakerHit: dealBreaker,
          easy_apply: EASY_LABEL[easy],
          url: str(j.url),
        });
      }

      const decisions = new Map<string, DecisionLike>();
      for (const d of decisionRows ?? []) {
        if (d.decision === "keep" || d.decision === "skip") {
          decisions.set(String(d.job_id), { decision: d.decision, reason: str(d.reason) });
        }
      }
      return groupJobs(jobs, decisions)
        [VIEW_FOR[filter]].filter((j) => minFit == null || j.fit >= minFit)
        .map((j): ChiefJob => ({
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          salary: j.salary,
          fit: j.fit,
          reason: j.reason,
          gaps: j.gaps,
          unmet_must_haves: j.unmet_must_haves,
          deal_breaker: j.deal_breaker,
          easy_apply: j.easy_apply,
          url: j.url,
        }));
    },

    async trackerSummary() {
      const apps = await tracker.listApplications();
      const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
      for (const a of apps) counts[a.status] += 1;
      return { counts, recentlyApplied: runningList(apps).slice(0, 10) };
    },

    async followUps(today) {
      const groups = classifyFollowUps(await tracker.listApplications(), today);
      return {
        overdue: groups.overdue.map(followUpItem),
        dueToday: groups.dueToday.map(followUpItem),
        upcoming: groups.upcoming.map(followUpItem),
      };
    },

    async getJobForDraft(jobId) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, company, url")
        .eq("id", jobId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`Could not load the job: ${error.message}`);
      if (!data) return null;
      const app = (await tracker.applicationsByJobId([jobId])).get(jobId);
      return {
        id: String(data.id),
        title: String(data.title ?? ""),
        company: str(data.company),
        url: str(data.url),
        application: app ? { status: app.status, applied_on: app.applied_on } : null,
      };
    },

    async markApplied(jobId, appliedOn, today) {
      // The Tracker service records it (and writes its own audit rows).
      const existing = (await tracker.applicationsByJobId([jobId])).get(jobId);
      const applicationId = existing
        ? existing.id
        : (await trackJob(tracker, { userId, jobId, status: "saved" })).application.id;
      const updated = await updateApplication(tracker, {
        userId,
        id: applicationId,
        today,
        change: { action: "mark_applied", applied_on: appliedOn },
      });
      const { data } = await supabase.from("jobs").select("title, company, url").eq("id", jobId).maybeSingle();
      return {
        company: str(data?.company),
        title: String(data?.title ?? ""),
        applied_on: updated.applied_on ?? appliedOn,
        url: str(data?.url),
      };
    },
  };
}

/**
 * Logs every tool call to agent_runs (agent "chief") and each call with a
 * side effect to audit_log. A failed log write never blocks the person.
 */
export function supabaseChiefLogger(supabase: SupabaseClient, userId: string): ChiefLogger {
  return {
    async toolCall(record) {
      const { error } = await supabase.from("agent_runs").insert({
        user_id: userId,
        agent: AGENT_NAME,
        status: record.ok ? "succeeded" : "failed",
        input: { tool: record.tool, action: record.action, args: record.input ?? null },
        output: record.output ?? null,
        error: record.error,
        started_at: record.startedAt,
        finished_at: record.finishedAt,
      });
      if (error) console.error("chief agent_runs insert failed", error.message);

      if (record.action) {
        const { error: auditError } = await supabase.from("audit_log").insert({
          user_id: userId,
          actor: AGENT_NAME,
          action: `chief.${record.tool}`,
          details: { gate: record.action, ok: record.ok, args: record.input ?? null, error: record.error },
        });
        if (auditError) console.error("chief audit_log insert failed", auditError.message);
      }
    },
  };
}
