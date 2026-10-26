/**
 * Read a tracker spreadsheet (the trial "Tracker" sheet format, or any table
 * with a Title column) into job postings plus the tracker columns the Search
 * importer skips: Status, Date applied, Follow up, and Notes.
 *
 * Postings are mapped by the shared importers in src/lib/importers, so a row
 * becomes the same job (and the same dedupe key) whichever page imports it.
 * Dates are only taken from the sheet; none are made up.
 */

import readXlsxFile from "read-excel-file/universal";
import {
  fieldForHeader,
  fileKind,
  ImportFormatError,
  MAX_IMPORT_BYTES,
  parseCsv,
  rowToJob,
  type SkippedRow,
} from "@/lib/importers";
import { normalizeHeader, parseDate } from "@/lib/importers/fields";
import type { JobSource, NormalizedJob } from "@/lib/jobs/types";
import { mapTrackerStatus } from "./status";
import type { ApplicationStatus } from "./types";

export type TrackerField = "status" | "applied_on" | "follow_up_on" | "notes";

const TRACKER_ALIASES: Record<TrackerField, string[]> = {
  status: ["status", "applicationstatus", "stage", "applicationstage"],
  applied_on: ["dateapplied", "applied", "appliedon", "applieddate", "applicationdate", "dateofapplication"],
  follow_up_on: ["followup", "followupon", "followupdate", "nextfollowup", "followupby"],
  notes: ["notes", "note", "comments", "comment"],
};

const TRACKER_HEADER = new Map<string, TrackerField>();
for (const [field, aliases] of Object.entries(TRACKER_ALIASES) as [TrackerField, string[]][]) {
  for (const alias of aliases) TRACKER_HEADER.set(alias, field);
}

export function trackerFieldForHeader(header: string): TrackerField | null {
  return TRACKER_HEADER.get(normalizeHeader(header)) ?? null;
}

export interface TrackerRow {
  /** 1-based row number in the sheet (the header is counted). */
  row: number;
  job: NormalizedJob;
  status: ApplicationStatus;
  applied_on: string | null;
  follow_up_on: string | null;
  notes: string | null;
  /** Things worth telling the person about this row, such as an unrecognized status. */
  warnings: string[];
}

export interface ParsedTracker {
  rows: TrackerRow[];
  skipped: SkippedRow[];
}

export interface TrackerParseOptions {
  /** Source used when a row does not name one. Defaults to "manual". */
  defaultSource?: JobSource;
  /** Sheet to read. Defaults to "Tracker" when present, otherwise the first sheet. */
  sheet?: string;
}

/** Excel stores dates as days since 1899-12-30. Accept a sensible range only. */
function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
}

/** A sheet cell to YYYY-MM-DD, or null when it is empty or not a date. */
export function cellToIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return excelSerialToIso(value);
  const iso = parseDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function cellText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v : null;
}

function isBlankRow(r: unknown[]): boolean {
  return r.every((c) => c == null || (typeof c === "string" && c.trim() === ""));
}

/** A table (first matching row is the header) to tracker rows. */
export function tableToTrackerRows(rows: unknown[][], options: TrackerParseOptions = {}): ParsedTracker {
  const headerIndex = rows
    .slice(0, 10)
    .findIndex((r) => r.some((c) => typeof c === "string" && fieldForHeader(c) === "title"));
  if (headerIndex === -1) {
    throw new ImportFormatError(
      "No title column found. Add a header row with a column named Title (or Job title, Position).",
    );
  }
  const headers = rows[headerIndex].map((h) => (typeof h === "string" ? h.trim() : ""));
  const trackerColumn: Partial<Record<TrackerField, number>> = {};
  headers.forEach((h, col) => {
    const field = h ? trackerFieldForHeader(h) : null;
    if (field && trackerColumn[field] === undefined) trackerColumn[field] = col;
  });

  const out: TrackerRow[] = [];
  const skipped: SkippedRow[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const rowNumber = headerIndex + 2 + i;
    if (isBlankRow(r)) return;

    const record: Record<string, unknown> = {};
    headers.forEach((h, col) => {
      if (!h || trackerFieldForHeader(h)) return;
      const v = r[col];
      record[h] = typeof v === "string" ? v.trim() : v;
    });
    const result = rowToJob(record, { defaultSource: options.defaultSource });
    if (!result.ok) {
      skipped.push({ row: rowNumber, reason: result.reason });
      return;
    }

    const cell = (field: TrackerField) =>
      trackerColumn[field] === undefined ? undefined : r[trackerColumn[field] as number];
    const warnings: string[] = [];

    const rawStatus = cell("status");
    const mapped = mapTrackerStatus(rawStatus);
    if (!mapped.recognized) {
      warnings.push(`Status "${cellText(rawStatus)}" not recognized; saved as Saved.`);
    }

    const dateCell = (field: TrackerField, label: string) => {
      const raw = cell(field);
      const iso = cellToIsoDate(raw);
      if (raw != null && raw !== "" && !iso) warnings.push(`${label} "${cellText(raw) ?? raw}" is not a date; left empty.`);
      return iso;
    };

    out.push({
      row: rowNumber,
      job: result.job,
      status: mapped.status,
      applied_on: dateCell("applied_on", "Date applied"),
      follow_up_on: dateCell("follow_up_on", "Follow up"),
      notes: cellText(cell("notes")),
      warnings,
    });
  });
  return { rows: out, skipped };
}

/** An uploaded tracker (.xlsx, or .csv with the same columns) to tracker rows. */
export async function parseTrackerFile(
  file: { name: string; type?: string; bytes: ArrayBuffer | Uint8Array },
  options: TrackerParseOptions = {},
): Promise<ParsedTracker> {
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportFormatError("That file is larger than 5 MB.");
  }
  const kind = fileKind(file.name, file.type);
  if (kind === "csv") {
    const rows = parseCsv(new TextDecoder().decode(file.bytes));
    if (rows.length === 0) throw new ImportFormatError("The file is empty.");
    return tableToTrackerRows(rows, options);
  }
  if (kind !== "xlsx") throw new ImportFormatError("Upload the tracker as an .xlsx or .csv file.");

  const bytes = file.bytes;
  const buffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(buffer);
  } catch {
    throw new ImportFormatError("That file could not be read as an .xlsx workbook.");
  }
  const wanted = options.sheet?.toLowerCase();
  const sheet = wanted
    ? sheets.find((s) => s.sheet.toLowerCase() === wanted)
    : (sheets.find((s) => s.sheet.toLowerCase() === "tracker") ?? sheets[0]);
  if (!sheet) throw new ImportFormatError(`No sheet named "${options.sheet}" in that workbook.`);
  return tableToTrackerRows(sheet.data as unknown[][], options);
}
