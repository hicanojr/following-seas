import { describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/dedupe";
import { dedupeBatch } from "../dedupe-batch";
import { job } from "./helpers";

describe("dedupeBatch", () => {
  it("drops repeats within a batch by company|title|location, case-insensitive", () => {
    const a = job({ source: "indeed" });
    const b = job({ source: "ziprecruiter", company: "EXAMPLE HEALTH" });
    const c = job({ location: "Plymouth, MA" });
    const { unique, duplicates } = dedupeBatch([a, b, c]);
    expect(unique).toEqual([a, c]);
    expect(duplicates).toEqual([{ job: b, key: dedupeKey(b), reason: "duplicate_in_batch" }]);
  });

  it("skips jobs already saved", () => {
    const a = job();
    const { unique, duplicates } = dedupeBatch([a], new Set([dedupeKey(a)]));
    expect(unique).toEqual([]);
    expect(duplicates[0].reason).toBe("already_saved");
  });
});
