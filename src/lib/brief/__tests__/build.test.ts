import { describe, expect, it } from "vitest";
import {
  briefWindowStart,
  buildBrief,
  headlineFor,
  oneLine,
  safeUrl,
  type BriefApplicationRow,
  type BriefInput,
  type BriefJobRow,
  type BriefScoreRow,
} from "../build";

const NOW = "2026-10-26T11:00:00.000Z";
const SINCE = "2026-10-25T11:00:00.000Z";
const OLD = "2026-10-01T00:00:00.000Z";
const NEW = "2026-10-26T09:00:00.000Z";

function job(id: string, overrides: Partial<BriefJobRow> = {}): BriefJobRow {
  return {
    id,
    title: `Job ${id}`,
    company: "Example Health",
    location: "Boston, MA",
    url: `https://example.com/${id}`,
    source: "linkedin",
    easy_apply: "unknown",
    created_at: OLD,
    ...overrides,
  };
}

function score(jobId: string, fit: number, overrides: Partial<BriefScoreRow> = {}): BriefScoreRow {
  return {
    job_id: jobId,
    profile_id: "p1",
    fit,
    reason: `Fit ${fit}. More detail follows here.`,
    unmet_must_haves: [],
    deal_breaker_hit: null,
    scored_at: NEW,
    ...overrides,
  };
}

function app(id: string, overrides: Partial<BriefApplicationRow> = {}): BriefApplicationRow {
  return {
    id,
    job_id: `job-${id}`,
    status: "applied",
    applied_on: null,
    follow_up_on: null,
    job: { title: `Applied ${id}`, company: "Acme", url: "https://acme.example/job" },
    ...overrides,
  };
}

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    now: NOW,
    today: "2026-10-26",
    since: SINCE,
    profiles: [{ id: "p1", name: "Director of Laboratory Services" }],
    jobs: [],
    scores: [],
    decisions: [],
    applications: [],
    queries: [],
    ...overrides,
  };
}

describe("buildBrief", () => {
  it("is calm when there is nothing", () => {
    const b = buildBrief(input());
    expect(b.headline).toBe("All quiet. Nothing new and nothing due today.");
    expect(b.counts.newJobs).toBe(0);
    expect(b.shortlist).toHaveLength(1);
    expect(b.shortlist[0].autoShortlist).toBe("off");
  });

  it("lists new jobs since the window start, best fit first", () => {
    const b = buildBrief(
      input({
        jobs: [job("a", { created_at: NEW }), job("b", { created_at: NEW }), job("old")],
        scores: [score("a", 5), score("b", 9)],
      }),
    );
    expect(b.counts.newJobs).toBe(2);
    expect(b.newJobs.map((j) => j.jobId)).toEqual(["b", "a"]);
    expect(b.newJobs[0]).toMatchObject({ fit: 9, isNew: true, reason: "Fit 9.", profileName: "Director of Laboratory Services" });
  });

  it("puts fit 7+ first in To review and leaves out decided, screened, and tracked jobs", () => {
    const b = buildBrief(
      input({
        jobs: ["a", "b", "c", "d", "e"].map((id) => job(id)),
        scores: [
          score("a", 6),
          score("b", 8),
          score("c", 9),
          score("d", 7, { deal_breaker_hit: "Contract role" }),
          score("e", 10),
        ],
        decisions: [{ job_id: "c", profile_id: "p1", decision: "keep", reason: null }],
        applications: [app("x", { job_id: "e", status: "saved" })],
      }),
    );
    expect(b.toReview.map((j) => j.jobId)).toEqual(["b", "a"]);
    expect(b.counts.strongFit).toBe(1);
    expect(b.counts.toReview).toBe(2);
  });

  it("uses the best undecided score when a job is scored against two profiles", () => {
    const b = buildBrief(
      input({
        profiles: [
          { id: "p1", name: "One" },
          { id: "p2", name: "Two" },
        ],
        jobs: [job("a")],
        scores: [score("a", 4), score("a", 8, { profile_id: "p2" })],
      }),
    );
    expect(b.toReview[0]).toMatchObject({ fit: 8, profileName: "Two" });
  });

  it("ignores scores for deleted profiles and jobs that are not loaded", () => {
    const b = buildBrief(input({ jobs: [job("a")], scores: [score("a", 9, { profile_id: "gone" }), score("zz", 9)] }));
    expect(b.counts.toReview).toBe(0);
  });

  it("flags unmet must-haves", () => {
    const b = buildBrief(
      input({ jobs: [job("a")], scores: [score("a", 7, { unmet_must_haves: ["Base pay at or above minimum"] })] }),
    );
    expect(b.unmetMustHaves).toHaveLength(1);
    expect(b.unmetMustHaves[0].unmetMustHaves).toEqual(["Base pay at or above minimum"]);
  });

  it("counts screened-out jobs scored since the window start, with reasons", () => {
    const b = buildBrief(
      input({
        jobs: ["a", "b", "c", "d"].map((id) => job(id)),
        scores: [
          score("a", 2, { deal_breaker_hit: "Contract role" }),
          score("b", 2, { deal_breaker_hit: "contract role" }),
          score("c", 2, { deal_breaker_hit: "Requires CLIA director credentials" }),
          score("d", 2, { deal_breaker_hit: "Old one", scored_at: OLD }),
        ],
      }),
    );
    expect(b.screenedOut.count).toBe(3);
    expect(b.screenedOut.reasons).toEqual([
      { reason: "Contract role", count: 2 },
      { reason: "Requires CLIA director credentials", count: 1 },
    ]);
  });

  it("groups follow-ups with the tracker's rules and counts applications this week", () => {
    const b = buildBrief(
      input({
        applications: [
          app("over", { follow_up_on: "2026-10-20", applied_on: "2026-10-13" }),
          app("today", { follow_up_on: "2026-10-26", applied_on: "2026-10-20" }),
          app("soon", { follow_up_on: "2026-11-01", applied_on: "2026-10-25" }),
          app("later", { follow_up_on: "2026-11-20" }),
          app("closed", { status: "closed", follow_up_on: "2026-10-20" }),
        ],
      }),
    );
    expect(b.followUps.overdue.map((f) => f.applicationId)).toEqual(["over"]);
    expect(b.followUps.dueToday.map((f) => f.applicationId)).toEqual(["today"]);
    expect(b.followUps.upcoming.map((f) => f.applicationId)).toEqual(["soon"]);
    expect(b.appliedThisWeek).toBe(2);
    expect(b.headline).toBe("2 follow-ups due.");
  });

  it("includes query suggestions with the profile name, only for active profiles", () => {
    const base = {
      source: "indeed",
      quality: "untested",
      runs: 3,
      relevant_hits: 0,
      total_hits: 10,
      retired: false,
    };
    const b = buildBrief(
      input({
        queries: [
          { ...base, id: "q1", profile_id: "p1", query_text: "Laboratory Administrator" },
          { ...base, id: "q2", profile_id: "deleted", query_text: "Other" },
        ],
      }),
    );
    expect(b.querySuggestions).toHaveLength(1);
    expect(b.querySuggestions[0]).toMatchObject({ queryId: "q1", recommendation: "retire", profileName: "Director of Laboratory Services" });
  });

  it("measures the shortlist threshold from the person's own decisions and keeps auto shortlist off", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => job(`j${i}`));
    const scores = jobs.map((j, i) => score(j.id, i < 15 ? 8 : 3));
    const decisions = jobs.map((j, i) => ({
      job_id: j.id,
      profile_id: "p1",
      decision: (i < 15 ? "keep" : "skip") as "keep" | "skip",
      reason: i < 15 ? null : "Pay too low",
    }));
    const b = buildBrief(input({ jobs, scores, decisions }));
    expect(b.shortlist[0].autoShortlist).toBe("off");
    expect(b.shortlist[0].threshold.threshold).toBe(8);
  });

  it("hides unsafe links and reports Easy Apply as information only", () => {
    const b = buildBrief(
      input({ jobs: [job("a", { url: "javascript:alert(1)", easy_apply: "yes", created_at: NEW })] }),
    );
    expect(b.newJobs[0]).toMatchObject({ url: null, easyApply: "yes", fit: null });
  });

  it("rejects a bad date", () => {
    expect(() => buildBrief(input({ today: "26/10/2026" }))).toThrow(RangeError);
  });
});

describe("helpers", () => {
  it("briefWindowStart: 24 hours back with no earlier brief", () => {
    expect(briefWindowStart(null, new Date(NOW))).toBe(SINCE);
  });
  it("briefWindowStart: reuses a recent brief's window, otherwise starts at the last brief", () => {
    const recent = { generated_at: "2026-10-26T11:00:00.000Z", since: "2026-10-25T11:00:00.000Z" };
    expect(briefWindowStart(recent, new Date("2026-10-26T18:00:00.000Z"))).toBe("2026-10-25T11:00:00.000Z");
    expect(briefWindowStart(recent, new Date("2026-10-27T11:00:00.000Z"))).toBe("2026-10-26T11:00:00.000Z");
  });
  it("oneLine keeps the first sentence and caps length", () => {
    expect(oneLine("Strong match. Lacks MBA.")).toBe("Strong match.");
    expect(oneLine("x".repeat(200))).toHaveLength(140);
    expect(oneLine("  ")).toBeNull();
  });
  it("safeUrl allows only http(s)", () => {
    expect(safeUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeUrl("data:text/html,hi")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
  it("headlineFor joins what matters", () => {
    expect(
      headlineFor({
        newJobs: 3,
        toReview: 5,
        strongFit: 2,
        unscored: 0,
        unmetMustHaves: 0,
        screenedOut: 0,
        followUpsOverdue: 1,
        followUpsDueToday: 0,
        followUpsUpcoming: 4,
        appliedThisWeek: 0,
        querySuggestions: 1,
      }),
    ).toBe("3 new jobs, 2 with fit 7+ to review, 1 follow-up due, 1 query suggestion.");
  });
});
