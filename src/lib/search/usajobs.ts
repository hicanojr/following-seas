/**
 * USAJobs official search API, for VA and federal lab roles.
 * https://developer.usajobs.gov/api-reference/get-api-search
 *
 * Needs a free API key (env USAJOBS_API_KEY) and the email it was issued to,
 * sent as the User-Agent (env USAJOBS_USER_AGENT). Both are server only.
 */

import type { NormalizedJob } from "@/lib/jobs/types";
import { parseDate, parseText, parseUrl } from "@/lib/importers/fields";
import { HOURS_PER_YEAR } from "@/lib/importers/salary";
import { MissingConfigError, UpstreamError } from "./errors";

export const USAJOBS_SEARCH_URL = "https://data.usajobs.gov/api/search";
export const USAJOBS_MAX_RESULTS = 50;

export interface UsaJobsQuery {
  keywords: string;
  location?: string | null;
  resultsPerPage?: number | null;
}

export function buildUsaJobsUrl(query: UsaJobsQuery): string {
  const url = new URL(USAJOBS_SEARCH_URL);
  url.searchParams.set("Keyword", query.keywords.trim());
  if (query.location?.trim()) url.searchParams.set("LocationName", query.location.trim());
  const requested = query.resultsPerPage ?? USAJOBS_MAX_RESULTS;
  const perPage = Math.min(USAJOBS_MAX_RESULTS, Math.max(1, Math.floor(requested)));
  url.searchParams.set("ResultsPerPage", String(Number.isFinite(perPage) ? perPage : USAJOBS_MAX_RESULTS));
  return url.toString();
}

interface Remuneration {
  MinimumRange?: string | number;
  MaximumRange?: string | number;
  RateIntervalCode?: string;
  Description?: string;
}

/** Annual multiplier for a USAJobs rate interval, or null when it is not clear. */
function annualFactor(rate: Remuneration): number | null {
  const code = `${rate.RateIntervalCode ?? ""} ${rate.Description ?? ""}`.toLowerCase();
  if (/\bpa\b|per year|annum/.test(code)) return 1;
  if (/\bph\b|per hour/.test(code)) return HOURS_PER_YEAR;
  if (/\bpm\b|per month/.test(code)) return 12;
  if (/\bbw\b|bi-?weekly/.test(code)) return 26;
  if (/\bpw\b|per week/.test(code)) return 52;
  return null;
}

function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function salaryFrom(list: unknown): Pick<NormalizedJob, "salary_min" | "salary_max" | "salary_text"> {
  const rate = Array.isArray(list) ? (list[0] as Remuneration | undefined) : undefined;
  if (!rate) return { salary_min: null, salary_max: null, salary_text: null };
  const min = money(rate.MinimumRange);
  const max = money(rate.MaximumRange);
  const interval = rate.Description ?? rate.RateIntervalCode ?? "";
  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
  const text =
    min != null || max != null
      ? [min != null ? fmt(min) : null, max != null ? fmt(max) : null].filter(Boolean).join(" - ") +
        (interval ? ` ${interval}` : "")
      : null;
  const factor = annualFactor(rate);
  if (factor == null) return { salary_min: null, salary_max: null, salary_text: text };
  return {
    salary_min: min == null ? null : Math.round(min * factor),
    salary_max: max == null ? null : Math.round(max * factor),
    salary_text: text,
  };
}

export function mapUsaJobsItem(item: Record<string, unknown>): NormalizedJob | null {
  const d = (item.MatchedObjectDescriptor ?? item) as Record<string, unknown>;
  const title = parseText(d.PositionTitle);
  if (!title) return null;
  const details = ((d.UserArea as Record<string, unknown> | undefined)?.Details ?? {}) as Record<
    string,
    unknown
  >;
  const qualification = parseText(d.QualificationSummary);
  const id = item.MatchedObjectId ?? d.PositionID;
  return {
    source: "usajobs",
    external_id: id == null ? null : String(id),
    url: parseUrl(d.PositionURI),
    title,
    company: parseText(d.OrganizationName) ?? parseText(d.DepartmentName),
    location: parseText(d.PositionLocationDisplay),
    ...salaryFrom(d.PositionRemuneration),
    description: parseText(details.JobSummary),
    requirements: qualification ? [qualification] : [],
    // USAJobs applications go through the federal application system; there is no Easy Apply.
    easy_apply: "no",
    posted_at: parseDate(d.PublicationStartDate),
  };
}

export interface UsaJobsClientDeps {
  apiKey: string | undefined;
  userAgent: string | undefined;
  fetch?: typeof fetch;
}

export async function searchUsaJobs(query: UsaJobsQuery, deps: UsaJobsClientDeps): Promise<NormalizedJob[]> {
  if (!deps.apiKey) throw new MissingConfigError("USAJOBS_API_KEY", "USAJobs search");
  if (!deps.userAgent) throw new MissingConfigError("USAJOBS_USER_AGENT", "USAJobs search");
  const doFetch = deps.fetch ?? fetch;

  const res = await doFetch(buildUsaJobsUrl(query), {
    method: "GET",
    headers: {
      "User-Agent": deps.userAgent,
      "Authorization-Key": deps.apiKey,
    },
    credentials: "omit",
    cache: "no-store",
  });
  if (!res.ok) throw new UpstreamError("USAJobs", `HTTP ${res.status}`);

  const data = (await res.json()) as { SearchResult?: { SearchResultItems?: unknown[] } };
  const items = data?.SearchResult?.SearchResultItems;
  if (!Array.isArray(items)) throw new UpstreamError("USAJobs", "unexpected response");
  return items
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map(mapUsaJobsItem)
    .filter((j): j is NormalizedJob => j !== null);
}
