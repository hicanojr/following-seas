/**
 * The fixture is a synthetic workbook in the trial tracker layout, with a
 * spread of Status and date values. It holds no real postings or notes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ImportFormatError } from "@/lib/importers";
import { cellToIsoDate, parseTrackerFile, tableToTrackerRows } from "../spreadsheet";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

describe("parseTrackerFile", () => {
  it("reads postings with the shared importer plus Status, Date applied, Follow up, and Notes", async () => {
    const { rows, skipped } = await parseTrackerFile({ name: "t.xlsx", bytes: fixture("tracker-status-synthetic.xlsx") });
    expect(rows.map((r) => [r.row, r.status, r.applied_on, r.follow_up_on])).toEqual([
      [2, "applied", "2026-10-14", "2026-10-21"],
      [3, "interview", "2026-10-02", null],
      [4, "offer", null, null], // no date in the sheet, none invented
      [5, "closed", "2026-09-30", null],
      [6, "saved", null, null], // "Not applied"
      [7, "saved", null, null], // empty status
      [8, "saved", null, null], // unrecognized status, "next week" is not a date
      [9, "applied", null, null], // repeat of row 2; the service skips it
    ]);
    expect(rows[0].job).toMatchObject({
      title: "Director, Laboratory Services",
      company: "Harbor Point Health",
      location: "Portland, ME",
      source: "indeed",
      url: "https://example.com/a",
      salary_min: 155000,
    });
    expect(rows[0].notes).toBe("Synthetic note");
    expect(rows[1].job.source).toBe("ziprecruiter");
    expect(rows[1].job.url).toBeNull(); // "Open posting" is not a link
    expect(rows[6].warnings).toEqual([
      'Status "Something odd" not recognized; saved as Saved.',
      'Date applied "next week" is not a date; left empty.',
    ]);
    expect(skipped).toEqual([{ row: 10, reason: "No title" }]);
  });

  it("reads the trial director and health tracker layouts", async () => {
    const director = await parseTrackerFile({
      name: "d.xlsx",
      bytes: new Uint8Array(
        readFileSync(fileURLToPath(new URL("../../importers/__tests__/fixtures/director-tracker-synthetic.xlsx", import.meta.url))),
      ),
    });
    expect(director.rows).toHaveLength(4);
    expect(director.rows.every((r) => r.status === "saved" && r.applied_on === null)).toBe(true); // "Tracked"
    const health = await parseTrackerFile({
      name: "h.xlsx",
      bytes: new Uint8Array(
        readFileSync(fileURLToPath(new URL("../../importers/__tests__/fixtures/health-tracker-synthetic.xlsx", import.meta.url))),
      ),
    });
    expect(health.rows.map((r) => r.status)).toEqual(["saved", "saved"]); // "Not applied"
  });

  it("reads CSV with the same columns", async () => {
    const csv = "Title,Company,Status,Date applied\nLab Director,Acme,Applied,10/14/2026\n";
    const { rows } = await parseTrackerFile({ name: "t.csv", bytes: new TextEncoder().encode(csv) });
    expect(rows[0]).toMatchObject({ status: "applied", applied_on: "2026-10-14", job: { company: "Acme" } });
  });

  it("refuses other file types and tables without a title column", async () => {
    await expect(parseTrackerFile({ name: "t.json", bytes: new Uint8Array([1]) })).rejects.toThrow(ImportFormatError);
    expect(() => tableToTrackerRows([["Company", "Status"]])).toThrow(ImportFormatError);
  });
});

describe("cellToIsoDate", () => {
  it("accepts dates, ISO and US strings, and Excel serials; nothing else", () => {
    expect(cellToIsoDate(new Date(Date.UTC(2026, 9, 14)))).toBe("2026-10-14");
    expect(cellToIsoDate("2026-10-14")).toBe("2026-10-14");
    expect(cellToIsoDate("10/14/2026")).toBe("2026-10-14");
    expect(cellToIsoDate(46309)).toBe("2026-10-14");
    expect(cellToIsoDate(7)).toBeNull();
    expect(cellToIsoDate("last Tuesday")).toBeNull();
    expect(cellToIsoDate(null)).toBeNull();
  });
});
