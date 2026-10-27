/**
 * Turns the profile editor's form fields into column values, and back.
 * List fields are one item per line. Existing object items (such as
 * {"label": ..., "detail": ...} from the seed) are kept as they were when
 * their label is still listed, so editing never drops their detail.
 */

import { z } from "zod";

export const PROFILE_LIST_LIMIT = 50;
export const PROFILE_ITEM_MAX = 200;

/** One label per list item. Strings are used as is; objects use label, then key. */
export function itemLabel(item: unknown): string | null {
  if (typeof item === "string") return item.trim() || null;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const o = item as Record<string, unknown>;
    for (const k of ["label", "key", "name"]) {
      if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
    }
  }
  return null;
}

export function itemLabels(value: unknown): string[] {
  return Array.isArray(value) ? value.map(itemLabel).filter((l): l is string => l !== null) : [];
}

/** Split text into trimmed, non-empty, case-insensitively unique lines. Commas are not separators. */
export function splitLines(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim().slice(0, PROFILE_ITEM_MAX);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= PROFILE_LIST_LIMIT) break;
  }
  return out;
}

/** New list from edited lines, reusing an existing item whenever its label is unchanged. */
export function mergeListItems(lines: readonly string[], existing: unknown): unknown[] {
  const byLabel = new Map<string, unknown>();
  if (Array.isArray(existing)) {
    for (const item of existing) {
      const label = itemLabel(item);
      if (label && !byLabel.has(label.toLowerCase())) byLabel.set(label.toLowerCase(), item);
    }
  }
  return lines.map((line) => byLabel.get(line.toLowerCase()) ?? line);
}

/** "$150,000", "150000", "150k" to 150000. Empty is null. Anything else is NaN. */
export function parsePay(text: string | null | undefined): number | null {
  const raw = (text ?? "").trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(raw);
  if (!match) return Number.NaN;
  const n = Number(match[1]) * (match[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : Number.NaN;
}

export interface ProfileFormInput {
  name: string;
  target_titles: string;
  locations: string;
  min_base_pay: string;
  must_haves: string;
  deal_breakers: string;
  plus_factors: string;
  noise_keywords: string;
  noise_allow: string;
}

export interface ExistingProfileLists {
  must_haves?: unknown;
  deal_breakers?: unknown;
  plus_factors?: unknown;
  scoring_rubric?: unknown;
}

export interface ProfileUpdate {
  name: string;
  target_titles: string[];
  locations: string[];
  min_base_pay: number | null;
  must_haves: unknown[];
  deal_breakers: unknown[];
  plus_factors: unknown[];
  scoring_rubric: Record<string, unknown>;
}

const NameSchema = z.string().trim().min(1, "Give the profile a name.").max(120, "Keep the name under 120 characters.");

export type ParseResult = { ok: true; value: ProfileUpdate } | { ok: false; errors: Record<string, string> };

/** Read a FormData into a plain record of the editor's fields. Missing fields are empty strings. */
export function formInput(form: { get(name: string): unknown }): ProfileFormInput {
  const s = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    name: s("name"),
    target_titles: s("target_titles"),
    locations: s("locations"),
    min_base_pay: s("min_base_pay"),
    must_haves: s("must_haves"),
    deal_breakers: s("deal_breakers"),
    plus_factors: s("plus_factors"),
    noise_keywords: s("noise_keywords"),
    noise_allow: s("noise_allow"),
  };
}

export function parseProfileForm(input: ProfileFormInput, existing: ExistingProfileLists = {}): ParseResult {
  const errors: Record<string, string> = {};

  const name = NameSchema.safeParse(input.name);
  if (!name.success) errors.name = name.error.issues[0]?.message ?? "Give the profile a name.";

  const pay = parsePay(input.min_base_pay);
  if (Number.isNaN(pay) || (pay !== null && (pay < 0 || pay > 10_000_000))) {
    errors.min_base_pay = "Enter a yearly amount in dollars, such as 150000 or $150,000, or leave it empty.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const rubric =
    existing.scoring_rubric && typeof existing.scoring_rubric === "object" && !Array.isArray(existing.scoring_rubric)
      ? { ...(existing.scoring_rubric as Record<string, unknown>) }
      : {};
  rubric.noise_keywords = splitLines(input.noise_keywords);
  rubric.noise_allow = splitLines(input.noise_allow);

  return {
    ok: true,
    value: {
      name: name.data as string,
      target_titles: splitLines(input.target_titles),
      locations: splitLines(input.locations),
      min_base_pay: pay,
      must_haves: mergeListItems(splitLines(input.must_haves), existing.must_haves),
      deal_breakers: mergeListItems(splitLines(input.deal_breakers), existing.deal_breakers),
      plus_factors: mergeListItems(splitLines(input.plus_factors), existing.plus_factors),
      scoring_rubric: rubric,
    },
  };
}

/** The editor's initial text for each field. */
export function profileToFormInput(row: Record<string, unknown>): ProfileFormInput {
  const rubric =
    row.scoring_rubric && typeof row.scoring_rubric === "object" && !Array.isArray(row.scoring_rubric)
      ? (row.scoring_rubric as Record<string, unknown>)
      : {};
  const lines = (v: unknown) => itemLabels(v).join("\n");
  return {
    name: typeof row.name === "string" ? row.name : "",
    target_titles: lines(row.target_titles),
    locations: lines(row.locations),
    min_base_pay: typeof row.min_base_pay === "number" ? String(row.min_base_pay) : "",
    must_haves: lines(row.must_haves),
    deal_breakers: lines(row.deal_breakers),
    plus_factors: lines(row.plus_factors),
    noise_keywords: lines(rubric.noise_keywords),
    noise_allow: lines(rubric.noise_allow),
  };
}
