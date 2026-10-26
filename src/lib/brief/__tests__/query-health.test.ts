import { describe, expect, it } from "vitest";
import { assessQuery, hitRate, querySuggestions, type QueryHealthInput } from "../query-health";

function q(overrides: Partial<QueryHealthInput> = {}): QueryHealthInput {
  return {
    id: "q1",
    profile_id: "p1",
    source: "linkedin",
    query_text: "Director of Laboratory Services",
    quality: "untested",
    runs: 0,
    relevant_hits: null,
    total_hits: null,
    retired: false,
    notes: null,
    ...overrides,
  };
}

describe("hitRate", () => {
  it("is relevant over total", () => {
    expect(hitRate({ relevant_hits: 5, total_hits: 20 })).toBe(0.25);
  });
  it("is null when relevant hits are not counted or nothing came back", () => {
    expect(hitRate({ relevant_hits: null, total_hits: 20 })).toBeNull();
    expect(hitRate({ relevant_hits: 0, total_hits: 0 })).toBeNull();
  });
  it("never goes above 1", () => {
    expect(hitRate({ relevant_hits: 30, total_hits: 20 })).toBe(1);
  });
});

describe("assessQuery", () => {
  it("keeps a query with fewer than 3 runs, even with a poor hit rate", () => {
    const h = assessQuery(q({ runs: 2, relevant_hits: 0, total_hits: 50 }));
    expect(h.recommendation).toBe("keep");
    expect(h.reason).toMatch(/Only 2 runs so far/);
  });

  it("suggests retiring when the hit rate stays low after 3 runs, with the person's note", () => {
    const h = assessQuery(
      q({ runs: 4, relevant_hits: 2, total_hits: 40, notes: "Returned clerical roles" }),
    );
    expect(h.recommendation).toBe("retire");
    expect(h.hitRate).toBe(0.05);
    expect(h.reason).toBe("Low hit rate: 2 of 40 relevant (5%) over 4 runs. Note: returned clerical roles.");
  });

  it("watches a middling hit rate", () => {
    expect(assessQuery(q({ runs: 3, relevant_hits: 5, total_hits: 20 })).recommendation).toBe("watch");
  });

  it("keeps a query that works", () => {
    const h = assessQuery(q({ runs: 5, relevant_hits: 12, total_hits: 25, quality: "good" }));
    expect(h.recommendation).toBe("keep");
    expect(h.reason).toMatch(/^Working: 12 of 25 relevant \(48%\)/);
  });

  it("suggests retiring a query that returned nothing after 3 runs", () => {
    const h = assessQuery(q({ runs: 3, relevant_hits: 0, total_hits: 0 }));
    expect(h.recommendation).toBe("retire");
    expect(h.reason).toMatch(/Returned no results over 3 runs/);
  });

  it("suggests retiring a noise query that was left active", () => {
    expect(assessQuery(q({ quality: "noise", runs: 1 })).recommendation).toBe("retire");
  });

  it("does not judge hits that were never counted, unless marked mixed", () => {
    expect(assessQuery(q({ runs: 6, total_hits: 120 })).recommendation).toBe("keep");
    expect(assessQuery(q({ runs: 6, total_hits: 120, quality: "mixed" })).recommendation).toBe("watch");
  });

  it("honours custom thresholds", () => {
    const row = q({ runs: 3, relevant_hits: 3, total_hits: 10 });
    expect(assessQuery(row).recommendation).toBe("watch");
    expect(assessQuery(row, { retireBelow: 0.5 }).recommendation).toBe("retire");
    expect(assessQuery(row, { minRuns: 5 }).recommendation).toBe("keep");
  });

  it("never changes the row it is given", () => {
    const row = q({ runs: 9, relevant_hits: 0, total_hits: 90 });
    const copy = { ...row };
    assessQuery(row);
    expect(row).toEqual(copy);
  });
});

describe("querySuggestions", () => {
  it("lists retire before watch, lowest hit rate first, and leaves out keeps and retired queries", () => {
    const rows = [
      q({ id: "keep", runs: 5, relevant_hits: 10, total_hits: 20 }),
      q({ id: "watch", runs: 3, relevant_hits: 5, total_hits: 20 }),
      q({ id: "low", runs: 3, relevant_hits: 1, total_hits: 10 }),
      q({ id: "lower", runs: 3, relevant_hits: 0, total_hits: 10 }),
      q({ id: "gone", runs: 9, relevant_hits: 0, total_hits: 10, retired: true }),
    ];
    expect(querySuggestions(rows).map((h) => h.queryId)).toEqual(["lower", "low", "watch"]);
  });
});
