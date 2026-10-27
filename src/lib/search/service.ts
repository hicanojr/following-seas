/**
 * Search agent services.
 *
 *   runSearch:  run one saved query (LinkedIn via Apify, or USAJobs) and save the results.
 *   importJobs: save postings imported from Indeed, ZipRecruiter, or a file.
 *
 * Both pass through the same steps: gate check, noise filter, dedupe within the
 * batch and against saved jobs, insert, and an agent_runs record. Nothing here
 * applies, uses Easy Apply, sends messages, or logs in anywhere.
 */

import { dedupeKey } from "@/lib/dedupe";
import { assertAllowed } from "@/lib/gates";
import type { NormalizedJob } from "@/lib/jobs/types";
import { dedupeBatch, type DuplicateJob } from "./dedupe-batch";
import {
  ImportOnlyError,
  MissingConfigError,
  NotFoundError,
  RetiredQueryError,
  SearchError,
} from "./errors";
import { searchLinkedIn, type Recency } from "./linkedin";
import { filterNoise, noiseConfigFrom, resolveNoiseKeywords, type DroppedJob } from "./noise";
import type { ProfileNoiseRecord, QueryRecord, SearchStore } from "./store";
import { searchUsaJobs } from "./usajobs";

export interface SearchEnv {
  APIFY_TOKEN?: string;
  USAJOBS_API_KEY?: string;
  USAJOBS_USER_AGENT?: string;
}

export interface SearchDeps {
  store: SearchStore;
  env?: SearchEnv;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** What a caller (route or page) shows the person. */
export interface SaveSummary {
  received: number;
  imported: number;
  duplicates: { title: string; company: string | null; location: string | null; reason: DuplicateJob["reason"] }[];
  noise: { title: string; company: string | null; location: string | null; reason: string }[];
}

export interface SearchSummary extends SaveSummary {
  queryId: string;
  source: QueryRecord["source"];
}

function brief(job: NormalizedJob) {
  return { title: job.title, company: job.company, location: job.location };
}

/** Filter noise, dedupe, and insert. Shared by search and import. */
async function saveJobs(
  userId: string,
  jobs: NormalizedJob[],
  profile: ProfileNoiseRecord | null,
  queryFilters: Record<string, unknown> | null,
  store: SearchStore,
): Promise<SaveSummary> {
  const keywords = resolveNoiseKeywords(noiseConfigFrom(profile?.scoring_rubric, queryFilters));
  const { kept, dropped } = filterNoise(jobs, keywords);

  assertAllowed("dedupe");
  const existing = await store.existingDedupeKeys(kept.map(dedupeKey));
  const { unique, duplicates } = dedupeBatch(kept, existing);

  const inserted = unique.length ? await store.insertJobs(userId, unique) : new Set<string>();
  // A row can lose a race with another insert of the same key; count it as a duplicate.
  const raced: DuplicateJob[] = unique
    .map((job) => ({ job, key: dedupeKey(job), reason: "already_saved" as const }))
    .filter((d) => !inserted.has(d.key));

  return {
    received: jobs.length,
    imported: unique.length - raced.length,
    duplicates: [...duplicates, ...raced].map((d) => ({ ...brief(d.job), reason: d.reason })),
    noise: dropped.map((d: DroppedJob) => ({ ...brief(d.job), reason: d.reason })),
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function recency(v: unknown): Recency | null {
  return v === "day" || v === "week" || v === "month" ? v : null;
}

/** Fetch postings for a query from its source. */
async function fetchForQuery(
  query: QueryRecord,
  profile: ProfileNoiseRecord | null,
  deps: SearchDeps,
): Promise<NormalizedJob[]> {
  const env = deps.env ?? {};
  const f = query.filters ?? {};
  const location = str(f.location) ?? profile?.locations?.[0] ?? null;
  switch (query.source) {
    case "linkedin":
      return searchLinkedIn(
        {
          keywords: query.query_text,
          location: location ?? "United States",
          recency: recency(f.recency),
          count: num(f.count),
        },
        { token: env.APIFY_TOKEN, fetch: deps.fetch },
      );
    case "usajobs":
      return searchUsaJobs(
        { keywords: query.query_text, location, resultsPerPage: num(f.results_per_page) },
        { apiKey: env.USAJOBS_API_KEY, userAgent: env.USAJOBS_USER_AGENT, fetch: deps.fetch },
      );
    case "indeed":
      throw new ImportOnlyError("Indeed");
    case "ziprecruiter":
      throw new ImportOnlyError("ZipRecruiter");
    default:
      throw new SearchError("not_searchable", `Queries for ${query.source} cannot be run.`, 400);
  }
}

/** Checks that need no network, so config errors surface before a run is logged. */
function preflight(query: QueryRecord, env: SearchEnv) {
  if (query.source === "indeed") throw new ImportOnlyError("Indeed");
  if (query.source === "ziprecruiter") throw new ImportOnlyError("ZipRecruiter");
  if (query.source === "linkedin" && !env.APIFY_TOKEN) {
    throw new MissingConfigError("APIFY_TOKEN", "LinkedIn search (Apify)");
  }
  if (query.source === "usajobs") {
    if (!env.USAJOBS_API_KEY) throw new MissingConfigError("USAJOBS_API_KEY", "USAJobs search");
    if (!env.USAJOBS_USER_AGENT) throw new MissingConfigError("USAJOBS_USER_AGENT", "USAJobs search");
  }
}

export async function runSearch(
  args: { userId: string; profileId?: string | null; queryId: string },
  deps: SearchDeps,
): Promise<SearchSummary> {
  assertAllowed("search");
  const { store } = deps;
  const env = deps.env ?? {};
  const now = deps.now ?? (() => new Date());

  const query = await store.getQuery(args.queryId);
  if (!query || (args.profileId && query.profile_id !== args.profileId)) {
    throw new NotFoundError("That query");
  }
  if (query.retired) throw new RetiredQueryError();
  preflight(query, env);

  const profile = await store.getProfile(query.profile_id);
  if (!profile) throw new NotFoundError("That profile");

  const runId = await store.startRun(args.userId, "search", {
    kind: "search",
    query_id: query.id,
    profile_id: query.profile_id,
    source: query.source,
    query_text: query.query_text,
  });

  try {
    const fetched = await fetchForQuery(query, profile, deps);
    const summary = await saveJobs(args.userId, fetched, profile, query.filters, store);

    await store.updateQueryStats(query.id, {
      runs: (query.runs ?? 0) + 1,
      total_hits: (query.total_hits ?? 0) + fetched.length,
      last_run_at: now().toISOString(),
    });
    const counts = {
      fetched: fetched.length,
      imported: summary.imported,
      duplicates: summary.duplicates.length,
      noise: summary.noise.length,
    };
    await store.finishRun(runId, "succeeded", counts);
    await store.audit(args.userId, "search", { query_id: query.id, source: query.source, ...counts });
    return { ...summary, queryId: query.id, source: query.source };
  } catch (err) {
    await store.finishRun(runId, "failed", null, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function importJobs(
  args: { userId: string; jobs: NormalizedJob[]; profileId?: string | null; skipped?: number },
  deps: SearchDeps,
): Promise<SaveSummary> {
  assertAllowed("import");
  const { store } = deps;

  let profile: ProfileNoiseRecord | null = null;
  if (args.profileId) {
    profile = await store.getProfile(args.profileId);
    if (!profile) throw new NotFoundError("That profile");
  }

  const sources = [...new Set(args.jobs.map((j) => j.source))];
  const runId = await store.startRun(args.userId, "search", {
    kind: "import",
    profile_id: args.profileId ?? null,
    sources,
    rows: args.jobs.length,
    rows_skipped: args.skipped ?? 0,
  });

  try {
    const summary = await saveJobs(args.userId, args.jobs, profile, null, store);
    const counts = {
      received: summary.received,
      imported: summary.imported,
      duplicates: summary.duplicates.length,
      noise: summary.noise.length,
    };
    await store.finishRun(runId, "succeeded", counts);
    await store.audit(args.userId, "import", { sources, ...counts });
    return summary;
  } catch (err) {
    await store.finishRun(runId, "failed", null, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
