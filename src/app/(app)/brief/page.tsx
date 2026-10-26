import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { FollowUpsCard } from "@/components/tracker/FollowUpsCard";
import { buildBrief, briefWindowStart, STRONG_FIT, type Brief, type BriefJob } from "@/lib/brief/build";
import { dailyRunEnabled, latestBrief, loadBriefInput } from "@/lib/brief/load";
import { createClient } from "@/lib/supabase/server";
import { loadApplications } from "@/lib/tracker/load";
import { setDailyRun } from "./actions";

export const metadata: Metadata = { title: "Brief" };

const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

export default function BriefPage() {
  return (
    <>
      <PageHeader title="Brief" subtitle="Your Chief of Staff's daily report." />
      <div className="space-y-4">
        <Suspense fallback={<p className="text-sm text-muted">Preparing your brief...</p>}>
          <BriefContent />
        </Suspense>
      </div>
    </>
  );
}

function NoBrief({ children }: { children?: ReactNode }) {
  return (
    <EmptyState
      heading="No brief yet"
      upcoming={[
        "New roles found since your last brief, already scored against your profiles",
        "Follow-ups that are due today",
        "Queries that keep returning noise, with suggestions to retire them",
      ]}
    >
      {children ?? (
        <p>
          Once your search profiles are set up, your Chief of Staff will put together a short brief here each day. It
          reports and suggests. It never applies or contacts anyone for you.
        </p>
      )}
    </EmptyState>
  );
}

async function BriefContent() {
  const supabase = await createClient();
  if (!supabase) return <NoBrief />;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return <NoBrief />;
  const userId = data.user.id;

  const loaded = await loadPageBrief(supabase, userId);
  if (loaded.state === "error") {
    return (
      <>
        <NoBrief>
          <p>The brief could not be loaded just now. Try again in a moment.</p>
        </NoBrief>
        <FollowUpsDue />
      </>
    );
  }
  if (loaded.state === "no_profiles") {
    return (
      <>
        <NoBrief />
        <FollowUpsDue />
      </>
    );
  }
  const { brief, lastRun, dailyRun } = loaded;

  return (
    <>
      <Headline brief={brief} />

      <JobSection
        id="review"
        title="Worth a look"
        count={brief.counts.toReview}
        note={`Scored and waiting for your keep or skip. Fit ${STRONG_FIT} and up first.`}
        jobs={brief.toReview}
        empty="Nothing waiting for review."
        more={{ href: "/jobs", label: "All jobs" }}
      />

      <JobSection
        id="new"
        title="New since your last brief"
        count={brief.counts.newJobs}
        note={brief.counts.unscored > 0 ? `${brief.counts.unscored} saved jobs are not scored yet.` : undefined}
        jobs={brief.newJobs}
        empty="No new jobs since your last brief."
      />

      {brief.unmetMustHaves.length > 0 && (
        <JobSection
          id="unmet"
          title="Unmet must-haves"
          count={brief.counts.unmetMustHaves}
          note="Waiting for review, but missing something you marked as a must-have."
          jobs={brief.unmetMustHaves}
          empty=""
          showUnmet
        />
      )}

      <ScreenedOut brief={brief} />

      <FollowUpsDue />

      <QueryHealthSection brief={brief} />

      <ShortlistSection brief={brief} />

      <ScheduleSection lastRun={lastRun} dailyRun={dailyRun} />

      <p className="px-1 text-xs text-muted">
        The brief reports and suggests. Fair Winds never applies, never uses Easy Apply, and never emails or messages
        anyone for you.
      </p>
    </>
  );
}

type PageBrief =
  | { state: "error" }
  | { state: "no_profiles" }
  | { state: "ok"; brief: Brief; lastRun: string | null; dailyRun: boolean };

/** Built fresh from current data, so keeps and skips made today show at once. */
async function loadPageBrief(supabase: SupabaseClient, userId: string): Promise<PageBrief> {
  try {
    const latest = await latestBrief(supabase, userId);
    const dailyRun = await dailyRunEnabled(supabase, userId);
    const now = new Date();
    const input = await loadBriefInput(supabase, userId, {
      now: now.toISOString(),
      today: now.toISOString().slice(0, 10),
      since: briefWindowStart(latest, now),
    });
    if (input.profiles.length === 0) return { state: "no_profiles" };
    return { state: "ok", brief: buildBrief(input), lastRun: latest?.generated_at ?? null, dailyRun };
  } catch (err) {
    console.error("could not build the brief", err);
    return { state: "error" };
  }
}

// ---------------------------------------------------------------------------

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="block text-2xl font-semibold leading-none">{value}</span>
      <span className="mt-1 block text-xs text-muted">{label}</span>
    </>
  );
  return href ? (
    <a href={href} className="rounded-xl bg-background px-3 py-2">
      {body}
    </a>
  ) : (
    <div className="rounded-xl bg-background px-3 py-2">{body}</div>
  );
}

function Headline({ brief }: { brief: Brief }) {
  const c = brief.counts;
  return (
    <section className={card} aria-labelledby="brief-headline">
      <div className="mb-3 h-px w-12 bg-brass" aria-hidden />
      <h2 id="brief-headline" className="text-lg font-semibold leading-snug">
        {brief.headline}
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="New jobs" value={c.newJobs} href="#new" />
        <Stat label={`Fit ${STRONG_FIT}+ to review`} value={c.strongFit} href="#review" />
        <Stat label="Follow-ups due" value={c.followUpsOverdue + c.followUpsDueToday} />
        <Stat label="Applied this week" value={c.appliedThisWeek} />
      </div>
    </section>
  );
}

const EASY_APPLY: Record<BriefJob["easyApply"], string> = {
  yes: "Easy Apply: yes",
  no: "Easy Apply: no",
  unknown: "Easy Apply: unknown",
};

function fitTone(fit: number | null): string {
  if (fit === null) return "border-line bg-background text-muted";
  if (fit >= 8) return "border-emerald-700/40 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300";
  if (fit >= 5) return "border-brass/60 bg-brass/10 text-foreground";
  return "border-line bg-background text-muted";
}

function JobRow({ job, showUnmet }: { job: BriefJob; showUnmet?: boolean }) {
  return (
    <li className="rounded-xl bg-background p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium leading-snug">{job.title}</p>
          <p className="text-xs text-muted">
            {[job.company, job.location].filter(Boolean).join(" · ") || "Company not listed"}
          </p>
        </div>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold ${fitTone(job.fit)}`}
          aria-label={job.fit === null ? "Not scored yet" : `Fit ${job.fit} out of 10`}
        >
          {job.fit ?? "–"}
        </span>
      </div>
      {job.reason ? <p className="mt-1.5 text-xs leading-relaxed">{job.reason}</p> : null}
      {showUnmet && job.unmetMustHaves.length > 0 ? (
        <p className="mt-1 text-xs text-red-800 dark:text-red-300">Missing: {job.unmetMustHaves.join("; ")}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {job.profileName ? <span>{job.profileName}</span> : null}
        <span>{EASY_APPLY[job.easyApply]}</span>
        {job.url ? (
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Open posting
          </a>
        ) : (
          <span>No link</span>
        )}
      </div>
    </li>
  );
}

function SectionHeader({ title, count, action }: { title: string; count: number; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold">
        {title} <span className="text-sm font-normal text-muted">({count})</span>
      </h2>
      {action}
    </div>
  );
}

function JobSection({
  id,
  title,
  count,
  note,
  jobs,
  empty,
  more,
  showUnmet,
}: {
  id: string;
  title: string;
  count: number;
  note?: string;
  jobs: BriefJob[];
  empty: string;
  more?: { href: string; label: string };
  showUnmet?: boolean;
}) {
  return (
    <section id={id} className={`${card} scroll-mt-20`}>
      <SectionHeader
        title={title}
        count={count}
        action={
          more ? (
            <Link href={more.href} className="shrink-0 text-xs text-accent underline underline-offset-2">
              {more.label}
            </Link>
          ) : null
        }
      />
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      {jobs.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {jobs.map((job) => (
            <JobRow key={`${job.jobId}-${job.profileId ?? "none"}`} job={job} showUnmet={showUnmet} />
          ))}
        </ul>
      )}
      {count > jobs.length ? (
        <p className="mt-2 text-xs text-muted">
          Showing {jobs.length} of {count}.
        </p>
      ) : null}
    </section>
  );
}

function ScreenedOut({ brief }: { brief: Brief }) {
  const { count, reasons } = brief.screenedOut;
  return (
    <section className={card}>
      <SectionHeader
        title="Screened out"
        count={count}
        action={
          <Link href="/jobs?view=screened" className="shrink-0 text-xs text-accent underline underline-offset-2">
            Review
          </Link>
        }
      />
      {count === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing hit a deal-breaker since your last brief.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {reasons.map((r) => (
            <li key={r.reason} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{r.reason}</span>
              <span className="shrink-0 text-muted">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QueryHealthSection({ brief }: { brief: Brief }) {
  const items = brief.querySuggestions;
  return (
    <section className={card}>
      <SectionHeader title="Query health" count={items.length} />
      <p className="mt-1 text-xs text-muted">Suggestions only. Nothing is retired unless you retire it in the query library.</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Your active queries look fine.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((q) => (
            <li key={q.queryId} className="rounded-xl bg-background p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 break-words font-medium">{q.queryText}</p>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                    q.recommendation === "retire"
                      ? "border-red-700/40 text-red-800 dark:text-red-300"
                      : "border-brass/60 text-foreground"
                  }`}
                >
                  {q.recommendation === "retire" ? "Consider retiring" : "Watch"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{q.reason}</p>
              <Link
                href={`/profiles?profile=${encodeURIComponent(q.profileId)}#queries-heading`}
                className="mt-1 inline-block text-xs text-accent underline underline-offset-2"
              >
                {q.profileName ? `${q.profileName}: query library` : "Query library"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShortlistSection({ brief }: { brief: Brief }) {
  if (brief.shortlist.length === 0) return null;
  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">Auto shortlist</h2>
      <p className="mt-1 text-xs text-muted">
        Off. You decide every keep and skip. A threshold is suggested only once your own decisions support one.
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {brief.shortlist.map((s) => (
          <li key={s.profileId}>
            <span className="font-medium">{s.profileName}:</span> <span className="text-muted">{s.threshold.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScheduleSection({ lastRun, dailyRun }: { lastRun: string | null; dailyRun: boolean }) {
  const when = lastRun
    ? new Date(lastRun).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      })
    : null;
  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">Daily run</h2>
      <p className="mt-1 text-sm text-muted">
        {dailyRun
          ? "Each morning the Search agent runs your active LinkedIn and USAJobs queries, new jobs are scored, and a brief is prepared. Indeed and ZipRecruiter stay import only."
          : "The daily run is off. Nothing is searched or scored for you on a schedule."}
      </p>
      <p className="mt-1 text-xs text-muted">{when ? `Last prepared ${when}.` : "No daily brief has been prepared yet."}</p>
      <form action={setDailyRun} className="mt-3">
        <input type="hidden" name="daily_run" value={dailyRun ? "false" : "true"} />
        <button type="submit" className="rounded-full border border-line px-3 py-1 text-xs font-medium hover:bg-background">
          {dailyRun ? "Turn off daily run" : "Turn on daily run"}
        </button>
      </form>
    </section>
  );
}

/** Follow-ups due, shown once the person has something on the tracker. */
async function FollowUpsDue() {
  const loaded = await loadApplications();
  if (loaded.state !== "ok" || loaded.applications.length === 0) return null;
  return <FollowUpsCard applications={loaded.applications} showTrackerLink />;
}
