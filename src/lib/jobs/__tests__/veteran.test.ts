import { describe, expect, it } from "vitest";
import { hasVeteranPreference } from "../veteran";

describe("veteran preference", () => {
  it.each([
    "Veterans are strongly encouraged to apply.",
    "Veterans are preferred for this opening.",
    "Veterans preference applies to this role.",
    "Preference is given to veterans.",
    "We are seeking qualified veterans.",
    "Transitioning service members are welcome.",
    "Military experience is valued.",
  ])("recognizes explicit recruiting language: %s", (description) => {
    expect(hasVeteranPreference({ description })).toBe(true);
  });

  it("does not mistake protected-status boilerplate for preference", () => {
    expect(hasVeteranPreference({ description: "We do not discriminate based on protected veteran status." })).toBe(false);
    expect(hasVeteranPreference({ description: "Candidates are considered regardless of veteran status." })).toBe(false);
    expect(hasVeteranPreference({ description: "There is no veteran preference for this opening." })).toBe(false);
    expect(hasVeteranPreference({ description: "There is not a veteran preference for this opening." })).toBe(false);
    expect(hasVeteranPreference({ description: "Veteran preference does not apply to this role." })).toBe(false);
    expect(hasVeteranPreference({ description: "Veteran preference is not offered for this position." })).toBe(false);
    expect(hasVeteranPreference({ description: null, requirements: [] })).toBe(false);
  });

  it("keeps explicit encouragement even when the posting also has EEO boilerplate", () => {
    expect(
      hasVeteranPreference({
        description: "Protected veterans are encouraged to apply. We do not discriminate based on protected veteran status.",
      }),
    ).toBe(true);
  });
});
