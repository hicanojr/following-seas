import { describe, expect, it } from "vitest";
import { addDays, isIsoDate } from "../dates";
import {
  appendDatedNote,
  classifyFollowUps,
  completeFollowUp,
  defaultFollowUp,
  dueCount,
  snoozeFollowUp,
} from "../followups";
import type { ApplicationStatus } from "../types";

const TODAY = "2026-10-26";
const app = (id: string, follow_up_on: string | null, status: ApplicationStatus = "applied") => ({
  id,
  status,
  follow_up_on,
});

describe("classifyFollowUps", () => {
  it("splits into overdue, due today, and the next 7 days, sorted by date", () => {
    const apps = [
      app("later", "2026-11-03"), // 8 days out: left out
      app("week", "2026-11-02"), // exactly 7 days: upcoming
      app("tomorrow", "2026-10-27"),
      app("today", TODAY),
      app("old", "2026-10-01"),
      app("yesterday", "2026-10-25"),
      app("none", null),
      app("closed", "2026-10-20", "closed"),
      app("saved", TODAY, "saved"),
    ];
    const r = classifyFollowUps(apps, TODAY);
    expect(r.overdue.map((a) => a.id)).toEqual(["old", "yesterday"]);
    expect(r.dueToday.map((a) => a.id)).toEqual(["today", "saved"]);
    expect(r.upcoming.map((a) => a.id)).toEqual(["tomorrow", "week"]);
    expect(dueCount(r)).toBe(4);
  });

  it("crosses month and year ends", () => {
    const r = classifyFollowUps([app("a", "2027-01-02"), app("b", "2026-12-31")], "2026-12-31");
    expect(r.dueToday.map((a) => a.id)).toEqual(["b"]);
    expect(r.upcoming.map((a) => a.id)).toEqual(["a"]);
  });

  it("ignores malformed dates and rejects a bad today", () => {
    expect(classifyFollowUps([app("x", "soon")], TODAY).overdue).toEqual([]);
    expect(() => classifyFollowUps([], "26/10/2026")).toThrow(RangeError);
  });
});

describe("snooze and done", () => {
  it("snooze moves the follow-up to 3 days from today", () => {
    expect(snoozeFollowUp(TODAY)).toEqual({ follow_up_on: "2026-10-29" });
  });

  it("done clears the follow-up and appends a dated note", () => {
    expect(completeFollowUp(null, TODAY)).toEqual({ follow_up_on: null, notes: "2026-10-26: Followed up." });
    expect(completeFollowUp("Spoke to HR.\n", TODAY, "Sent a thank-you myself")).toEqual({
      follow_up_on: null,
      notes: "Spoke to HR.\n2026-10-26: Sent a thank-you myself",
    });
    expect(appendDatedNote("", TODAY, "x")).toBe("2026-10-26: x");
  });

  it("the default follow-up is 7 days after applying", () => {
    expect(defaultFollowUp("2026-10-28")).toBe("2026-11-04");
  });
});

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08"); // US DST start does not matter
  });
});
