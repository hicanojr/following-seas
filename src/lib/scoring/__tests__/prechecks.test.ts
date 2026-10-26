import { describe, expect, it } from "vitest";
import {
  CLIA_DIRECTOR_GAP,
  MT_MLS_GAP,
  bachelorGap,
  checkPay,
  containsPhrase,
  findDealBreaker,
  mtMlsGap,
  requiresCliaDirectorCredentials,
  runPrechecks,
  splitMustHaves,
} from "../prechecks";
import { MLT_FACTS, makeJob, makeProfile } from "./fixtures";

describe("checkPay", () => {
  it("flags pay below the minimum as an unmet must-have", () => {
    expect(checkPay({ salary_min: 90000, salary_max: 110000 }, 120000)).toEqual({
      met: null,
      gap: null,
      unmet: "Pay below minimum ($120,000)",
    });
  });

  it("uses salary_min when salary_max is missing", () => {
    expect(checkPay({ salary_min: 100000, salary_max: null }, 120000).unmet).toBe("Pay below minimum ($120,000)");
    expect(checkPay({ salary_min: 130000, salary_max: null }, 120000).met).toBe("Pay clears minimum ($120,000)");
  });

  it("reports missing pay as a gap, not an unmet must-have", () => {
    expect(checkPay({ salary_min: null, salary_max: null }, 120000)).toEqual({
      met: null,
      gap: "Pay not listed",
      unmet: null,
    });
  });

  it("annualizes hourly rates before comparing", () => {
    expect(checkPay({ salary_min: 40, salary_max: 60 }, 120000).met).not.toBeNull(); // 60 * 2080 = 124,800
    expect(checkPay({ salary_min: 30, salary_max: 45 }, 120000).unmet).not.toBeNull();
  });

  it("does nothing when no minimum is set and pay is listed", () => {
    expect(checkPay({ salary_min: 50000, salary_max: 60000 }, null)).toEqual({ met: null, gap: null, unmet: null });
  });
});

describe("deal-breakers", () => {
  it("matches case-insensitively and returns the profile's phrase", () => {
    const job = makeJob({ description: "This is a CONTRACT position for 6 months." });
    expect(findDealBreaker(job, ["night shift", "Contract"])).toBe("Contract");
  });

  it("respects word edges", () => {
    expect(containsPhrase("Contractor management experience", "contract")).toBe(false);
    expect(containsPhrase("night\n shift work", "night shift")).toBe(true);
  });

  it("returns null when nothing matches", () => {
    expect(findDealBreaker(makeJob({ description: "Full time, days." }), ["contract"])).toBeNull();
  });

  it("screens the job out in runPrechecks", () => {
    const pre = runPrechecks(
      makeJob({ description: "Travel 75% required." }),
      makeProfile({ deal_breakers: ["travel 75%"] }),
      MLT_FACTS,
    );
    expect(pre.deal_breaker_hit).toBe("travel 75%");
  });
});

describe("must-haves", () => {
  it("never drops a must-have: confirmed or listed for confirmation", () => {
    const job = makeJob({ description: "Full-time role in an acute care hospital." });
    const { confirmed, unconfirmed } = splitMustHaves(job, ["acute care", "Full-time", "Remote", "remote"]);
    expect(confirmed).toEqual(["acute care", "Full-time"]);
    expect(unconfirmed).toEqual(["Remote"]);
  });
});

describe("CLIA laboratory director credentials", () => {
  it("flags a posting that requires a doctoral director", () => {
    const job = makeJob({
      title: "Laboratory Director",
      description: "Serve as CLIA Laboratory Director.\nRequirements:\nMD or PhD with board certification (ABB).",
    });
    expect(requiresCliaDirectorCredentials(job)).toBe(true);
    expect(runPrechecks(job, makeProfile(), MLT_FACTS).gaps).toContain(CLIA_DIRECTOR_GAP);
    expect(runPrechecks(job, makeProfile(), MLT_FACTS).hard_gaps).toContain(CLIA_DIRECTOR_GAP);
  });

  it("flags from the requirements list", () => {
    const job = makeJob({
      title: "Medical Director, Clinical Laboratory",
      requirements: ["M.D. or D.O. degree", "Board certified in clinical pathology"],
    });
    expect(requiresCliaDirectorCredentials(job)).toBe(true);
  });

  it("does not flag when the doctorate is only preferred", () => {
    const job = makeJob({
      title: "Laboratory Director",
      description: "Lead the laboratory. Bachelor's degree required. PhD preferred.",
    });
    expect(requiresCliaDirectorCredentials(job)).toBe(false);
  });

  it("does not read a Maryland address as an MD degree", () => {
    const job = makeJob({
      title: "Laboratory Director of Operations",
      description: "Requirements:\nMust be able to work onsite in Baltimore, MD.",
    });
    expect(requiresCliaDirectorCredentials(job)).toBe(false);
  });

  it("does not flag non-director postings", () => {
    const job = makeJob({ description: "Requirements: PhD in chemistry required." });
    expect(requiresCliaDirectorCredentials(job)).toBe(false);
  });
});

describe("bachelor's degree", () => {
  const job = makeJob({ description: "Qualifications:\nBachelor's degree in a laboratory science." });

  it("is a gap when the facts list no bachelor's", () => {
    expect(bachelorGap(job, MLT_FACTS)).toMatch(/^Bachelor's degree required/);
  });

  it("is not a gap when the facts list one", () => {
    expect(bachelorGap(job, { ...MLT_FACTS, credentials: "B.S., Medical Laboratory Science" })).toBeNull();
    expect(bachelorGap(job, { ...MLT_FACTS, credentials: "Master of Health Administration" })).toBeNull();
  });

  it("notes when the posting allows equivalent experience", () => {
    const eq = makeJob({ requirements: ["Bachelor's degree or equivalent experience required"] });
    expect(bachelorGap(eq, MLT_FACTS)).toMatch(/equivalent experience/);
  });

  it("ignores a preferred bachelor's", () => {
    const pref = makeJob({ description: "Bachelor's degree preferred." });
    expect(bachelorGap(pref, MLT_FACTS)).toBeNull();
  });
});

describe("MT / MLS certification", () => {
  const job = makeJob({ requirements: ["MT(ASCP) or MLS(ASCP) certification required"] });

  it("is a gap when the facts list MLT only", () => {
    expect(mtMlsGap(job, MLT_FACTS)).toBe(MT_MLS_GAP);
  });

  it("is not a gap when the facts list MLS", () => {
    expect(mtMlsGap(job, { ...MLT_FACTS, credentials: "MLS(ASCP)" })).toBeNull();
  });

  it("is not a gap when the posting also accepts MLT", () => {
    const either = makeJob({ requirements: ["MT, MLS, or MLT certification required"] });
    expect(mtMlsGap(either, MLT_FACTS)).toBeNull();
  });

  it("does not read MLT as MT", () => {
    const mlt = makeJob({ requirements: ["MLT certification required"] });
    expect(mtMlsGap(mlt, MLT_FACTS)).toBeNull();
  });
});

describe("runPrechecks", () => {
  it("combines pay, must-haves, and credential checks", () => {
    const job = makeJob({
      salary_min: 95000,
      salary_max: 105000,
      description: "Full-time.\nRequirements:\nBachelor's degree required.",
    });
    const pre = runPrechecks(job, makeProfile({ min_base_pay: 120000, must_haves: ["Full-time", "Hospital setting"] }), MLT_FACTS);
    expect(pre.unmet_must_haves).toEqual(["Pay below minimum ($120,000)"]);
    expect(pre.confirmed_must_haves).toEqual(["Full-time"]);
    expect(pre.unconfirmed_must_haves).toEqual(["Hospital setting"]);
    expect(pre.requirements_met).toContain("Must-have: Full-time");
    expect(pre.gaps.some((g) => g.startsWith("Bachelor's degree required"))).toBe(true);
    expect(pre.deal_breaker_hit).toBeNull();
  });

  it("notes missing career facts as a gap", () => {
    const pre = runPrechecks(makeJob({ salary_max: 150000 }), makeProfile(), null);
    expect(pre.gaps).toContain("No career facts on file, so experience could not be checked");
  });
});
