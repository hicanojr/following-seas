import { describe, expect, it } from "vitest";
import { mapTrackerStatus } from "../status";

describe("mapTrackerStatus", () => {
  it.each([
    ["Applied", "applied"],
    ["Application submitted", "applied"],
    ["Not applied", "saved"],
    ["Not yet applied", "saved"],
    ["To apply", "saved"],
    ["Tracked", "saved"],
    ["Saved", "saved"],
    ["Phone screen", "interview"],
    ["Interviewing", "interview"],
    ["Offer", "offer"],
    ["Offer declined", "closed"],
    ["Rejected", "closed"],
    ["Withdrew", "closed"],
    ["Position filled", "closed"],
  ])("%s -> %s", (input, status) => {
    expect(mapTrackerStatus(input)).toEqual({ status, recognized: true });
  });

  it("maps empty and unknown statuses to saved", () => {
    expect(mapTrackerStatus(null)).toEqual({ status: "saved", recognized: true });
    expect(mapTrackerStatus("   ")).toEqual({ status: "saved", recognized: true });
    expect(mapTrackerStatus("Something odd")).toEqual({ status: "saved", recognized: false });
  });
});
