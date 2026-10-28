import { describe, expect, it, vi } from "vitest";
import { importJobs, runSearch } from "../service";
import { ImportOnlyError, MissingConfigError, NotFoundError, RetiredQueryError } from "../errors";
import type { QueryRecord } from "../store";
import { job, memoryStore } from "./helpers";

const PROFILE = { id: "p1", locations: ["Boston, MA"], scoring_rubric: { noise_keywords: ["sales"] } };

function query(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    id: "q1",
    profile_id: "p1",
    source: "linkedin",
    query_text: "Director of Laboratory Operations",
    filters: { recency: "week", count: 30 },
    retired: false,
    runs: 2,
    total_hits: 10,
    ...overrides,
  };
}

const linkedInItems = [
  { id: "1", title: "Director of Laboratory Operations", companyName: "Acme", location: "Boston, MA" },
  { id: "2", title: "Director of Laboratory Operations", companyName: "ACME", location: "Boston, MA" },
  { id: "3", title: "Registered Nurse", companyName: "Acme", location: "Boston, MA" },
  { id: "4", title: "Sales Director, Lab", companyName: "Beta", location: "Boston, MA" },
  { id: "5", title: "Lab Director", companyName: "Gamma", location: "Boston, MA" },
];

describe("runSearch", () => {
  it("fetches, filters noise, dedupes, saves, and updates the query and run log", async () => {
    const m = memoryStore({ queries: [query()], profiles: [PROFILE], existing: ["gamma|lab director|boston, ma"] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(linkedInItems), { status: 201 }));
    const summary = await runSearch(
      { userId: "u1", profileId: "p1", queryId: "q1" },
      { store: m.store, env: { APIFY_TOKEN: "t" }, fetch: fetchMock, now: () => new Date("2026-10-26T12:00:00Z") },
    );

    expect(summary).toMatchObject({ queryId: "q1", source: "linkedin", received: 5, imported: 1 });
    expect(summary.noise.map((n) => n.title)).toEqual(["Registered Nurse", "Sales Director, Lab"]);
    expect(summary.duplicates.map((d) => d.reason)).toEqual(["duplicate_in_batch", "already_saved"]);

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.count).toBe(30);
    expect(body.urls[0]).toContain("location=Boston%2C+MA");
    expect(body.urls[0]).toContain("f_TPR=r604800");

    expect(m.queryUpdates).toEqual([
      { id: "q1", patch: { runs: 3, total_hits: 15, last_run_at: "2026-10-26T12:00:00.000Z" } },
    ]);
    expect(m.runs).toHaveLength(1);
    expect(m.runs[0]).toMatchObject({
      input: { kind: "search", query_id: "q1", source: "linkedin" },
      status: "succeeded",
      output: { fetched: 5, imported: 1, duplicates: 2, noise: 2 },
    });
    expect(m.audits[0].action).toBe("search");
  });

  it("refuses retired queries", async () => {
    const m = memoryStore({ queries: [query({ retired: true })], profiles: [PROFILE] });
    await expect(runSearch({ userId: "u1", queryId: "q1" }, { store: m.store, env: { APIFY_TOKEN: "t" } })).rejects.toBeInstanceOf(
      RetiredQueryError,
    );
    expect(m.runs).toHaveLength(0);
  });

  it("does not run JobSpy sources from the app", async () => {
    for (const source of ["indeed", "ziprecruiter", "glassdoor", "google"] as const) {
      const m = memoryStore({ queries: [query({ source })], profiles: [PROFILE] });
      await expect(runSearch({ userId: "u1", queryId: "q1" }, { store: m.store })).rejects.toBeInstanceOf(ImportOnlyError);
    }
  });

  it("reports missing config before logging a run", async () => {
    const m = memoryStore({ queries: [query(), query({ id: "q2", source: "usajobs" })], profiles: [PROFILE] });
    await expect(runSearch({ userId: "u1", queryId: "q1" }, { store: m.store, env: {} })).rejects.toBeInstanceOf(MissingConfigError);
    await expect(runSearch({ userId: "u1", queryId: "q2" }, { store: m.store, env: { USAJOBS_API_KEY: "k" } })).rejects.toMatchObject({
      envVar: "USAJOBS_USER_AGENT",
      status: 503,
    });
    expect(m.runs).toHaveLength(0);
  });

  it("refuses a query from a different profile", async () => {
    const m = memoryStore({ queries: [query()], profiles: [PROFILE] });
    await expect(runSearch({ userId: "u1", profileId: "other", queryId: "q1" }, { store: m.store, env: { APIFY_TOKEN: "t" } })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("marks the run failed when the provider fails", async () => {
    const m = memoryStore({ queries: [query()], profiles: [PROFILE] });
    const fetchMock = vi.fn(async () => new Response("err", { status: 500 }));
    await expect(runSearch({ userId: "u1", queryId: "q1" }, { store: m.store, env: { APIFY_TOKEN: "t" }, fetch: fetchMock })).rejects.toThrow(
      /HTTP 500/,
    );
    expect(m.runs[0].status).toBe("failed");
    expect(m.queryUpdates).toHaveLength(0);
  });
});

describe("importJobs", () => {
  it("filters noise, dedupes, saves, and logs an import run", async () => {
    const m = memoryStore({ existing: ["old co|lab director|"] });
    const summary = await importJobs(
      {
        userId: "u1",
        jobs: [
          job({ source: "indeed" }),
          job({ source: "ziprecruiter" }),
          job({ title: "Petroleum Lab Director" }),
          job({ title: "Lab Director", company: "Old Co", location: null }),
        ],
        skipped: 1,
      },
      { store: m.store },
    );
    expect(summary.imported).toBe(1);
    expect(summary.received).toBe(4);
    expect(summary.noise).toEqual([
      { title: "Petroleum Lab Director", company: "Example Health", location: "Boston, MA", reason: 'Title matches noise keyword "petroleum"' },
    ]);
    expect(summary.duplicates.map((d) => d.reason)).toEqual(["duplicate_in_batch", "already_saved"]);
    expect(m.runs[0]).toMatchObject({
      input: { kind: "import", sources: ["indeed", "ziprecruiter", "manual"], rows: 4, rows_skipped: 1 },
      status: "succeeded",
      output: { received: 4, imported: 1, duplicates: 2, noise: 1 },
    });
    expect(m.audits[0].action).toBe("import");
  });

  it("uses the profile's noise settings when given", async () => {
    const m = memoryStore({ profiles: [{ id: "p1", locations: [], scoring_rubric: { noise_allow: ["nurse"] } }] });
    const summary = await importJobs({ userId: "u1", profileId: "p1", jobs: [job({ title: "Nurse Manager, Lab" })] }, { store: m.store });
    expect(summary.imported).toBe(1);
  });

  it("refuses an unknown profile", async () => {
    const m = memoryStore();
    await expect(importJobs({ userId: "u1", profileId: "nope", jobs: [] }, { store: m.store })).rejects.toBeInstanceOf(NotFoundError);
  });
});
