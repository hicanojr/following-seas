import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { JobCard, ScreenedOutCard, type ScoredJob } from "@/components/jobs/JobCard";
import { DecisionControls, type CurrentDecision } from "@/components/jobs/DecisionControls";
import { ScoreButton } from "@/components/jobs/ScoreButton";
import type { EasyApply } from "@/lib/jobs/types";
import { formatUsd } from "@/lib/scoring/prechecks";
import { groupJobs, JOB_VIEWS, parseJobView, type JobView } from "@/lib/shortlist/views";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Jobs" };

const EMPTY_VIEW: Record<JobView, string> = {
  review: "Nothing waiting for review. New scored jobs will appear here for you to keep or skip.",
  kept: "No kept jobs yet. Jobs you keep appear here, ready to save to your tracker.",
  skipped: "No skipped jobs yet. Skips and their reasons appear here, and you can change your mind.",
  screened: "Nothing screened out. Jobs that hit a deal-breaker appear here with the reason.",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Jobs" subtitle="Postings gathered for your profiles, scored for fit." />
      <Suspense fallback={<p className="text-sm text-muted">Loading jobs...</p>}>
        <JobsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function salaryLabel(job: { salary_text: string | null; salary_min: number | null; salary_max: number | null }) {
  if (job.salary_text) return job.salary_text;
  const parts = [job.salary_min, job.salary_max].filter((n): n is number => typeof n === "number");
  return parts.length ? parts.map(formatUsd).join(" to ") : null;
}

function ImportLink() {
  return (
    <Link href="/jobs/import" className="text-sm font-medium text-accent underline underline-offset-4">
      Import jobs
    </Link>
  );
}

async function JobsContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <EmptyState heading="Not connected yet" upcoming={[]}>
        <p>Supabase is not configured on this server, so there are no jobs to show.</p>
      </EmptyState>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <EmptyState heading="Signed out" upcoming={[]}>
        <p>
          <Link href="/login?next=/jobs" className="text-accent underline underline-offset-4">
            Sign in
          </Link>{" "}
          to see your scored jobs.
        </p>
      </EmptyState>
    );
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (!profiles || profiles.length === 0) {
    return (
      <EmptyState
        heading="No search profiles yet"
        upcoming={[
          "A fit score from 1 to 10 with a one-line reason",
          "Requirements met, gaps, and unmet must-haves",
          "Deal-breaker hits set aside under Screened out, never deleted",
        ]}
      >
        <p>
          Jobs are scored against a profile.{" "}
          <Link href="/profiles" className="text-accent underline underline-offset-4">
            Add a profile
          </Link>{" "}
          first, then import jobs.
        </p>
      </EmptyState>
    );
  }

  const requested = typeof params.profile === "string" ? params.profile : undefined;
  const profile = profiles.find((p) => p.id === requested) ?? profiles[0];

  const [{ data: scoreRows }, { count: jobCount }] = await Promise.all([
    supabase
      .from("scores")
      .select("job_id, fit, reason, requirements_met, gaps, unmet_must_haves, deal_breaker_hit")
      .eq("profile_id", profile.id)
      .order("fit", { ascending: false }),
    supabase.from("jobs").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);

  const scoreList = scoreRows ?? [];
  const jobIds = scoreList.map((s) => s.job_id as string);
  const { data: jobRows } = jobIds.length
    ? await supabase
        .from("jobs")
        .select("id, title, company, location, salary_min, salary_max, salary_text, url, easy_apply")
        .in("id", jobIds)
        .is("deleted_at", null)
    : { data: [] as Record<string, unknown>[] };
  const jobsById = new Map((jobRows ?? []).map((j) => [j.id as string, j]));

  const scored: ScoredJob[] = [];
  for (const s of scoreList) {
    const j = jobsById.get(s.job_id as string);
    if (!j) continue;
    const easy = j.easy_apply as EasyApply;
    scored.push({
      jobId: j.id as string,
      title: String(j.title ?? ""),
      company: (j.company as string | null) ?? null,
      location: (j.location as string | null) ?? null,
      salary: salaryLabel({
        salary_text: (j.salary_text as string | null) ?? null,
        salary_min: (j.salary_min as number | null) ?? null,
        salary_max: (j.salary_max as number | null) ?? null,
      }),
      url: (j.url as string | null) ?? null,
      easyApply: easy === "yes" || easy === "no" ? easy : "unknown",
      fit: Number(s.fit),
      reason: (s.reason as string | null) ?? null,
      requirementsMet: strings(s.requirements_met),
      gaps: strings(s.gaps),
      unmetMustHaves: strings(s.unmet_must_haves),
      dealBreakerHit: (s.deal_breaker_hit as string | null) ?? null,
      keywordGaps: [],
    });
  }

  const scoredIds = scored.map((j) => j.jobId);
  const [{ data: decisionRows }, { data: applicationRows }, { data: gapRows }] = scoredIds.length
    ? await Promise.all([
        supabase.from("decisions").select("job_id, decision, reason").eq("profile_id", profile.id).in("job_id", scoredIds),
        supabase.from("applications").select("job_id, status").in("job_id", scoredIds),
        supabase.from("keyword_gaps").select("job_id, missing").in("job_id", scoredIds),
      ])
    : [
        { data: [] as Record<string, unknown>[] },
        { data: [] as Record<string, unknown>[] },
        { data: [] as Record<string, unknown>[] },
      ];

  const decisions = new Map<string, CurrentDecision>();
  for (const d of decisionRows ?? []) {
    if (d.decision === "keep" || d.decision === "skip") {
      decisions.set(d.job_id as string, { decision: d.decision, reason: (d.reason as string | null) ?? null });
    }
  }
  const trackerStatus = new Map((applicationRows ?? []).map((a) => [a.job_id as string, String(a.status)]));
  const keywordGaps = new Map((gapRows ?? []).map((row) => [row.job_id as string, strings(row.missing)]));
  for (const job of scored) job.keywordGaps = keywordGaps.get(job.jobId) ?? [];

  const groups = groupJobs(scored, decisions);
  const view = parseJobView(params.view);
  const shown = groups[view];
  const unscored = Math.max(0, (jobCount ?? 0) - scored.length);
  const hrefFor = (v: JobView) => {
    const q = new URLSearchParams();
    if (profiles.length > 1) q.set("profile", profile.id);
    if (v !== "review") q.set("view", v);
    const qs = q.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  const controls = (job: ScoredJob) => (
    <DecisionControls
      key={`${job.jobId}:${decisions.get(job.jobId)?.decision ?? "none"}`}
      jobId={job.jobId}
      profileId={profile.id}
      current={decisions.get(job.jobId) ?? null}
      trackerStatus={trackerStatus.get(job.jobId) ?? null}
    />
  );

  return (
    <div className="space-y-6">
      {profiles.length > 1 ? (
        <nav aria-label="Profile" className="-mx-1 flex flex-wrap gap-2">
          {profiles.map((p) => {
            const current = p.id === profile.id;
            return (
              <Link
                key={p.id}
                href={`/jobs?profile=${encodeURIComponent(p.id)}`}
                aria-current={current ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${
                  current ? "border-foreground bg-foreground text-background" : "border-line text-muted hover:text-foreground"
                }`}
              >
                {p.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <p className="text-sm">
          Profile: <span className="font-semibold">{profile.name}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          {unscored > 0
            ? `${unscored} job${unscored === 1 ? "" : "s"} not yet scored for this profile.`
            : "Every job on file has a score for this profile."}{" "}
          Scores use only your career facts and, when you have saved a resume, the cached resume. Once that resume has
          an embedding, only the closest quarter of postings are sent for a score. Keyword lists are suggestions only.
          Agents never apply for you.
        </p>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <ScoreButton profileId={profile.id} />
          <ImportLink />
        </div>
      </section>

      {scored.length === 0 ? (
        <EmptyState
          heading="No scored jobs yet"
          upcoming={[
            "Imported results from Indeed and ZipRecruiter",
            "A fit score from 1 to 10 with the reason, gaps, and any deal-breaker",
            "A direct link to each posting, so you decide and apply yourself",
          ]}
        >
          <p>
            Import jobs, then choose Score new jobs. Duplicates across sources are merged by company, title, and
            location.
          </p>
        </EmptyState>
      ) : (
        <>
          <nav aria-label="Filter jobs" className="-mx-5 overflow-x-auto px-5">
            <ul className="flex gap-2 whitespace-nowrap">
              {JOB_VIEWS.map((v) => {
                const current = v.key === view;
                return (
                  <li key={v.key}>
                    <Link
                      href={hrefFor(v.key)}
                      aria-current={current ? "page" : undefined}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                        current
                          ? "border-foreground bg-foreground text-background"
                          : "border-line text-muted hover:text-foreground"
                      }`}
                    >
                      {v.label}
                      <span className={current ? "opacity-80" : "text-xs"}>{groups[v.key].length}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section aria-label={JOB_VIEWS.find((v) => v.key === view)?.label} className="space-y-4">
            {view === "screened" ? (
              <p className="text-xs text-muted">
                These postings matched one of your deal-breakers. They are kept, not deleted, and you can still keep
                one if the screen got it wrong.
              </p>
            ) : null}
            {shown.length === 0 ? <p className="text-sm text-muted">{EMPTY_VIEW[view]}</p> : null}
            {view === "screened" ? (
              <ul className="space-y-2">
                {shown.map((job) => (
                  <ScreenedOutCard key={job.jobId} job={job}>
                    {controls(job)}
                  </ScreenedOutCard>
                ))}
              </ul>
            ) : (
              shown.map((job) => (
                <JobCard key={job.jobId} job={job}>
                  {controls(job)}
                </JobCard>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
