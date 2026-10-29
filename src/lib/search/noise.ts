/**
 * Noise filter: drops postings whose title shows they are outside the search,
 * such as nursing or cannabis roles. Every dropped posting comes back with the
 * keyword that matched, so nothing is lost silently.
 *
 * The defaults come from the trial search log (director-lab-services tracker,
 * "Search log" sheet), where these titles were the bulk of the noise.
 */

import type { NormalizedJob } from "@/lib/jobs/types";

export const DEFAULT_NOISE_KEYWORDS: readonly string[] = Object.freeze([
  "nurse",
  "nursing",
  "RN",
  "CRNA",
  "physician",
  "cannabis",
  "petroleum",
  "research scientist",
  "dental",
  "dentist",
  "pharmacist",
  "forensic",
  "food testing",
  "agricultural",
]);

export interface NoiseConfig {
  /** Extra title keywords to treat as noise. */
  add?: string[];
  /** Default keywords to stop treating as noise. */
  allow?: string[];
}

export interface DroppedJob {
  job: NormalizedJob;
  reason: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
    : [];
}

/**
 * Read a noise config from a profile's scoring_rubric or a query's filters.
 * Both use the keys `noise_keywords` (added) and `noise_allow` (removed).
 */
export function noiseConfigFrom(...sources: (Record<string, unknown> | null | undefined)[]): NoiseConfig {
  const add: string[] = [];
  const allow: string[] = [];
  for (const s of sources) {
    if (!s) continue;
    add.push(...strings(s.noise_keywords));
    allow.push(...strings(s.noise_allow));
  }
  return { add, allow };
}

/** Defaults plus additions, minus allowed words. Case-insensitive, no duplicates. */
export function resolveNoiseKeywords(config: NoiseConfig = {}): string[] {
  const allow = new Set((config.allow ?? []).map((k) => k.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...DEFAULT_NOISE_KEYWORDS, ...(config.add ?? [])]) {
    const key = k.trim().toLowerCase();
    if (!key || allow.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(k.trim());
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole word, case-insensitive match, allowing a plural "s".
 * "RN" matches "RN Manager" but not "Eastern".
 */
export function matchNoise(title: string, keywords: readonly string[]): string | null {
  for (const k of keywords) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- keyword is regex-escaped, so the pattern is a literal match with no backtracking risk
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(k.toLowerCase())}s?(?:$|[^a-z0-9])`, "i");
    if (pattern.test(title.toLowerCase())) return k;
  }
  return null;
}

export function filterNoise(
  jobs: NormalizedJob[],
  keywords: readonly string[] = DEFAULT_NOISE_KEYWORDS,
): { kept: NormalizedJob[]; dropped: DroppedJob[] } {
  const kept: NormalizedJob[] = [];
  const dropped: DroppedJob[] = [];
  for (const job of jobs) {
    const hit = matchNoise(job.title, keywords);
    if (hit) dropped.push({ job, reason: `Title matches noise keyword "${hit}"` });
    else kept.push(job);
  }
  return { kept, dropped };
}
