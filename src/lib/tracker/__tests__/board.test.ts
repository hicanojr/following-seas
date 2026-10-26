import { describe, expect, it } from "vitest";
import { groupByStatus, hasApplied, markAppliedPatch, runningList, runningListCsv } from "../board";
import type { ApplicationStatus, TrackedApplication } from "../types";

let n = 0;
function tracked(
  over: Partial<TrackedApplication> & { status: ApplicationStatus },
  job: Partial<TrackedApplication["job"]> = {},
): TrackedApplication {
  n += 1;
  return {
    id: `app-${n}`,
    job_id: `job-${n}`,
    applied_on: null,
    follow_up_on: null,
    notes: null,
    created_at: `2026-10-0${(n % 9) + 1}T00:00:00Z`,
    updated_at: `2026-10-0${(n % 9) + 1}T00:00:00Z`,
    ...over,
    job: { id: `job-${n}`, title: `Title ${n}`, company: `Co ${n}`, location: null, url: null, source: "manual", ...job },
  };
}

describe("markAppliedPatch", () => {
  it("defaults to today and a follow-up 7 days later", () => {
    expect(markAppliedPatch("2026-10-26")).toEqual({
      status: "applied",
      applied_on: "2026-10-26",
      follow_up_on: "2026-11-02",
    });
  });
  it("uses an edited date applied for the default follow-up, and keeps an edited follow-up", () => {
    expect(markAppliedPatch("2026-10-26", { applied_on: "2026-10-20" }).follow_up_on).toBe("2026-10-27");
    expect(markAppliedPatch("2026-10-26", { follow_up_on: "2026-11-15" }).follow_up_on).toBe("2026-11-15");
    expect(markAppliedPatch("2026-10-26", { follow_up_on: null }).follow_up_on).toBeNull();
  });
});

describe("groupByStatus", () => {
  it("returns every column, newest activity first", () => {
    const a = tracked({ status: "applied", updated_at: "2026-10-01T00:00:00Z" });
    const b = tracked({ status: "applied", updated_at: "2026-10-05T00:00:00Z" });
    const c = tracked({ status: "offer" });
    const g = groupByStatus([a, b, c]);
    expect(Object.keys(g)).toEqual(["saved", "applied", "interview", "offer", "closed"]);
    expect(g.applied.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(g.offer).toHaveLength(1);
    expect(g.saved).toEqual([]);
  });
});

describe("runningList", () => {
  it("lists every applied job newest first, undated last, and leaves out saved ones", () => {
    const older = tracked({ status: "applied", applied_on: "2026-10-01" }, { title: "Older", url: "https://e.com/1" });
    const newer = tracked({ status: "interview", applied_on: "2026-10-20" }, { title: "Newer" });
    const undated = tracked({ status: "offer" }, { title: "Undated" });
    const closedAfterApplying = tracked({ status: "closed", applied_on: "2026-10-10" }, { title: "Closed" });
    const saved = tracked({ status: "saved" }, { title: "Saved" });
    const closedNever = tracked({ status: "closed" }, { title: "Never applied" });
    const list = runningList([older, saved, undated, newer, closedAfterApplying, closedNever]);
    expect(list.map((e) => e.title)).toEqual(["Newer", "Closed", "Older", "Undated"]);
    expect(list[2]).toEqual({ company: older.job.company, title: "Older", applied_on: "2026-10-01", url: "https://e.com/1", status: "applied" });
    expect(hasApplied(saved)).toBe(false);
  });

  it("exports CSV with quoting and formula protection", () => {
    const csv = runningListCsv([
      { company: 'Harbor "Point", Inc', title: "=HYPERLINK()", applied_on: "2026-10-20", url: null, status: "applied" },
    ]);
    expect(csv).toBe(
      'Company,Title,Date applied,Link,Status\r\n"Harbor ""Point"", Inc",\'=HYPERLINK(),2026-10-20,,applied\r\n',
    );
  });
});
