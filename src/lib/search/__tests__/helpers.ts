import { dedupeKey } from "@/lib/dedupe";
import type { NormalizedJob } from "@/lib/jobs/types";
import type { ProfileNoiseRecord, QueryRecord, SearchStore } from "../store";

export function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "manual",
    external_id: null,
    url: null,
    title: "Director of Laboratory Services",
    company: "Example Health",
    location: "Boston, MA",
    salary_min: null,
    salary_max: null,
    salary_text: null,
    description: null,
    requirements: [],
    easy_apply: "unknown",
    posted_at: null,
    ...overrides,
  };
}

/** In-memory SearchStore that records every call. */
export function memoryStore(init: {
  queries?: QueryRecord[];
  profiles?: ProfileNoiseRecord[];
  existing?: string[];
} = {}) {
  const saved = new Map<string, NormalizedJob>();
  for (const k of init.existing ?? []) saved.set(k, job());
  const runs: { id: string; input: Record<string, unknown>; status?: string; output?: unknown; error?: unknown }[] = [];
  const queryUpdates: { id: string; patch: unknown }[] = [];
  const audits: { action: string; details: unknown }[] = [];

  const store: SearchStore = {
    async getQuery(id) {
      return init.queries?.find((q) => q.id === id) ?? null;
    },
    async getProfile(id) {
      return init.profiles?.find((p) => p.id === id) ?? null;
    },
    async existingDedupeKeys(keys) {
      return new Set(keys.filter((k) => saved.has(k)));
    },
    async insertJobs(_userId, jobs) {
      const inserted = new Set<string>();
      for (const j of jobs) {
        const k = dedupeKey(j);
        if (!saved.has(k)) {
          saved.set(k, j);
          inserted.add(k);
        }
      }
      return inserted;
    },
    async updateQueryStats(id, patch) {
      queryUpdates.push({ id, patch });
    },
    async startRun(_userId, _agent, input) {
      const id = `run-${runs.length + 1}`;
      runs.push({ id, input });
      return id;
    },
    async finishRun(id, status, output, error) {
      const r = runs.find((x) => x.id === id);
      if (r) Object.assign(r, { status, output, error });
    },
    async audit(_userId, action, details) {
      audits.push({ action, details });
    },
  };
  return { store, saved, runs, queryUpdates, audits };
}
