import { describe, expect, it } from "vitest";
import {
  formInput,
  itemLabels,
  mergeListItems,
  parsePay,
  parseProfileForm,
  profileToFormInput,
  splitLines,
  type ProfileFormInput,
} from "../profile-form";
import { composeReason, DecisionBodySchema, parseReason, reasonFor } from "../reasons";
import { groupJobs, parseJobView } from "../views";

const JOB = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";

describe("reasons", () => {
  it("composes and parses chip plus note", () => {
    expect(composeReason("Pay too low", "  tops out at  $90k ")).toBe("Pay too low: tops out at $90k");
    expect(composeReason("Company", "")).toBe("Company");
    expect(composeReason(null, "great team")).toBe("great team");
    expect(composeReason(null, "   ")).toBeNull();
    expect(parseReason("Pay too low: tops out at $90k")).toEqual({ chip: "Pay too low", note: "tops out at $90k" });
    expect(parseReason("Contract or temp")).toEqual({ chip: "Contract or temp", note: "" });
    expect(parseReason("Night shift")).toEqual({ chip: null, note: "Night shift" });
    expect(parseReason(null)).toEqual({ chip: null, note: "" });
  });

  it("requires a chip or text for a skip, but not for a keep", () => {
    expect(DecisionBodySchema.safeParse({ jobId: JOB, profileId: PROFILE, decision: "skip" }).success).toBe(false);
    expect(DecisionBodySchema.safeParse({ jobId: JOB, profileId: PROFILE, decision: "skip", note: " " }).success).toBe(false);
    expect(DecisionBodySchema.safeParse({ jobId: JOB, profileId: PROFILE, decision: "skip", chip: "Other" }).success).toBe(true);
    expect(DecisionBodySchema.safeParse({ jobId: JOB, profileId: PROFILE, decision: "keep" }).success).toBe(true);
    expect(DecisionBodySchema.safeParse({ jobId: "x", profileId: PROFILE, decision: "keep" }).success).toBe(false);
    expect(DecisionBodySchema.safeParse({ jobId: JOB, profileId: PROFILE, decision: "skip", chip: "Bored" }).success).toBe(false);
  });

  it("never stores a skip chip on a keep", () => {
    const body = DecisionBodySchema.parse({ jobId: JOB, profileId: PROFILE, decision: "keep", chip: "Company", note: "Good fit" });
    expect(reasonFor(body)).toBe("Good fit");
    const skip = DecisionBodySchema.parse({ jobId: JOB, profileId: PROFILE, decision: "skip", chip: "Company", note: "agency" });
    expect(reasonFor(skip)).toBe("Company: agency");
  });
});

describe("views", () => {
  const jobs = [
    { jobId: "a", fit: 6, dealBreakerHit: null },
    { jobId: "b", fit: 9, dealBreakerHit: null },
    { jobId: "c", fit: 4, dealBreakerHit: "Night shift" },
    { jobId: "d", fit: 8, dealBreakerHit: "Night shift" },
    { jobId: "e", fit: 3, dealBreakerHit: null },
  ];

  it("puts decided jobs under Kept or Skipped, even deal-breaker hits", () => {
    const decisions = new Map([
      ["d", { decision: "keep" as const, reason: null }],
      ["e", { decision: "skip" as const, reason: "Other" }],
    ]);
    const g = groupJobs(jobs, decisions);
    expect(g.review.map((j) => j.jobId)).toEqual(["b", "a"]);
    expect(g.kept.map((j) => j.jobId)).toEqual(["d"]);
    expect(g.skipped.map((j) => j.jobId)).toEqual(["e"]);
    expect(g.screened.map((j) => j.jobId)).toEqual(["c"]);
  });

  it("defaults unknown views to To review", () => {
    expect(parseJobView("kept")).toBe("kept");
    expect(parseJobView("nope")).toBe("review");
    expect(parseJobView(undefined)).toBe("review");
  });
});

describe("profile form", () => {
  const base: ProfileFormInput = {
    name: " Director of Lab Services ",
    target_titles: "Director of Laboratory Services\n\nLab Director\nlab director\n",
    locations: "",
    min_base_pay: "$150,000",
    must_haves: "Base pay at or above minimum\nNew must-have",
    deal_breakers: "",
    plus_factors: "Remote",
    noise_keywords: "veterinary\n",
    noise_allow: "forensic",
  };

  it("splits lines, trims, and drops duplicates", () => {
    expect(splitLines(" a \n\nb\nA\r\nc, d")).toEqual(["a", "b", "c, d"]);
  });

  it("parses pay", () => {
    expect(parsePay("$150,000")).toBe(150000);
    expect(parsePay("150k")).toBe(150000);
    expect(parsePay("")).toBeNull();
    expect(parsePay("lots")).toBeNaN();
  });

  it("keeps existing object items whose label is unchanged", () => {
    const existing = [{ key: "min_base_pay", label: "Base pay at or above minimum", detail: "$150,000 base." }, "Dropped one"];
    expect(mergeListItems(["base pay at or above minimum", "New one"], existing)).toEqual([existing[0], "New one"]);
    expect(itemLabels(existing)).toEqual(["Base pay at or above minimum", "Dropped one"]);
  });

  it("builds a full update, keeping the rest of the scoring rubric", () => {
    const existing = {
      must_haves: [{ label: "Base pay at or above minimum", detail: "kept" }],
      scoring_rubric: { bands: [1], noise_keywords: ["old"] },
    };
    const result = parseProfileForm(base, existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: "Director of Lab Services",
      target_titles: ["Director of Laboratory Services", "Lab Director"],
      locations: [],
      min_base_pay: 150000,
      must_haves: [{ label: "Base pay at or above minimum", detail: "kept" }, "New must-have"],
      deal_breakers: [],
      plus_factors: ["Remote"],
      scoring_rubric: { bands: [1], noise_keywords: ["veterinary"], noise_allow: ["forensic"] },
    });
  });

  it("reports field errors", () => {
    const result = parseProfileForm({ ...base, name: "  ", min_base_pay: "a lot" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["min_base_pay", "name"]);
  });

  it("round-trips a stored row into form text", () => {
    const row = {
      name: "P",
      target_titles: ["A", "B"],
      locations: [],
      min_base_pay: 120000,
      must_haves: [{ label: "X", detail: "d" }],
      deal_breakers: [],
      plus_factors: [{ label: "Remote" }],
      scoring_rubric: { noise_keywords: ["vet"], noise_allow: [] },
    };
    const input = profileToFormInput(row);
    expect(input).toMatchObject({ target_titles: "A\nB", min_base_pay: "120000", must_haves: "X", plus_factors: "Remote", noise_keywords: "vet" });
    const fd = new FormData();
    for (const [k, v] of Object.entries(input)) fd.set(k, v);
    const again = parseProfileForm(formInput(fd), row);
    expect(again.ok && again.value.must_haves).toEqual([{ label: "X", detail: "d" }]);
  });
});
