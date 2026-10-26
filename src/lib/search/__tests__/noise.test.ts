import { describe, expect, it } from "vitest";
import { DEFAULT_NOISE_KEYWORDS, filterNoise, matchNoise, noiseConfigFrom, resolveNoiseKeywords } from "../noise";
import { job } from "./helpers";

describe("noise filter", () => {
  it("drops noisy titles and says why", () => {
    const jobs = [
      job({ title: "Director of Laboratory Services" }),
      job({ title: "Registered Nurse - ICU" }),
      job({ title: "RN Case Manager" }),
      job({ title: "CRNA" }),
      job({ title: "Cannabis Lab Director" }),
      job({ title: "Research Scientist II" }),
      job({ title: "Dental Lab Manager" }),
      job({ title: "Director, Eastern Region Laboratories" }),
    ];
    const { kept, dropped } = filterNoise(jobs);
    expect(kept.map((j) => j.title)).toEqual([
      "Director of Laboratory Services",
      "Director, Eastern Region Laboratories",
    ]);
    expect(dropped).toHaveLength(6);
    expect(dropped[0].reason).toBe('Title matches noise keyword "nurse"');
    expect(dropped[1].reason).toContain('"RN"');
  });

  it("matches whole words and plurals only", () => {
    expect(matchNoise("Nurses Unit Lead", DEFAULT_NOISE_KEYWORDS)).toBe("nurse");
    expect(matchNoise("Learning Director", DEFAULT_NOISE_KEYWORDS)).toBeNull();
    expect(matchNoise("Governance Lead", DEFAULT_NOISE_KEYWORDS)).toBeNull();
  });

  it("is configurable per profile and per query", () => {
    const config = noiseConfigFrom(
      { noise_keywords: ["sales", 3], noise_allow: ["Physician"] },
      { noise_keywords: ["intern"] },
      null,
    );
    expect(config).toEqual({ add: ["sales", "intern"], allow: ["Physician"] });
    const keywords = resolveNoiseKeywords(config);
    expect(keywords).toContain("sales");
    expect(keywords).toContain("intern");
    expect(keywords).not.toContain("physician");
    expect(filterNoise([job({ title: "Physician Liaison" })], keywords).kept).toHaveLength(1);
    expect(filterNoise([job({ title: "Sales Executive" })], keywords).dropped).toHaveLength(1);
  });
});
