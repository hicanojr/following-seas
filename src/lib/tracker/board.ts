/**
 * Board and running-list helpers. Pure functions shared by the Tracker page,
 * the route handlers, and the tests.
 */

import { defaultFollowUp } from "./followups";
import { isIsoDate } from "./dates";
import { APPLICATION_STATUSES, type ApplicationStatus, type TrackedApplication } from "./types";

/** Applications grouped by status, in board order. Newest activity first within a column. */
export function groupByStatus<T extends { status: ApplicationStatus; updated_at: string }>(
  apps: readonly T[],
): Record<ApplicationStatus, T[]> {
  const groups = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, [] as T[]])) as Record<
    ApplicationStatus,
    T[]
  >;
  for (const app of apps) groups[app.status]?.push(app);
  for (const s of APPLICATION_STATUSES) groups[s].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return groups;
}

/**
 * The change for "Mark applied": status applied, applied_on the given date
 * (today by default), and a follow-up 7 days later unless one is given.
 */
export function markAppliedPatch(
  today: string,
  input: { applied_on?: string | null; follow_up_on?: string | null } = {},
): { status: "applied"; applied_on: string; follow_up_on: string | null } {
  const appliedOn = isIsoDate(input.applied_on) ? input.applied_on : today;
  const followUp =
    input.follow_up_on === null
      ? null
      : isIsoDate(input.follow_up_on)
        ? input.follow_up_on
        : defaultFollowUp(appliedOn);
  return { status: "applied", applied_on: appliedOn, follow_up_on: followUp };
}

const APPLIED_STATUSES: ReadonlySet<ApplicationStatus> = new Set(["applied", "interview", "offer"]);

/** True when the person has applied: a date applied is recorded, or the status says so. */
export function hasApplied(app: { status: ApplicationStatus; applied_on: string | null }): boolean {
  return app.applied_on != null || APPLIED_STATUSES.has(app.status);
}

export interface RunningListEntry {
  company: string;
  title: string;
  applied_on: string | null;
  url: string | null;
  status: ApplicationStatus;
}

/** Every job applied to, newest first. Entries without a date go last. */
export function runningList(apps: readonly TrackedApplication[]): RunningListEntry[] {
  return apps
    .filter(hasApplied)
    .map((a) => ({
      company: a.job.company ?? "",
      title: a.job.title,
      applied_on: a.applied_on,
      url: a.job.url,
      status: a.status,
      created_at: a.created_at,
    }))
    .sort((a, b) => {
      if (a.applied_on && b.applied_on) {
        return b.applied_on.localeCompare(a.applied_on) || b.created_at.localeCompare(a.created_at);
      }
      if (a.applied_on) return -1;
      if (b.applied_on) return 1;
      return b.created_at.localeCompare(a.created_at);
    })
    .map(({ company, title, applied_on, url, status }) => ({ company, title, applied_on, url, status }));
}

function csvCell(value: string | null | undefined): string {
  let v = value ?? "";
  // Keep spreadsheet apps from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The running list as CSV: Company, Title, Date applied, Link, Status. */
export function runningListCsv(entries: readonly RunningListEntry[]): string {
  const lines = [["Company", "Title", "Date applied", "Link", "Status"].join(",")];
  for (const e of entries) {
    lines.push([e.company, e.title, e.applied_on, e.url, e.status].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
