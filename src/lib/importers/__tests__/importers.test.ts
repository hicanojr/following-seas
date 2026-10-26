import { describe, expect, it } from "vitest";
import { importCsv, importJson, importText, ImportFormatError, fileKind } from "../index";
import { parseCsv } from "../csv";
import { parseDate, parseEasyApply, parseUrl, rowToJob } from "../fields";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, new lines, CRLF, and a BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "line1\nline2"],
    ]);
  });

  it("detects tab separated text copied from a spreadsheet", () => {
    expect(parseCsv("Title\tCompany\nA, B\tC")).toEqual([
      ["Title", "Company"],
      ["A, B", "C"],
    ]);
  });
});

describe("field parsers", () => {
  it("maps easy apply values and leaves anything unclear unknown", () => {
    expect(parseEasyApply("Yes")).toBe("yes");
    expect(parseEasyApply(true)).toBe("yes");
    expect(parseEasyApply("No (state application system)")).toBe("no");
    expect(parseEasyApply("Unknown")).toBe("unknown");
    expect(parseEasyApply(undefined)).toBe("unknown");
    expect(parseEasyApply("maybe")).toBe("unknown");
  });

  it("keeps only real http links", () => {
    expect(parseUrl("Open posting")).toBeNull();
    expect(parseUrl("https://example.com/j/1")).toBe("https://example.com/j/1");
    expect(parseUrl("javascript:alert(1)")).toBeNull();
  });

  it("reads absolute dates and ignores relative ones", () => {
    expect(parseDate("2026-10-21")).toBe("2026-10-21T00:00:00.000Z");
    expect(parseDate("10/21/2026")).toBe("2026-10-21T00:00:00.000Z");
    expect(parseDate("2026-10-20T00:00:00.0000")).toBe("2026-10-20T00:00:00.000Z");
    expect(parseDate("3 days ago")).toBeNull();
  });
});

describe("rowToJob", () => {
  it("maps flexible headers without inventing values", () => {
    const r = rowToJob({
      "Job Title": "Director of Laboratory Services",
      Employer: "Example Health",
      Pay: "$155,000 - $185,000 a year",
      Link: "https://example.com/1",
    });
    expect(r).toEqual({
      ok: true,
      job: {
        source: "manual",
        external_id: null,
        url: "https://example.com/1",
        title: "Director of Laboratory Services",
        company: "Example Health",
        location: null,
        salary_min: 155000,
        salary_max: 185000,
        salary_text: "$155,000 - $185,000 a year",
        description: null,
        requirements: [],
        easy_apply: "unknown",
        posted_at: null,
      },
    });
  });

  it("refuses rows without a title, with a reason", () => {
    expect(rowToJob({ Company: "X" })).toEqual({ ok: false, reason: "No title" });
  });

  it("uses the row's source, else the default", () => {
    const a = rowToJob({ title: "A", source: "ZipRecruiter" }, { defaultSource: "indeed" });
    const b = rowToJob({ title: "B", source: "Monster" }, { defaultSource: "indeed" });
    expect(a.ok && a.job.source).toBe("ziprecruiter");
    expect(b.ok && b.job.source).toBe("indeed");
  });

  it("accepts NormalizedJob-shaped objects", () => {
    const r = rowToJob({
      source: "indeed",
      external_id: "abc",
      title: "T",
      salary_min: 100000,
      salary_max: "120,000",
      salary_text: "$100K - $120K",
      requirements: ["MLS (ASCP)", "5 years"],
      easy_apply: "yes",
      posted_at: "2026-10-01",
    });
    expect(r.ok && r.job).toMatchObject({
      source: "indeed",
      external_id: "abc",
      salary_min: 100000,
      salary_max: 120000,
      salary_text: "$100K - $120K",
      requirements: ["MLS (ASCP)", "5 years"],
      easy_apply: "yes",
      posted_at: "2026-10-01T00:00:00.000Z",
    });
  });

  it("splits requirement text on semicolons and new lines", () => {
    const r = rowToJob({ title: "T", requirements: "BS degree; 5+ years\n- ASCP" });
    expect(r.ok && r.job.requirements).toEqual(["BS degree", "5+ years", "ASCP"]);
  });
});

describe("importCsv / importJson / importText", () => {
  const csv = [
    "Title,Company,Location,Salary,URL,Easy Apply,Posted Date,Source",
    'Director of Lab Operations,Acme Labs,"Boston, MA","$155,000 - $185,000 a year",https://example.com/a,Yes,2026-10-01,Indeed',
    ',No Title Co,Somewhere,,,,,',
    "Lab Director,Beta Health,,$75 an hour,,,,",
  ].join("\n");

  it("imports CSV rows and reports skipped rows with their row number", () => {
    const { jobs, skipped } = importCsv(csv, { defaultSource: "ziprecruiter" });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: "Director of Lab Operations",
      company: "Acme Labs",
      location: "Boston, MA",
      salary_min: 155000,
      easy_apply: "yes",
      source: "indeed",
      posted_at: "2026-10-01T00:00:00.000Z",
    });
    expect(jobs[1]).toMatchObject({ source: "ziprecruiter", salary_min: 156000, location: null, url: null });
    expect(skipped).toEqual([{ row: 3, reason: "No title" }]);
  });

  it("errors clearly when there is no title column", () => {
    expect(() => importCsv("Company,Location\nA,B")).toThrow(ImportFormatError);
  });

  it("imports a JSON array or an object with a jobs array", () => {
    const a = importJson('[{"title":"A","company":"X"},{"company":"no title"},5]');
    expect(a.jobs.map((j) => j.title)).toEqual(["A"]);
    expect(a.skipped).toEqual([
      { row: 2, reason: "No title" },
      { row: 3, reason: "Not a job object" },
    ]);
    const b = importJson({ jobs: [{ jobTitle: "B", salary: "Up to $200K" }] });
    expect(b.jobs[0]).toMatchObject({ title: "B", salary_max: 200000, salary_min: null });
  });

  it("detects JSON vs CSV in pasted text", () => {
    expect(importText('  [{"title":"A"}]').jobs).toHaveLength(1);
    expect(importText("title\nB").jobs[0].title).toBe("B");
    expect(() => importText("   ")).toThrow(ImportFormatError);
    expect(() => importText("[not json")).toThrow(ImportFormatError);
  });

  it("picks the file kind by extension or type", () => {
    expect(fileKind("t.xlsx")).toBe("xlsx");
    expect(fileKind("t.CSV")).toBe("csv");
    expect(fileKind("t", "application/json")).toBe("json");
    expect(fileKind("t.pdf")).toBeNull();
  });
});
