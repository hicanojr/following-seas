import type { EasyApply } from "@/lib/jobs/types";

export interface ScoredJob {
  jobId: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  url: string | null;
  easyApply: EasyApply;
  fit: number;
  reason: string | null;
  requirementsMet: string[];
  gaps: string[];
  unmetMustHaves: string[];
  dealBreakerHit: string | null;
}

const EASY_APPLY_LABEL: Record<EasyApply, string> = { yes: "Yes", no: "No", unknown: "Unknown" };

/** Only http(s) links are shown, so a stored URL can never run script. */
export function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function fitTone(fit: number): string {
  if (fit >= 8) return "border-emerald-700/40 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300";
  if (fit >= 5) return "border-brass/60 bg-brass/10 text-foreground";
  return "border-line bg-background text-muted";
}

function List({ title, items, tone }: { title: string; items: string[]; tone: "met" | "gap" | "unmet" }) {
  if (items.length === 0) return null;
  const dot = tone === "met" ? "bg-emerald-700" : tone === "unmet" ? "bg-red-700" : "bg-brass";
  return (
    <div>
      <h4 className={`text-xs font-semibold uppercase tracking-wide ${tone === "unmet" ? "text-red-800 dark:text-red-300" : "text-muted"}`}>
        {title}
      </h4>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JobCard({ job }: { job: ScoredJob }) {
  const href = safeHttpUrl(job.url);
  return (
    <article className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug">{job.title}</h3>
          <p className="mt-0.5 text-sm text-muted">
            {[job.company, job.location].filter(Boolean).join(" · ") || "Company and location not listed"}
          </p>
          {job.salary ? <p className="mt-0.5 text-sm">{job.salary}</p> : null}
        </div>
        <div
          className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border ${fitTone(job.fit)}`}
          aria-label={`Fit ${job.fit} out of 10`}
        >
          <span className="text-lg font-semibold leading-none">{job.fit}</span>
          <span className="text-[10px] leading-none">/10</span>
        </div>
      </div>

      {job.reason ? <p className="mt-3 text-sm leading-relaxed">{job.reason}</p> : null}

      {job.unmetMustHaves.length > 0 ? (
        <div className="mt-3 rounded-xl border border-red-700/30 bg-red-700/5 p-3">
          <List title="Unmet must-haves" items={job.unmetMustHaves} tone="unmet" />
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        <List title="Requirements met" items={job.requirementsMet} tone="met" />
        <List title="Gaps" items={job.gaps} tone="gap" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
        <span className="text-muted">
          Easy Apply: <span className="text-foreground">{EASY_APPLY_LABEL[job.easyApply]}</span>
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent underline underline-offset-4"
          >
            Open posting
          </a>
        ) : (
          <span className="text-muted">No link on file</span>
        )}
      </div>
    </article>
  );
}

export function ScreenedOutCard({ job }: { job: ScoredJob }) {
  const href = safeHttpUrl(job.url);
  return (
    <li className="rounded-xl border border-line bg-card p-4 text-sm">
      <p className="font-medium">{job.title}</p>
      <p className="text-muted">{[job.company, job.location].filter(Boolean).join(" · ")}</p>
      <p className="mt-1">
        Deal-breaker: <span className="font-medium">{job.dealBreakerHit}</span>
      </p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-accent underline underline-offset-4">
          Open posting
        </a>
      ) : null}
    </li>
  );
}
