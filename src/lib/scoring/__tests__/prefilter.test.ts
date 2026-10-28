import { describe, expect, it } from "vitest";
import { resumeContentHash } from "@/lib/resume/hash";
import { renderParsedResume } from "@/lib/resume/parsed";
import { decidePrefilter, topFractionIds } from "@/lib/scoring/prefilter";

describe("resumeContentHash", () => {
  it("matches sha256 of the utf-8 bytes, the same digest the worker uses", () => {
    expect(resumeContentHash("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(resumeContentHash("café")).toBe(resumeContentHash("café"));
  });
});

describe("renderParsedResume", () => {
  it("copies stored strings and does not add fields that were not parsed", () => {
    const text = renderParsedResume({
      name: "Ada",
      skills: ["HPLC"],
      experience: [{ title: "Manager", organization: "Acme", highlights: ["Ran the lab"] }],
    });
    expect(text).toContain("HPLC");
    expect(text).toContain("Manager, Acme");
    expect(text).toContain("Ran the lab");
    expect(text).not.toContain("credential");
  });

  it("says when the cache extracted nothing", () => {
    expect(renderParsedResume({})).toBe("(parsed resume was empty)");
  });
});

describe("topFractionIds", () => {
  it("keeps about a quarter, rounding up, highest similarity first", () => {
    const ranked = [
      { jobId: "a", similarity: 0.2 },
      { jobId: "b", similarity: 0.9 },
      { jobId: "c", similarity: 0.4 },
      { jobId: "d", similarity: 0.1 },
    ];
    expect(topFractionIds(ranked)).toEqual(["b"]);
    expect(topFractionIds([...ranked, { jobId: "e", similarity: 0.8 }])).toEqual(["b", "e"]);
    expect(topFractionIds([{ jobId: "only", similarity: 0.01 }])).toEqual(["only"]);
    expect(topFractionIds([])).toEqual([]);
  });

  it("breaks ties by job id and ignores a worse duplicate", () => {
    expect(
      topFractionIds([
        { jobId: "b", similarity: 0.5 },
        { jobId: "a", similarity: 0.5 },
        { jobId: "a", similarity: 0.1 },
      ]),
    ).toEqual(["a"]);
  });
});

describe("decidePrefilter", () => {
  it("sends every candidate when there is no resume embedding", () => {
    expect(decidePrefilter(["a", "b"], null, 50)).toEqual({
      selectedIds: ["a", "b"],
      prefiltered: 0,
      awaitingEmbedding: 0,
    });
  });

  it("holds back postings below the library cutoff and postings with no vector", () => {
    const ranked = [
      { jobId: "best", similarity: 0.9 },
      { jobId: "mid", similarity: 0.4 },
      { jobId: "low", similarity: 0.2 },
      { jobId: "old", similarity: 0.1 },
    ];
    const decision = decidePrefilter(["best", "low", "fresh"], ranked, 50);
    expect(decision.selectedIds).toEqual(["best"]);
    expect(decision.prefiltered).toBe(1);
    expect(decision.awaitingEmbedding).toBe(1);
  });
});
