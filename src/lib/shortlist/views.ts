/**
 * Splits scored jobs into the Jobs page tabs. A decision the person made always
 * wins: a kept or skipped job shows under Kept or Skipped even if it hit a
 * deal-breaker. Undecided deal-breaker hits are Screened out; the rest are To review.
 */

export const JOB_VIEWS = [
  { key: "review", label: "To review" },
  { key: "kept", label: "Kept" },
  { key: "skipped", label: "Skipped" },
  { key: "screened", label: "Screened out" },
] as const;

export type JobView = (typeof JOB_VIEWS)[number]["key"];

export function parseJobView(value: unknown): JobView {
  return JOB_VIEWS.some((v) => v.key === value) ? (value as JobView) : "review";
}

export interface DecisionLike {
  decision: "keep" | "skip";
  reason: string | null;
}

export function groupJobs<J extends { jobId: string; fit: number; dealBreakerHit: string | null }>(
  jobs: readonly J[],
  decisions: ReadonlyMap<string, DecisionLike>,
): Record<JobView, J[]> {
  const groups: Record<JobView, J[]> = { review: [], kept: [], skipped: [], screened: [] };
  for (const job of jobs) {
    const d = decisions.get(job.jobId);
    if (d?.decision === "keep") groups.kept.push(job);
    else if (d?.decision === "skip") groups.skipped.push(job);
    else if (job.dealBreakerHit) groups.screened.push(job);
    else groups.review.push(job);
  }
  const byFit = (a: J, b: J) => b.fit - a.fit;
  for (const key of Object.keys(groups) as JobView[]) groups[key].sort(byFit);
  return groups;
}
