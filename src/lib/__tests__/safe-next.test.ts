import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/jobs")).toBe("/jobs");
  });
  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "jobs"])(
    "falls back to /brief for %s",
    (v) => {
      expect(safeNext(v)).toBe("/brief");
    },
  );
});
