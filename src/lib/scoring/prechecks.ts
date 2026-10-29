/**
 * Deterministic pre-checks for the Scoring agent. Pure functions, no I/O.
 *
 * They run before any model call so the rules that matter most (pay floor,
 * deal-breakers, credentials the person does not hold) never depend on a model.
 */

import type { JobRow, ProfileRow } from "@/lib/jobs/types";
import type { CareerFacts, PrecheckResult } from "./types";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Everything in the posting that a person would read, joined for matching. */
export function jobText(job: Pick<JobRow, "title" | "company" | "location" | "salary_text" | "description" | "requirements">): string {
  return [job.title, job.company, job.location, job.salary_text, job.description, ...(job.requirements ?? [])]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Case-insensitive phrase match. Word boundaries apply at the phrase edges when
 * the edge is a word character, so "contract" does not match "contractor".
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalizeSpace(phrase);
  if (!p) return false;
  const body = escapeRegExp(p).replace(/ /g, "\\s+");
  const start = /^\w/.test(p) ? "\\b" : "";
  const end = /\w$/.test(p) ? "\\b" : "";
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- phrase is regex-escaped, so the pattern is a literal match with no backtracking risk
  return new RegExp(`${start}${body}${end}`, "i").test(text);
}

export function formatUsd(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** Remove blanks and case-insensitive duplicates, keeping first spelling and order. */
export function dedupeList(items: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = normalizeSpace(String(raw ?? ""));
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Requirement segments
// ---------------------------------------------------------------------------

export interface Segment {
  text: string;
  /** True when the segment sits in a requirements list or section. */
  inRequirements: boolean;
}

const REQUIREMENT_HEADING =
  /^(?:minimum\s+|basic\s+|required\s+)?(?:requirements|qualifications|required|education(?:\s+and\s+experience)?|what you(?:'|’)?ll need|what you need|must[- ]haves?|you have)\b\s*:?/i;
const OTHER_HEADING =
  /^(?:preferred(?:\s+qualifications)?|nice to have|bonus|benefits|perks|responsibilities|duties|what you(?:'|’)?ll do|about (?:us|the role|the company)|compensation|schedule)\b\s*:?/i;

/**
 * Split a posting into short segments (lines, bullets, sentences) and mark the
 * ones that read as requirements: items from job.requirements, and lines under a
 * "Requirements" or "Qualifications" heading until another heading starts.
 */
export function segmentJob(job: Pick<JobRow, "description" | "requirements">): Segment[] {
  const segments: Segment[] = [];
  for (const req of job.requirements ?? []) {
    for (const piece of splitSentences(String(req))) segments.push({ text: piece, inRequirements: true });
  }
  let inRequirements = false;
  for (const rawLine of (job.description ?? "").split(/\r?\n|[•▪●◦]/)) {
    const line = rawLine.replace(/^[\s\-*–—]+/, "").trim();
    if (!line) continue;
    if (REQUIREMENT_HEADING.test(line)) inRequirements = true;
    else if (OTHER_HEADING.test(line)) inRequirements = false;
    for (const piece of splitSentences(line)) segments.push({ text: piece, inRequirements });
  }
  return segments;
}

/** Sentence split that leaves abbreviations like "M.D." and "Ph.D." intact. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[a-z0-9)])[.;]\s+(?=[A-Z])|;\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const REQUIRED_WORDS = /\b(?:requir(?:e|ed|es|ement|ements)|must|minimum|mandatory|necessary|needed|qualifi(?:ed|cation|cations)|eligib(?:le|ility))\b/i;
const PREFERRED_WORDS = /\b(?:prefer(?:red|ably)?|a plus|desired|desirable|nice to have|bonus|ideal(?:ly)?)\b/i;

/** A segment reads as a requirement, not a preference. */
function isRequirement(seg: Segment): boolean {
  const required = REQUIRED_WORDS.test(seg.text);
  const preferred = PREFERRED_WORDS.test(seg.text);
  if (preferred && !required) return false;
  return required || seg.inRequirements;
}

// ---------------------------------------------------------------------------
// Credential detectors
// ---------------------------------------------------------------------------

// Case-sensitive on purpose: "MD" and "DO" only as capitalized degree marks,
// and "MD" not when it follows a comma (", MD" is Maryland).
const DOCTORAL_MARK = /(?:\bM\.D\.|(?<!,\s?)\bMD\b|\bD\.O\.|\bDO\b|\bPh\.\s?D\.?|\bPhD\b|\bDrPH\b|\bDCLS\b|\bD\.Sc\.|\bDSc\b)/;
const DOCTORAL_WORD = /\b(?:doctoral|doctorate|doctor of)\b/i;
const BOARD_CERT = /\bboard[- ]certifi(?:ed|cation)\b|\bAmerican Board of\b|\b(?:ABB|ABMM|ABCC|ABMLI|ABPath)\b/i;
const DIRECTOR_CONTEXT = /\bCLIA\b|\b(?:laboratory|lab|clinical|medical|technical)\s+director\b|\bdirector of (?:the )?(?:clinical )?lab(?:oratory)?\b/i;

export const CLIA_DIRECTOR_GAP =
  "Requires CLIA laboratory director credentials (MD, DO, or doctoral degree, or lab director board certification)";

/**
 * The posting appears to require the credentials of a CLIA laboratory director:
 * a doctoral degree or director board certification, stated as a requirement,
 * in a posting that names a laboratory director or CLIA role.
 */
export function requiresCliaDirectorCredentials(job: JobRow): boolean {
  const all = jobText(job);
  if (!DIRECTOR_CONTEXT.test(all)) return false;
  return segmentJob(job).some((seg) => {
    const credential = DOCTORAL_MARK.test(seg.text) || DOCTORAL_WORD.test(seg.text) || BOARD_CERT.test(seg.text);
    return credential && isRequirement(seg);
  });
}

const BACHELOR_REQ = /\bbachelor(?:'|’)?s?\b|\bB\.S\.|\bBS\b(?!\s*\()|\bB\.A\.|\bBA degree\b|\bfour[- ]year degree\b|\b4[- ]year degree\b|\bbaccalaureate\b/i;
// Higher degrees imply a bachelor's. Bare "MS" and "MD" are left out: they are
// as likely to mean "MS Office" or Maryland as a degree.
const FACTS_HAVE_BACHELOR =
  /\bbachelor|\bbaccalaureate\b|\bB\.S\.|\bBS (?:in|degree)\b|\bB\.A\.|\bBA (?:in|degree)\b|\bmaster|\bM\.S\.|\bMS (?:in|degree)\b|\bMBA\b|\bdoctor|\bPh\.?\s?D\b|\bM\.D\./i;

export function factsText(facts: CareerFacts | null | undefined): string {
  if (!facts) return "";
  return [facts.credentials, facts.experience, facts.other].filter(Boolean).join("\n");
}

/** The posting requires a bachelor's degree and the career facts list none. */
export function bachelorGap(job: JobRow, facts: CareerFacts | null | undefined): string | null {
  const ft = factsText(facts);
  if (FACTS_HAVE_BACHELOR.test(ft)) return null;
  const seg = segmentJob(job).find((s) => BACHELOR_REQ.test(s.text) && isRequirement(s));
  if (!seg) return null;
  const equivalent = /\bequivalen(?:t|cy)\b/i.test(seg.text);
  return equivalent
    ? "Bachelor's degree required (posting allows equivalent experience); no bachelor's degree in your career facts"
    : "Bachelor's degree required; no bachelor's degree in your career facts";
}

// MT/MLS/CLS abbreviations case-sensitive so "mt" or "cls" in prose do not count.
const MT_MARK = /\bMT\b|\bMLS\b|\bCLS\b|\bMT\(ASCP\)|\bMLS\(ASCP\)/;
const MT_WORDS = /\bmedical technologist\b|\bmedical laboratory scientist\b|\bclinical laboratory scientist\b/i;
const MLT_MARK = /\bMLT\b|\bmedical laboratory technician\b|\bclinical laboratory technician\b/i;
const CERT_CONTEXT = /\bcertifi(?:ed|cation)\b|\blicen[cs](?:e|ed|ure)\b|\bASCP\b|\bAMT\b|\bregist(?:ered|ry|ration)\b|\beligib/i;

export const MT_MLS_GAP = "Requires Medical Technologist / MT / MLS certification; your career facts list MLT only";

/**
 * The posting requires MT or MLS certification and the career facts list MLT
 * but no MT, MLS, or CLS. Postings that also accept MLT are not flagged.
 */
export function mtMlsGap(job: JobRow, facts: CareerFacts | null | undefined): string | null {
  const ft = factsText(facts);
  if (!MLT_MARK.test(ft)) return null;
  if (MT_MARK.test(ft) || MT_WORDS.test(ft)) return null;
  const segments = segmentJob(job);
  const titleIsMt = MT_MARK.test(job.title) || MT_WORDS.test(job.title);
  const hit = segments.some((seg) => {
    const mentionsMt = MT_MARK.test(seg.text) || MT_WORDS.test(seg.text);
    if (!mentionsMt || MLT_MARK.test(seg.text)) return false;
    return isRequirement(seg) && (CERT_CONTEXT.test(seg.text) || seg.inRequirements || titleIsMt);
  });
  if (!hit) return null;
  if (MLT_MARK.test(jobText(job))) return null; // posting accepts MLT somewhere
  return MT_MLS_GAP;
}

// ---------------------------------------------------------------------------
// Pay, must-haves, deal-breakers
// ---------------------------------------------------------------------------

/** Values under this are treated as hourly rates and annualized (2,080 hours). */
const HOURLY_CEILING = 500;
const HOURS_PER_YEAR = 2080;

function annualize(amount: number): number {
  return amount < HOURLY_CEILING ? amount * HOURS_PER_YEAR : amount;
}

export interface PayCheck {
  met: string | null;
  gap: string | null;
  unmet: string | null;
}

export function checkPay(job: Pick<JobRow, "salary_min" | "salary_max">, minBasePay: number | null): PayCheck {
  const posted = job.salary_max ?? job.salary_min;
  if (posted == null || !Number.isFinite(posted) || posted <= 0) {
    return { met: null, gap: "Pay not listed", unmet: null };
  }
  if (minBasePay == null || minBasePay <= 0) return { met: null, gap: null, unmet: null };
  const annual = annualize(posted);
  if (annual < minBasePay) {
    return { met: null, gap: null, unmet: `Pay below minimum (${formatUsd(minBasePay)})` };
  }
  return { met: `Pay clears minimum (${formatUsd(minBasePay)})`, gap: null, unmet: null };
}

/** The first deal-breaker phrase found in the posting, as the profile spells it. */
export function findDealBreaker(job: JobRow, dealBreakers: readonly string[]): string | null {
  const text = jobText(job);
  for (const phrase of dealBreakers ?? []) {
    if (typeof phrase === "string" && containsPhrase(text, phrase)) return normalizeSpace(phrase);
  }
  return null;
}

/** Split must-haves into those the posting states word for word and the rest. */
export function splitMustHaves(job: JobRow, mustHaves: readonly string[]) {
  const text = jobText(job);
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  for (const item of dedupeList(mustHaves ?? [])) {
    (containsPhrase(text, item) ? confirmed : unconfirmed).push(item);
  }
  return { confirmed, unconfirmed };
}

// ---------------------------------------------------------------------------
// All checks
// ---------------------------------------------------------------------------

export function runPrechecks(job: JobRow, profile: ProfileRow, facts: CareerFacts | null | undefined): PrecheckResult {
  const requirements_met: string[] = [];
  const gaps: string[] = [];
  const unmet: string[] = [];
  const hard_gaps: string[] = [];

  const pay = checkPay(job, profile.min_base_pay);
  if (pay.met) requirements_met.push(pay.met);
  if (pay.gap) gaps.push(pay.gap);
  if (pay.unmet) unmet.push(pay.unmet);

  if (requiresCliaDirectorCredentials(job)) {
    gaps.push(CLIA_DIRECTOR_GAP);
    hard_gaps.push(CLIA_DIRECTOR_GAP);
  }
  const bachelor = bachelorGap(job, facts);
  if (bachelor) gaps.push(bachelor);
  const mt = mtMlsGap(job, facts);
  if (mt) gaps.push(mt);

  if (!factsText(facts).trim()) gaps.push("No career facts on file, so experience could not be checked");

  const { confirmed, unconfirmed } = splitMustHaves(job, profile.must_haves);
  for (const item of confirmed) requirements_met.push(`Must-have: ${item}`);

  return {
    requirements_met: dedupeList(requirements_met),
    gaps: dedupeList(gaps),
    unmet_must_haves: dedupeList(unmet),
    confirmed_must_haves: confirmed,
    unconfirmed_must_haves: unconfirmed,
    deal_breaker_hit: findDealBreaker(job, profile.deal_breakers),
    hard_gaps,
  };
}
