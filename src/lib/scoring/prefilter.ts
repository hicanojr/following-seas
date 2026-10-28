/**
 * Embedding prefilter. When a resume embedding exists, only the top fraction
 * of postings by cosine similarity are sent to Claude. The fraction is of the
 * whole library, so a later run does not score the remainder just because the
 * better matches are already scored.
 */

export const PREFILTER_FRACTION = 0.25;

export interface RankedJob {
  jobId: string;
  similarity: number;
}

export interface PrefilterDecision {
  selectedIds: string[];
  prefiltered: number;
  awaitingEmbedding: number;
}

/** Highest similarity first. Ties break on job id. Count is ceil(n * fraction), at least 1 when n > 0. */
export function topFractionIds(ranked: readonly RankedJob[], fraction = PREFILTER_FRACTION): string[] {
  const best = new Map<string, number>();
  for (const row of ranked) {
    if (!row.jobId || !Number.isFinite(row.similarity)) continue;
    const prev = best.get(row.jobId);
    if (prev == null || row.similarity > prev) best.set(row.jobId, row.similarity);
  }
  const sorted = [...best.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (sorted.length === 0 || !(fraction > 0)) return [];
  const count = Math.min(sorted.length, Math.max(1, Math.ceil(sorted.length * fraction)));
  return sorted.slice(0, count).map(([id]) => id);
}

/**
 * `ranked === null` means there is no resume embedding, so every candidate is eligible.
 * An empty ranked list means the resume is embedded and no posting is, so nothing is sent.
 */
export function decidePrefilter(
  candidateIds: readonly string[],
  ranked: readonly RankedJob[] | null,
  cap: number,
  fraction = PREFILTER_FRACTION,
): PrefilterDecision {
  if (ranked == null) {
    return { selectedIds: [...candidateIds].slice(0, Math.max(0, cap)), prefiltered: 0, awaitingEmbedding: 0 };
  }
  const top = new Set(topFractionIds(ranked, fraction));
  const rankedIds = new Set<string>();
  const similarity = new Map<string, number>();
  for (const row of ranked) {
    if (!row.jobId || !Number.isFinite(row.similarity)) continue;
    rankedIds.add(row.jobId);
    const prev = similarity.get(row.jobId);
    if (prev == null || row.similarity > prev) similarity.set(row.jobId, row.similarity);
  }
  let prefiltered = 0;
  let awaitingEmbedding = 0;
  const chosen: string[] = [];
  for (const id of candidateIds) {
    if (!rankedIds.has(id)) awaitingEmbedding += 1;
    else if (!top.has(id)) prefiltered += 1;
    else chosen.push(id);
  }
  chosen.sort((a, b) => (similarity.get(b) ?? 0) - (similarity.get(a) ?? 0) || a.localeCompare(b));
  return { selectedIds: chosen.slice(0, Math.max(0, cap)), prefiltered, awaitingEmbedding };
}
