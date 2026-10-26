/**
 * Importers: turn pasted text or an uploaded file into NormalizedJob[].
 *
 * Supported input:
 *   - JSON: an array of job objects, or { jobs: [...] } / { results: [...] }.
 *   - CSV or tab separated text with a header row.
 *   - .xlsx workbooks, including the trial tracker format (sheet "Tracker").
 *
 * All functions are pure apart from reading the bytes they are given. Rows
 * that cannot be imported come back in `skipped` with a reason.
 */

import readXlsxFile from "read-excel-file/universal";
import type { JobSource, NormalizedJob } from "@/lib/jobs/types";
import { parseCsv } from "./csv";
import { fieldForHeader, rowToJob } from "./fields";

export { parseSalary, HOURS_PER_YEAR } from "./salary";
export { parseCsv } from "./csv";
export { rowToJob, fieldForHeader } from "./fields";

export interface SkippedRow {
  /** 1-based row number in the source (header is row 1 for tables), or item number for JSON. */
  row: number;
  reason: string;
}

export interface ParsedImport {
  jobs: NormalizedJob[];
  skipped: SkippedRow[];
}

export interface ImportOptions {
  /** Source used when a row does not name one. Defaults to "manual". */
  defaultSource?: JobSource;
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}

/** Largest upload accepted, in bytes. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function cellToValue(cell: unknown): unknown {
  if (typeof cell === "string") return cell.trim();
  return cell;
}

/** A table (first matching row is the header) to jobs. */
export function tableToJobs(rows: unknown[][], options: ImportOptions = {}): ParsedImport {
  // Find the header: the first of the top ten rows with a column that maps to title.
  const headerIndex = rows
    .slice(0, 10)
    .findIndex((r) => r.some((c) => typeof c === "string" && fieldForHeader(c) === "title"));
  if (headerIndex === -1) {
    throw new ImportFormatError(
      "No title column found. Add a header row with a column named Title (or Job title, Position).",
    );
  }
  const headers = rows[headerIndex].map((h) => (typeof h === "string" ? h.trim() : ""));

  const jobs: NormalizedJob[] = [];
  const skipped: SkippedRow[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const rowNumber = headerIndex + 2 + i;
    if (r.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) return;
    const record: Record<string, unknown> = {};
    headers.forEach((h, col) => {
      if (h) record[h] = cellToValue(r[col]);
    });
    const result = rowToJob(record, options);
    if (result.ok) jobs.push(result.job);
    else skipped.push({ row: rowNumber, reason: result.reason });
  });
  return { jobs, skipped };
}

export function importCsv(text: string, options: ImportOptions = {}): ParsedImport {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ImportFormatError("The CSV is empty.");
  return tableToJobs(rows, options);
}

function jsonItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["jobs", "results", "items", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    return [data];
  }
  throw new ImportFormatError("JSON must be an array of jobs or an object with a jobs array.");
}

export function importJson(input: string | unknown, options: ImportOptions = {}): ParsedImport {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new ImportFormatError("That is not valid JSON.");
    }
  }
  const jobs: NormalizedJob[] = [];
  const skipped: SkippedRow[] = [];
  jsonItems(data).forEach((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      skipped.push({ row: i + 1, reason: "Not a job object" });
      return;
    }
    const result = rowToJob(item as Record<string, unknown>, options);
    if (result.ok) jobs.push(result.job);
    else skipped.push({ row: i + 1, reason: result.reason });
  });
  return { jobs, skipped };
}

/** Pasted text: JSON when it starts with [ or {, otherwise CSV or tab separated. */
export function importText(text: string, options: ImportOptions = {}): ParsedImport {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) throw new ImportFormatError("Nothing to import.");
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return importJson(trimmed, options);
  return importCsv(trimmed, options);
}

export interface XlsxImportOptions extends ImportOptions {
  /** Sheet to read. Defaults to "Tracker" when present, otherwise the first sheet. */
  sheet?: string;
}

export async function importXlsx(
  data: ArrayBuffer | Uint8Array,
  options: XlsxImportOptions = {},
): Promise<ParsedImport> {
  const buffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : data;
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(buffer);
  } catch {
    throw new ImportFormatError("That file could not be read as an .xlsx workbook.");
  }
  const wanted = options.sheet?.toLowerCase();
  const sheet =
    (wanted
      ? sheets.find((s) => s.sheet.toLowerCase() === wanted)
      : sheets.find((s) => s.sheet.toLowerCase() === "tracker")) ?? (wanted ? undefined : sheets[0]);
  if (!sheet) throw new ImportFormatError(`No sheet named "${options.sheet}" in that workbook.`);
  return tableToJobs(sheet.data as unknown[][], options);
}

export type ImportFileKind = "xlsx" | "csv" | "json";

export function fileKind(name: string, type = ""): ImportFileKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || type.includes("spreadsheetml")) return "xlsx";
  if (n.endsWith(".csv") || n.endsWith(".tsv") || n.endsWith(".txt") || type === "text/csv") return "csv";
  if (n.endsWith(".json") || type === "application/json") return "json";
  return null;
}

/** An uploaded file to jobs, chosen by extension or MIME type. */
export async function importFile(
  file: { name: string; type?: string; bytes: ArrayBuffer | Uint8Array },
  options: XlsxImportOptions = {},
): Promise<ParsedImport> {
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportFormatError("That file is larger than 5 MB.");
  }
  const kind = fileKind(file.name, file.type);
  if (kind === "xlsx") return importXlsx(file.bytes, options);
  if (kind === null) {
    throw new ImportFormatError("Upload an .xlsx, .csv, or .json file.");
  }
  const text = new TextDecoder().decode(file.bytes);
  return kind === "json" ? importJson(text, options) : importText(text, options);
}
