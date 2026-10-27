/**
 * Query health. Pure functions over rows of the `queries` table.
 *
 * Each query gets a hit rate (relevant hits over total hits, when counted) and
 * a recommendation: keep, watch, or a suggestion to retire. These are only
 * suggestions for the person. Nothing here retires a query; the person does
 * that themselves from the query library on /profiles.
 */

export interface QueryHealthInput {
  id: string;
  profile_id: string;
  source: string;
  query_text: string;
  quality: "good" | "mixed" | "noise" | "untested" | string;
  runs: number | null;
  relevant_hits: number | null;
  total_hits: number | null;
  retired: boolean;
  notes?: string | null;
}

export type QueryRecommendation = "keep" | "watch" | "retire";

export interface QueryHealth {
  queryId: string;
  profileId: string;
  source: string;
  queryText: string;
  runs: number;
  /** Relevant hits over total hits, 0 to 1, or null when relevant hits were not counted or nothing came back. */
  hitRate: number | null;
  recommendation: QueryRecommendation;
  /** Plain words, for example "3 of 40 relevant (8%) over 4 runs. Last note: returned clerical roles." */
  reason: string;
}

/** Runs needed before a hit rate can earn a retire suggestion. */
export const MIN_RUNS_FOR_SUGGESTION = 3;
/** Below this hit rate, after enough runs, suggest retiring. */
export const RETIRE_BELOW = 0.15;
/** Below this hit rate, after enough runs, keep an eye on it. */
export const WATCH_BELOW = 0.35;

export interface QueryHealthOptions {
  minRuns?: number;
  retireBelow?: number;
  watchBelow?: number;
}

function count(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** The person's own note from the query library, tidied into a sentence. */
function noteSentence(notes: string | null | undefined): string {
  const text = (notes ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const capped = text.length > 160 ? `${text.slice(0, 157)}...` : text;
  return ` Note: ${capped.charAt(0).toLowerCase()}${capped.slice(1)}${/[.!?]$/.test(capped) ? "" : "."}`;
}

/** Relevant hits over total hits, or null when that cannot be worked out. */
export function hitRate(row: Pick<QueryHealthInput, "relevant_hits" | "total_hits">): number | null {
  const relevant = count(row.relevant_hits);
  const total = count(row.total_hits);
  if (relevant === null || total === null || total === 0) return null;
  return Math.min(1, relevant / total);
}

export function assessQuery(row: QueryHealthInput, options: QueryHealthOptions = {}): QueryHealth {
  const minRuns = options.minRuns ?? MIN_RUNS_FOR_SUGGESTION;
  const retireBelow = options.retireBelow ?? RETIRE_BELOW;
  const watchBelow = options.watchBelow ?? WATCH_BELOW;

  const runs = count(row.runs) ?? 0;
  const relevant = count(row.relevant_hits);
  const total = count(row.total_hits);
  const rate = hitRate(row);
  const note = noteSentence(row.notes);
  const base = {
    queryId: row.id,
    profileId: row.profile_id,
    source: row.source,
    queryText: row.query_text,
    runs,
    hitRate: rate,
  };
  const out = (recommendation: QueryRecommendation, reason: string): QueryHealth => ({
    ...base,
    recommendation,
    reason: `${reason}${note}`,
  });

  if (row.retired) return out("keep", "Already retired; the Search agent skips it.");

  // Marked noise but still running: the library rule is that noise queries are retired.
  if (row.quality === "noise") {
    return out("retire", "Marked noise but not retired, so it still runs.");
  }

  if (runs < minRuns) {
    return out("keep", `Only ${plural(runs, "run")} so far; too early to judge.`);
  }

  const over = `over ${plural(runs, "run")}`;

  if (total === 0) {
    return out("retire", `Returned no results ${over}.`);
  }

  if (rate === null) {
    if (row.quality === "mixed") {
      return out("watch", `Marked mixed; relevant hits are not counted yet (${plural(runs, "run")}).`);
    }
    return out("keep", `Relevant hits are not counted yet (${plural(runs, "run")}).`);
  }

  const detail = `${relevant} of ${total} relevant (${pct(rate)}) ${over}.`;
  if (rate < retireBelow) return out("retire", `Low hit rate: ${detail}`);
  if (rate < watchBelow || row.quality === "mixed") return out("watch", `Mixed results: ${detail}`);
  return out("keep", `Working: ${detail}`);
}

const ORDER: Record<QueryRecommendation, number> = { retire: 0, watch: 1, keep: 2 };

/**
 * Suggestions worth showing: retire first, then watch, lowest hit rate first.
 * Retired queries and ones to keep are left out.
 */
export function querySuggestions(rows: readonly QueryHealthInput[], options: QueryHealthOptions = {}): QueryHealth[] {
  return rows
    .filter((r) => !r.retired)
    .map((r) => assessQuery(r, options))
    .filter((h) => h.recommendation !== "keep")
    .sort(
      (a, b) =>
        ORDER[a.recommendation] - ORDER[b.recommendation] ||
        (a.hitRate ?? -1) - (b.hitRate ?? -1) ||
        a.queryText.localeCompare(b.queryText),
    );
}
