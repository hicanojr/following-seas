/**
 * LinkedIn jobs via the Apify actor curious_coder/linkedin-jobs-scraper.
 *
 * Gates (see CLAUDE.md and src/lib/gates.ts):
 *   - No LinkedIn login, no li_at or any other cookie. The actor reads the
 *     public jobs search page; this client sends only the search URL and count.
 *   - 25 to 50 results per run, enforced with clampLinkedInResults().
 *   - easy_apply is informational. Agents never use Easy Apply.
 *
 * The Apify token is server only (env APIFY_TOKEN) and is sent as a bearer
 * header, never in the URL.
 */

import { clampLinkedInResults } from "@/lib/gates";
import type { EasyApply, NormalizedJob } from "@/lib/jobs/types";
import { parseDate, parseRequirements, parseText, parseUrl } from "@/lib/importers/fields";
import { parseSalary } from "@/lib/importers/salary";
import { MissingConfigError, UpstreamError } from "./errors";

export const APIFY_LINKEDIN_ACTOR = "curious_coder~linkedin-jobs-scraper";
export const APIFY_RUN_SYNC_URL = `https://api.apify.com/v2/acts/${APIFY_LINKEDIN_ACTOR}/run-sync-get-dataset-items`;

export type Recency = "day" | "week" | "month";

const RECENCY_SECONDS: Record<Recency, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

export interface LinkedInQuery {
  keywords: string;
  location?: string | null;
  /** Posted within the last day, week, or month (LinkedIn f_TPR). */
  recency?: Recency | null;
  /** Requested result count; clamped to 25..50. */
  count?: number | null;
}

/** Public LinkedIn jobs search URL. No session or tracking parameters. */
export function buildLinkedInSearchUrl(query: LinkedInQuery): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", query.keywords.trim());
  if (query.location?.trim()) url.searchParams.set("location", query.location.trim());
  if (query.recency) url.searchParams.set("f_TPR", `r${RECENCY_SECONDS[query.recency]}`);
  return url.toString();
}

/** The actor input. Kept minimal on purpose: no cookie, no login fields. */
export function buildActorInput(query: LinkedInQuery) {
  return {
    urls: [buildLinkedInSearchUrl(query)],
    count: clampLinkedInResults(query.count),
    scrapeCompany: false,
  };
}

/**
 * easy_apply only when the item says so plainly; otherwise unknown.
 * LinkedIn's own apply flow is reported as "EasyApply" or "*OnsiteApply";
 * an off-site apply is reported as "OffsiteApply".
 */
export function linkedInEasyApply(item: Record<string, unknown>): EasyApply {
  if (item.easyApply === true || item.isEasyApply === true) return "yes";
  if (item.easyApply === false || item.isEasyApply === false) return "no";
  const method = typeof item.applyMethod === "string" ? item.applyMethod : "";
  if (/easy\s*apply|onsite\s*apply/i.test(method)) return "yes";
  if (/offsite/i.test(method)) return "no";
  return "unknown";
}

function first(item: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = item[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export function mapLinkedInItem(item: Record<string, unknown>): NormalizedJob | null {
  const title = parseText(first(item, ["title", "jobTitle"]));
  if (!title) return null;
  const salaryRaw = first(item, ["salaryInfo", "salary"]);
  const salary = parseSalary(
    Array.isArray(salaryRaw) ? salaryRaw.filter((s) => typeof s === "string").join(" - ") : salaryRaw,
  );
  const id = first(item, ["id", "jobId"]);
  return {
    source: "linkedin",
    external_id: id == null ? null : String(id),
    url: parseUrl(first(item, ["link", "jobUrl", "url"])),
    title,
    company: parseText(first(item, ["companyName", "company"])),
    location: parseText(first(item, ["location", "jobLocation"])),
    salary_min: salary.salary_min,
    salary_max: salary.salary_max,
    salary_text: salary.salary_text,
    description: parseText(first(item, ["descriptionText", "description"])),
    requirements: parseRequirements(first(item, ["requirements"])),
    easy_apply: linkedInEasyApply(item),
    posted_at: parseDate(first(item, ["postedAt", "postedDate", "listedAt"])),
  };
}

export interface LinkedInClientDeps {
  token: string | undefined;
  fetch?: typeof fetch;
}

export async function searchLinkedIn(
  query: LinkedInQuery,
  deps: LinkedInClientDeps,
): Promise<NormalizedJob[]> {
  if (!deps.token) throw new MissingConfigError("APIFY_TOKEN", "LinkedIn search (Apify)");
  const doFetch = deps.fetch ?? fetch;
  const input = buildActorInput(query);

  const res = await doFetch(APIFY_RUN_SYNC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deps.token}`,
    },
    body: JSON.stringify(input),
    credentials: "omit",
    cache: "no-store",
  });
  if (!res.ok) throw new UpstreamError("LinkedIn (Apify)", `HTTP ${res.status}`);

  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new UpstreamError("LinkedIn (Apify)", "unexpected response");

  return data
    .slice(0, input.count)
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map(mapLinkedInItem)
    .filter((j): j is NormalizedJob => j !== null);
}
