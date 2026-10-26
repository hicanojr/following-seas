/**
 * Skip history stats. Pure functions over the person's own keep and skip
 * decisions. They only describe; nothing here makes or applies a decision.
 * Auto shortlist stays off: a suggested threshold is shown for the person to
 * consider, never acted on.
 */

import { parseReason } from "./reasons";

export interface DecisionHistoryItem {
  decision: "keep" | "skip";
  /** Fit score for the same profile, or null when the job was never scored. */
  fit: number | null;
  reason: string | null;
}

export const MIN_DECISIONS_FOR_THRESHOLD = 30;
export const MIN_AGREEMENT = 0.85;

export const FIT_BANDS = [
  { label: "8 to 10", min: 8, max: 10 },
  { label: "6 to 7", min: 6, max: 7 },
  { label: "4 to 5", min: 4, max: 5 },
  { label: "1 to 3", min: 1, max: 3 },
] as const;

export type FitBandLabel = (typeof FIT_BANDS)[number]["label"] | "Not scored";

export interface BandCount {
  band: FitBandLabel;
  keep: number;
  skip: number;
}

function validFit(fit: number | null): fit is number {
  return typeof fit === "number" && Number.isFinite(fit) && fit >= 1 && fit <= 10;
}

export function fitBand(fit: number | null): FitBandLabel {
  if (!validFit(fit)) return "Not scored";
  const rounded = Math.round(fit);
  return FIT_BANDS.find((b) => rounded >= b.min && rounded <= b.max)?.label ?? "Not scored";
}

/** Keep and skip counts per fit band, best band first, with "Not scored" last when present. */
export function countsByBand(history: readonly DecisionHistoryItem[]): BandCount[] {
  const rows: BandCount[] = [...FIT_BANDS.map((b) => ({ band: b.label as FitBandLabel, keep: 0, skip: 0 }))];
  const unscored: BandCount = { band: "Not scored", keep: 0, skip: 0 };
  for (const item of history) {
    const label = fitBand(item.fit);
    const row = label === "Not scored" ? unscored : rows.find((r) => r.band === label)!;
    row[item.decision] += 1;
  }
  return unscored.keep + unscored.skip > 0 ? [...rows, unscored] : rows;
}

export interface ReasonCount {
  reason: string;
  count: number;
}

/**
 * Most common skip reasons. Quick-pick chips are grouped by chip; free text
 * without a chip is grouped by its exact (case-insensitive) wording.
 */
export function topSkipReasons(history: readonly DecisionHistoryItem[], limit = 5): ReasonCount[] {
  const counts = new Map<string, ReasonCount>();
  for (const item of history) {
    if (item.decision !== "skip") continue;
    const { chip, note } = parseReason(item.reason);
    const label = chip ?? (note || "No reason given");
    const key = label.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { reason: label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, Math.max(0, limit));
}

export type ThresholdResult =
  | {
      threshold: number;
      /** Share of scored decisions the rule "keep when fit is at least threshold" agrees with, 0 to 1. */
      agreement: number;
      decisions: number;
      reason: string;
    }
  | {
      threshold: null;
      agreement: number | null;
      decisions: number;
      /** Scored decisions still needed before a threshold can be measured. 0 once there are enough. */
      needed: number;
      reason: string;
    };

/**
 * Suggest a fit threshold that separates the person's keeps from their skips.
 *
 * Only decisions on scored jobs count. Returns a threshold only when there are
 * at least MIN_DECISIONS_FOR_THRESHOLD of them, both keeps and skips appear,
 * and the best rule "keep when fit >= t" agrees with at least MIN_AGREEMENT of
 * them. Ties go to the higher threshold, which suggests fewer jobs.
 */
export function measureThreshold(history: readonly DecisionHistoryItem[]): ThresholdResult {
  const scored = history.filter((h) => validFit(h.fit));
  const n = scored.length;

  if (n < MIN_DECISIONS_FOR_THRESHOLD) {
    const needed = MIN_DECISIONS_FOR_THRESHOLD - n;
    return {
      threshold: null,
      agreement: null,
      decisions: n,
      needed,
      reason: `Needs ${needed} more decision${needed === 1 ? "" : "s"} on scored jobs.`,
    };
  }

  const keeps = scored.filter((h) => h.decision === "keep").length;
  if (keeps === 0 || keeps === n) {
    return {
      threshold: null,
      agreement: null,
      decisions: n,
      needed: 0,
      reason: `All ${n} decisions are ${keeps === 0 ? "skips" : "keeps"}, so there is nothing to separate yet.`,
    };
  }

  let best = { threshold: 1, agreement: -1 };
  for (let t = 1; t <= 10; t++) {
    let agree = 0;
    for (const h of scored) {
      const predictedKeep = (h.fit as number) >= t;
      if (predictedKeep === (h.decision === "keep")) agree += 1;
    }
    const agreement = agree / n;
    if (agreement >= best.agreement) best = { threshold: t, agreement };
  }

  const pct = Math.round(best.agreement * 100);
  if (best.agreement < MIN_AGREEMENT) {
    return {
      threshold: null,
      agreement: best.agreement,
      decisions: n,
      needed: 0,
      reason: `No fit score separates your keeps from skips well enough yet (best is ${pct}% at ${best.threshold}, needs ${Math.round(MIN_AGREEMENT * 100)}%).`,
    };
  }

  return {
    threshold: best.threshold,
    agreement: best.agreement,
    decisions: n,
    reason: `Keeping jobs with fit ${best.threshold} or higher matches ${pct}% of your last ${n} decisions.`,
  };
}

export interface ShortlistStats {
  total: number;
  keeps: number;
  skips: number;
  bands: BandCount[];
  topSkipReasons: ReasonCount[];
  threshold: ThresholdResult;
}

export function shortlistStats(history: readonly DecisionHistoryItem[]): ShortlistStats {
  const keeps = history.filter((h) => h.decision === "keep").length;
  return {
    total: history.length,
    keeps,
    skips: history.length - keeps,
    bands: countsByBand(history),
    topSkipReasons: topSkipReasons(history),
    threshold: measureThreshold(history),
  };
}
