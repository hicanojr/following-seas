/**
 * The fixtures are synthetic workbooks with the same headers as the trial
 * trackers (director-lab-services and health-systems-am). They hold no real
 * postings or contact details.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importFile, importXlsx, ImportFormatError } from "../index";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

describe("importXlsx: director tracker format", () => {
  it("reads the Tracker sheet and maps its columns", async () => {
    const { jobs, skipped } = await importXlsx(fixture("director-tracker-synthetic.xlsx"));
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toEqual({
      source: "indeed",
      external_id: null,
      url: null, // "Open posting" is not a link
      title: "Director, Laboratory Services",
      company: "Harbor Point Health",
      location: "Portland, ME",
      salary_min: 155000,
      salary_max: 185000,
      salary_text: "$155,000 to $185,000",
      description: null,
      requirements: [], // "Requirements met" is a scoring note, not posting requirements
      easy_apply: "unknown",
      posted_at: null,
    });
    expect(jobs[1]).toMatchObject({ salary_min: Math.round(98.11 * 2080), salary_max: Math.round(124.84 * 2080) });
    expect(jobs[2]).toMatchObject({ source: "ziprecruiter", salary_min: 157800, salary_max: null });
    expect(jobs[3]).toMatchObject({ salary_min: null, salary_max: null, salary_text: null, easy_apply: "no" });
    expect(skipped).toEqual([{ row: 7, reason: "No title" }]);
  });

  it("can read another sheet by name, and errors on a missing one", async () => {
    await expect(importXlsx(fixture("director-tracker-synthetic.xlsx"), { sheet: "Nope" })).rejects.toThrow(
      ImportFormatError,
    );
  });
});

describe("importXlsx: health systems tracker format", () => {
  it("maps Company, Location / Territory, Posted, Pay (as posted), and Key requirements", async () => {
    const { jobs } = await importFile({ name: "t.xlsx", bytes: fixture("health-tracker-synthetic.xlsx") });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "indeed",
      title: "Account Executive, Lab Diagnostics",
      company: "Northwind Diagnostics",
      location: "Remote, Baltimore, MD territory",
      url: "https://example.com/jobs/1",
      salary_min: 93600,
      salary_max: 128700,
      requirements: ["3+ yrs clinical diagnostic sales", "Bachelor degree"],
      posted_at: "2026-10-21T00:00:00.000Z",
      easy_apply: "unknown",
    });
    expect(jobs[1].posted_at).toBe("2026-10-22T00:00:00.000Z");
    expect(jobs[1].salary_text).toBeNull();
  });

  it("rejects bytes that are not a workbook", async () => {
    await expect(importXlsx(new TextEncoder().encode("not a zip"))).rejects.toThrow(ImportFormatError);
  });
});
