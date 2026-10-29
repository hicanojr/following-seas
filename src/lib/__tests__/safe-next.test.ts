import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/jobs")).toBe("/jobs");
  });
  it("keeps query and hash", () => {
    expect(safeNext("/jobs?id=4#top")).toBe("/jobs?id=4#top");
  });
  it.each([
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/ /evil.example",
    "/jobs\\..\\..\\evil",
    "jobs",
    "javascript:alert(1)",
  ])(
    "falls back to /brief for %s",
    (v) => {
      expect(safeNext(v)).toBe("/brief");
    },
  );
});
