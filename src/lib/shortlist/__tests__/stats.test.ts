import { describe, expect, it } from "vitest";
import {
  countsByBand,
  fitBand,
  measureThreshold,
  MIN_DECISIONS_FOR_THRESHOLD,
  shortlistStats,
  topSkipReasons,
  type DecisionHistoryItem,
} from "../stats";

const keep = (fit: number | null, reason: string | null = null): DecisionHistoryItem => ({ decision: "keep", fit, reason });
const skip = (fit: number | null, reason: string | null = "Other"): DecisionHistoryItem => ({ decision: "skip", fit, reason });

function repeat<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

describe("fitBand", () => {
  it("places fits in bands and treats missing or bad fits as not scored", () => {
    expect(fitBand(10)).toBe("8 to 10");
    expect(fitBand(8)).toBe("8 to 10");
    expect(fitBand(7)).toBe("6 to 7");
    expect(fitBand(4)).toBe("4 to 5");
    expect(fitBand(1)).toBe("1 to 3");
    expect(fitBand(null)).toBe("Not scored");
    expect(fitBand(0)).toBe("Not scored");
    expect(fitBand(Number.NaN)).toBe("Not scored");
  });
});

describe("countsByBand", () => {
  it("counts keeps and skips per band, best first", () => {
    const rows = countsByBand([keep(9), keep(8), skip(9), skip(2), keep(6)]);
    expect(rows.map((r) => r.band)).toEqual(["8 to 10", "6 to 7", "4 to 5", "1 to 3"]);
    expect(rows[0]).toEqual({ band: "8 to 10", keep: 2, skip: 1 });
    expect(rows[1]).toEqual({ band: "6 to 7", keep: 1, skip: 0 });
    expect(rows[3]).toEqual({ band: "1 to 3", keep: 0, skip: 1 });
  });

  it("adds a Not scored row only when needed", () => {
    expect(countsByBand([keep(9)]).some((r) => r.band === "Not scored")).toBe(false);
    expect(countsByBand([skip(null)]).at(-1)).toEqual({ band: "Not scored", keep: 0, skip: 1 });
  });
});

describe("topSkipReasons", () => {
  it("groups by chip, then by free text, ignoring keeps", () => {
    const top = topSkipReasons([
      skip(5, "Pay too low"),
      skip(5, "Pay too low: 90k top of range"),
      skip(4, "Wrong location: Alaska"),
      skip(4, "Night shift"),
      skip(4, "night shift"),
      skip(3, "Pay too low"),
      skip(3, null),
      keep(9, "Pay too low"),
    ]);
    expect(top).toEqual([
      { reason: "Pay too low", count: 3 },
      { reason: "Night shift", count: 2 },
      { reason: "No reason given", count: 1 },
      { reason: "Wrong location", count: 1 },
    ]);
  });

  it("honours the limit", () => {
    expect(topSkipReasons([skip(1, "a"), skip(1, "b"), skip(1, "c")], 2)).toHaveLength(2);
  });
});

describe("measureThreshold", () => {
  it("returns null with the number still needed below 30 scored decisions", () => {
    const history = [...repeat(15, () => keep(9)), ...repeat(14, () => skip(3)), ...repeat(5, () => keep(null))];
    const result = measureThreshold(history);
    expect(result.threshold).toBeNull();
    expect(result.decisions).toBe(29);
    if (result.threshold === null) expect(result.needed).toBe(1);
    expect(result.reason).toMatch(/1 more decision on scored/);
  });

  it("suggests the threshold that separates keeps from skips", () => {
    const history = [...repeat(15, (i) => keep(7 + (i % 4))), ...repeat(15, (i) => skip(1 + (i % 5)))];
    const result = measureThreshold(history);
    // Keeps are 7 to 10, skips 1 to 5: thresholds 6 and 7 both separate perfectly; the higher one wins.
    expect(result.threshold).toBe(7);
    expect(result.agreement).toBe(1);
    expect(result.decisions).toBe(MIN_DECISIONS_FOR_THRESHOLD);
  });

  it("accepts exactly 85 percent agreement", () => {
    // 20 keeps at 8, 20 skips at 3, then 6 of 40 off the rule: 34/40 = 0.85.
    const history = [
      ...repeat(17, () => keep(8)),
      ...repeat(3, () => keep(3)),
      ...repeat(17, () => skip(3)),
      ...repeat(3, () => skip(8)),
    ];
    const result = measureThreshold(history);
    expect(result.threshold).not.toBeNull();
    expect(result.agreement).toBeCloseTo(0.85);
  });

  it("returns null when agreement is below 85 percent", () => {
    const history = [
      ...repeat(16, () => keep(8)),
      ...repeat(4, () => keep(3)),
      ...repeat(16, () => skip(3)),
      ...repeat(4, () => skip(8)),
    ];
    const result = measureThreshold(history);
    expect(result.threshold).toBeNull();
    expect(result.agreement).toBeCloseTo(0.8);
    expect(result.reason).toMatch(/needs 85%/);
  });

  it("returns null when every decision is the same", () => {
    const result = measureThreshold(repeat(30, () => skip(4)));
    expect(result.threshold).toBeNull();
    expect(result.reason).toMatch(/All 30 decisions are skips/);
  });

  it("ignores decisions on unscored jobs", () => {
    const history = [...repeat(15, () => keep(9)), ...repeat(15, () => skip(null))];
    expect(measureThreshold(history).decisions).toBe(15);
  });
});

describe("shortlistStats", () => {
  it("bundles totals, bands, reasons, and threshold", () => {
    const stats = shortlistStats([keep(9), skip(2, "Company"), skip(null, "Company: staffing agency")]);
    expect(stats.total).toBe(3);
    expect(stats.keeps).toBe(1);
    expect(stats.skips).toBe(2);
    expect(stats.topSkipReasons).toEqual([{ reason: "Company", count: 2 }]);
    expect(stats.threshold.threshold).toBeNull();
  });
});
