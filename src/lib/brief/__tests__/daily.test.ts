import { describe, expect, it, vi } from "vitest";
import { GateError } from "@/lib/gates";
import {
  dailySearchCap,
  DEFAULT_DAILY_SEARCH_CAP,
  planDailySearches,
  runDailyForUser,
  startOfUtcDay,
  type DailyRunDeps,
  type PlannableQuery,
} from "../daily";
import { fakeSupabase, scopedTo, type RecordedCall } from "./fake-supabase";

const USER = "11111111-1111-1111-1111-111111111111";

function q(id: string, overrides: Partial<PlannableQuery> = {}): PlannableQuery {
  return { id, profile_id: "p1", source: "linkedin", retired: false, quality: "untested", last_run_at: null, ...overrides };
}

const configured = { linkedin: true, usajobs: true };
const active = new Set(["p1"]);

describe("dailySearchCap", () => {
  it("defaults to 10 and clamps to 0..50", () => {
    expect(dailySearchCap(undefined)).toBe(DEFAULT_DAILY_SEARCH_CAP);
    expect(dailySearchCap("")).toBe(10);
    expect(dailySearchCap("abc")).toBe(10);
    expect(dailySearchCap("4")).toBe(4);
    expect(dailySearchCap("-3")).toBe(0);
    expect(dailySearchCap("500")).toBe(50);
  });
});

describe("planDailySearches", () => {
  it("runs only LinkedIn and USAJobs; JobSpy boards are left to the worker", () => {
    const plan = planDailySearches(
      [
        q("li"),
        q("usa", { source: "usajobs" }),
        q("in", { source: "indeed" }),
        q("zr", { source: "ziprecruiter" }),
        q("gd", { source: "glassdoor" }),
        q("gg", { source: "google" }),
      ],
      { cap: 10, alreadyRunToday: 0, activeProfileIds: active, configured },
    );
    expect(plan.run.map((x) => x.id)).toEqual(["li", "usa"]);
    expect(plan.skipped).toEqual([
      { queryId: "in", reason: "indeed is run by the JobSpy worker" },
      { queryId: "zr", reason: "ziprecruiter is run by the JobSpy worker" },
      { queryId: "gd", reason: "glassdoor is run by the JobSpy worker" },
      { queryId: "gg", reason: "google is run by the JobSpy worker" },
    ]);
  });

  it("skips retired, noise, deleted-profile, and unconfigured queries", () => {
    const plan = planDailySearches(
      [q("retired", { retired: true }), q("noise", { quality: "noise" }), q("orphan", { profile_id: "gone" }), q("usa", { source: "usajobs" })],
      { cap: 10, alreadyRunToday: 0, activeProfileIds: active, configured: { linkedin: true, usajobs: false } },
    );
    expect(plan.run).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["marked noise", "usajobs is not configured"]);
  });

  it("runs stalest first, up to the cap less what already ran today", () => {
    const plan = planDailySearches(
      [
        q("recent", { last_run_at: "2026-10-25T00:00:00Z" }),
        q("never"),
        q("older", { last_run_at: "2026-10-01T00:00:00Z" }),
      ],
      { cap: 3, alreadyRunToday: 1, activeProfileIds: active, configured },
    );
    expect(plan.run.map((x) => x.id)).toEqual(["never", "older"]);
    expect(plan.skipped).toEqual([{ queryId: "recent", reason: "daily search cap reached" }]);
  });

  it("runs nothing once the cap is used up", () => {
    const plan = planDailySearches([q("a")], { cap: 10, alreadyRunToday: 12, activeProfileIds: active, configured });
    expect(plan.run).toEqual([]);
  });
});

describe("startOfUtcDay", () => {
  it("is midnight UTC", () => {
    expect(startOfUtcDay(new Date("2026-10-26T23:59:00-04:00"))).toBe("2026-10-27T00:00:00.000Z");
  });
});

/** Answers each table the way runDailyForUser expects. */
function responder(opts: { dailyRun?: boolean; ranToday?: number; queries?: PlannableQuery[] } = {}) {
  return (rec: RecordedCall) => {
    const has = (m: string) => rec.calls.some(([name]) => name === m);
    switch (rec.table) {
      case "brief_settings":
        return { data: opts.dailyRun === false ? { daily_run: false } : null };
      case "agent_runs":
        if (has("insert")) return { data: { id: "run-1" } };
        if (has("select")) return { count: opts.ranToday ?? 0 };
        return {};
      case "profiles":
        return { data: [{ id: "p1", name: "Director" }] };
      case "queries":
        return { data: opts.queries ?? [] };
      case "briefs":
        return { data: has("upsert") ? null : null };
      case "jobs":
        return { data: [{ id: "j-new", title: "New", company: null, location: null, url: null, source: "linkedin", easy_apply: "unknown", created_at: new Date().toISOString() }] };
      default:
        return { data: [] };
    }
  };
}

function deps(client: DailyRunDeps["supabase"], overrides: Partial<DailyRunDeps> = {}): DailyRunDeps {
  return {
    supabase: client,
    now: () => new Date("2026-10-26T11:00:00.000Z"),
    searchEnv: { APIFY_TOKEN: "test", USAJOBS_API_KEY: "test", USAJOBS_USER_AGENT: "test@example.com" },
    cap: 10,
    runSearch: vi.fn(async (args) => ({
      queryId: args.queryId,
      source: "linkedin" as const,
      received: 25,
      imported: 3,
      duplicates: [],
      noise: [],
    })),
    scoring: null,
    ...overrides,
  };
}

describe("runDailyForUser", () => {
  it("skips a person who turned the daily run off, without touching anything else", async () => {
    const { client, log } = fakeSupabase(responder({ dailyRun: false }));
    const d = deps(client);
    const r = await runDailyForUser(USER, d);
    expect(r.status).toBe("skipped");
    expect(d.runSearch).not.toHaveBeenCalled();
    expect(log.map((x) => x.table)).toEqual(["brief_settings"]);
  });

  it("runs planned searches, skips scoring without a key, stores the brief, and scopes every query to the user", async () => {
    const { client, log } = fakeSupabase(
      responder({ queries: [q("li"), q("usa", { source: "usajobs" })], ranToday: 9 }),
    );
    const d = deps(client);
    const r = await runDailyForUser(USER, d);

    expect(r.status).toBe("succeeded");
    // Cap 10 with 9 already run today: one search.
    expect(d.runSearch).toHaveBeenCalledTimes(1);
    expect(r.skippedQueries).toEqual([{ queryId: "usa", reason: "daily search cap reached" }]);
    expect(r.scored).toBe(0);
    expect(r.briefSaved).toBe(true);
    expect(log.some((x) => x.table === "scores" && x.calls.some(([m]) => m === "upsert"))).toBe(false);

    const brief = log.find((x) => x.table === "briefs" && x.calls.some(([m]) => m === "upsert"));
    expect(brief).toBeDefined();
    for (const rec of log) expect(scopedTo(rec, USER), `${rec.table} ${JSON.stringify(rec.calls)}`).toBe(true);
    expect(log.filter((x) => x.table === "audit_log")).toHaveLength(1);
  });

  it("passes the search a store scoped to the user, never the RLS store", async () => {
    const { client } = fakeSupabase(responder({ queries: [q("li")] }));
    const d = deps(client);
    await runDailyForUser(USER, d);
    const call = vi.mocked(d.runSearch).mock.calls[0];
    expect(call[0]).toEqual({ userId: USER, profileId: "p1", queryId: "li" });
    expect(typeof call[1].store.existingDedupeKeys).toBe("function");
  });

  it("scores new jobs only when scoring is configured, with explicit job ids", async () => {
    const { client } = fakeSupabase(responder());
    const scoreJobs = vi.fn(async () => ({
      runId: "s1",
      scored: 1,
      screenedOut: 0,
      prefiltered: 0,
      awaitingEmbedding: 0,
      failed: [],
    }));
    const r = await runDailyForUser(USER, deps(client, { scoring: { scoreJobs, client: {} as never, model: "m" } }));
    expect(scoreJobs).toHaveBeenCalledWith(
      { userId: USER, profileId: "p1", jobIds: ["j-new"] },
      expect.objectContaining({ supabase: client, model: "m" }),
    );
    expect(r.scored).toBe(1);
  });

  it("records a failed search and carries on to the brief", async () => {
    const { client } = fakeSupabase(responder({ queries: [q("li")] }));
    const r = await runDailyForUser(
      USER,
      deps(client, { runSearch: vi.fn(async () => Promise.reject(new GateError("easy_apply", "forbidden"))) }),
    );
    expect(r.searches).toEqual([{ queryId: "li", ok: false, error: expect.stringMatching(/forbidden/) }]);
    expect(r.briefSaved).toBe(true);
  });
});
