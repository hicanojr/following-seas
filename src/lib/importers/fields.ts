/**
 * Flexible field mapping from pasted or uploaded rows to NormalizedJob.
 *
 * Header names are matched loosely (case, spaces, and punctuation ignored), so
 * "Pay (as posted)", "salary", and "Salary Text" all map to pay. Values that
 * are missing stay null. Nothing is invented.
 */

import type { EasyApply, JobSource, NormalizedJob } from "@/lib/jobs/types";
import { parseSalary } from "./salary";

export type JobField =
  | "title"
  | "company"
  | "location"
  | "salary"
  | "salary_min"
  | "salary_max"
  | "url"
  | "description"
  | "requirements"
  | "easy_apply"
  | "posted_at"
  | "source"
  | "external_id";

/** Normalized header -> field. Keys are lower case letters and digits only. */
const HEADER_ALIASES: Record<JobField, string[]> = {
  title: ["title", "jobtitle", "position", "positiontitle", "role", "jobname"],
  company: [
    "company",
    "companyname",
    "employer",
    "employername",
    "organization",
    "organizationname",
    "hiringorganization",
  ],
  location: [
    "location",
    "locationterritory",
    "joblocation",
    "formattedlocation",
    "positionlocationdisplay",
    "city",
  ],
  salary: [
    "salary",
    "pay",
    "payasposted",
    "salarytext",
    "salaryrange",
    "compensation",
    "wage",
    "payrange",
    "salaryinfo",
  ],
  salary_min: ["salarymin", "minsalary", "paymin", "minpay"],
  salary_max: ["salarymax", "maxsalary", "paymax", "maxpay"],
  url: ["url", "link", "joburl", "joblink", "postingurl", "viewjoburl", "href", "positionuri"],
  description: ["description", "jobdescription", "descriptiontext", "summary", "snippet"],
  requirements: [
    "requirements",
    "keyrequirements",
    "keyrequirementsfromposting",
    "qualifications",
    "qualificationsummary",
  ],
  easy_apply: ["easyapply", "iseasyapply"],
  posted_at: [
    "posted",
    "posteddate",
    "postedat",
    "postedon",
    "dateposted",
    "datepublished",
    "publicationdate",
    "postingdate",
  ],
  source: ["source", "site", "jobboard", "board"],
  external_id: ["externalid", "id", "jobid", "jobkey", "postingid"],
};

const HEADER_TO_FIELD = new Map<string, JobField>();
for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [JobField, string[]][]) {
  for (const alias of aliases) HEADER_TO_FIELD.set(alias, field);
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The job field a header maps to, or null when the column is not used. */
export function fieldForHeader(header: string): JobField | null {
  return HEADER_TO_FIELD.get(normalizeHeader(header)) ?? null;
}

const SOURCES: Record<string, JobSource> = {
  indeed: "indeed",
  ziprecruiter: "ziprecruiter",
  zip: "ziprecruiter",
  linkedin: "linkedin",
  usajobs: "usajobs",
  manual: "manual",
};

export function parseSource(value: unknown): JobSource | null {
  if (typeof value !== "string") return null;
  return SOURCES[normalizeHeader(value)] ?? null;
}

/** "Yes", "Easy Apply", true -> yes; "No", "No (state system)", false -> no; anything else unknown. */
export function parseEasyApply(value: unknown): EasyApply {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value !== "string") return "unknown";
  const v = value.trim().toLowerCase();
  if (/^(?:yes|y|true|easy\s*apply)\b/.test(v)) return "yes";
  if (/^(?:no|n|false)\b/.test(v)) return "no";
  return "unknown";
}

/** Only http(s) links are kept. Placeholders such as "Open posting" become null. */
export function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return null;
  try {
    return new URL(v).toString();
  } catch {
    return null;
  }
}

/** Dates and date strings become ISO strings. Relative text such as "3 days ago" stays null. */
export function parseDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  // ISO dates, with or without time.
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    // No zone given: read as UTC so results do not depend on the server's time zone.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? `${v}T00:00:00Z`
      : /(?:Z|[+-]\d{2}:?\d{2})$/.test(v)
        ? v.replace(" ", "T")
        : `${v.replace(" ", "T")}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // US style 10/24/2026.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) {
    const d = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function parseText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v : null;
}

/** Requirements from an array, or from text split on semicolons, bullets, or new lines. */
export function parseRequirements(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => parseText(v)).filter((v): v is string => v !== null);
  }
  const text = parseText(value);
  if (!text) return [];
  return text
    .split(/\r?\n|;|•/)
    .map((s) => s.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

function parseWholeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === "string" && /^\s*\$?\s*[\d,]+(?:\.\d+)?\s*$/.test(value)) {
    const n = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

export interface RowToJobOptions {
  /** Source used when a row does not name one it recognizes. */
  defaultSource?: JobSource;
}

export type RowResult = { ok: true; job: NormalizedJob } | { ok: false; reason: string };

/**
 * Map one record (header -> value) to a NormalizedJob. The first matching
 * column wins when several map to the same field. A row without a title is
 * refused with a reason rather than dropped silently.
 */
export function rowToJob(record: Record<string, unknown>, options: RowToJobOptions = {}): RowResult {
  const values: Partial<Record<JobField, unknown>> = {};
  for (const [header, value] of Object.entries(record)) {
    const field = fieldForHeader(header);
    if (!field || values[field] !== undefined) continue;
    if (value === null || value === undefined || value === "") continue;
    values[field] = value;
  }

  const title = parseText(values.title);
  if (!title) return { ok: false, reason: "No title" };

  // Some sources give pay as a list, for example ["$150,000.00/yr", "$180,000.00/yr"].
  const payRaw = Array.isArray(values.salary)
    ? values.salary.filter((v) => typeof v === "string").join(" - ")
    : values.salary;
  const pay = parseSalary(payRaw);
  let salaryMin = parseWholeNumber(values.salary_min) ?? pay.salary_min;
  let salaryMax = parseWholeNumber(values.salary_max) ?? pay.salary_max;
  if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  }

  return {
    ok: true,
    job: {
      source: parseSource(values.source) ?? options.defaultSource ?? "manual",
      external_id: parseText(values.external_id),
      url: parseUrl(values.url),
      title,
      company: parseText(values.company),
      location: parseText(values.location),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_text: pay.salary_text,
      description: parseText(values.description),
      requirements: parseRequirements(values.requirements),
      easy_apply: parseEasyApply(values.easy_apply),
      posted_at: parseDate(values.posted_at),
    },
  };
}
