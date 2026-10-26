import { safeHttpUrl } from "@/components/jobs/JobCard";
import type { ChiefJob } from "@/lib/chief/types";

function fitTone(fit: number): string {
  if (fit >= 8) return "border-emerald-700/40 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300";
  if (fit >= 5) return "border-brass/60 bg-brass/10 text-foreground";
  return "border-line bg-background text-muted";
}

/** A compact job card for chat replies: always the link and Easy Apply status. */
export function ChiefJobCard({ job }: { job: ChiefJob }) {
  const href = safeHttpUrl(job.url);
  return (
    <article className="rounded-xl border border-line bg-card p-3 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{job.title}</h3>
          <p className="mt-0.5 text-muted">
            {[job.company, job.location].filter(Boolean).join(" · ") || "Company and location not listed"}
          </p>
          <p className="mt-0.5">{job.salary ?? "Salary not listed"}</p>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${fitTone(job.fit)}`}
          aria-label={`Fit ${job.fit} out of 10`}
        >
          {job.fit}/10
        </span>
      </div>
      {job.reason ? <p className="mt-2 leading-relaxed">{job.reason}</p> : null}
      {job.deal_breaker ? (
        <p className="mt-2 text-red-800 dark:text-red-300">Deal-breaker: {job.deal_breaker}</p>
      ) : null}
      {job.unmet_must_haves.length > 0 ? (
        <ul className="mt-2 space-y-1 rounded-lg border border-red-700/30 bg-red-700/5 p-2 text-red-800 dark:text-red-300">
          {job.unmet_must_haves.map((m) => (
            <li key={m}>Unmet must-have: {m}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-muted">
          Easy Apply: <span className="text-foreground">{job.easy_apply}</span>
        </span>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-4">
            Open posting
          </a>
        ) : (
          <span className="text-muted">No link on file</span>
        )}
      </div>
    </article>
  );
}
