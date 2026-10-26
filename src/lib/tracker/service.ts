/**
 * The Tracker agent. It records what the person tells it about applications
 * they made themselves, and keeps their follow-up reminders.
 *
 * It never submits an application, never uses Easy Apply, and never sends
 * email or messages. Every write calls assertAllowed first ("track" for the
 * tracker, "remind" for follow-ups) and is written to audit_log.
 */

import { assertAllowed } from "@/lib/gates";
import { dedupeKey } from "@/lib/dedupe";
import type { SkippedRow } from "@/lib/importers";
import { parseUrl } from "@/lib/importers/fields";
import type { NormalizedJob } from "@/lib/jobs/types";
import { markAppliedPatch } from "./board";
import { isIsoDate } from "./dates";
import { completeFollowUp, defaultFollowUp, snoozeFollowUp } from "./followups";
import type { TrackerRow } from "./spreadsheet";
import type { ApplicationPatch, TrackerStore } from "./store";
import { isApplicationStatus, type ApplicationRow, type ApplicationStatus } from "./types";

export class TrackerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TrackerError";
    this.status = status;
    this.code = code;
  }
}

function bad(message: string): never {
  throw new TrackerError(400, "bad_input", message);
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) bad(`That entry is too long (over ${max} characters).`);
  return v;
}

const MAX_NOTES = 5000;

function dateOrNull(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (!isIsoDate(value)) bad(`${label} must be a date (YYYY-MM-DD).`);
  return value;
}

function requireToday(today: unknown): string {
  if (!isIsoDate(today)) bad("today must be a date (YYYY-MM-DD).");
  return today;
}

// ---------------------------------------------------------------------------
// Manual add
// ---------------------------------------------------------------------------

export interface ManualApplicationInput {
  title?: unknown;
  company?: unknown;
  location?: unknown;
  url?: unknown;
  applied_on?: unknown;
  follow_up_on?: unknown;
  notes?: unknown;
}

export interface ManualAddResult {
  application: ApplicationRow;
  jobId: string;
  /** True when the job was already in the app and the application was attached to it. */
  attachedToExisting: boolean;
}

/**
 * The person applied somewhere themselves and says so. Creates a manual job
 * (or finds the existing one by dedupe key) and records the application as
 * applied, with a follow-up 7 days later unless they chose another date.
 */
export async function addManualApplication(
  store: TrackerStore,
  args: { userId: string; today: string; input: ManualApplicationInput },
): Promise<ManualAddResult> {
  assertAllowed("track");
  const today = requireToday(args.today);
  const { input } = args;

  const title = text(input.title, 300);
  if (!title) bad("Add the job title.");
  const rawUrl = text(input.url, 2000);
  const url = rawUrl ? parseUrl(rawUrl) : null;
  if (rawUrl && !url) bad("The link must start with http:// or https://.");
  const appliedOn = dateOrNull(input.applied_on, "Date applied") ?? today;
  const followUpOn = dateOrNull(input.follow_up_on, "Follow-up date") ?? defaultFollowUp(appliedOn);
  const notes = text(input.notes, MAX_NOTES);

  const job: NormalizedJob = {
    source: "manual",
    external_id: null,
    url,
    title,
    company: text(input.company, 300),
    location: text(input.location, 300),
    salary_min: null,
    salary_max: null,
    salary_text: null,
    description: null,
    requirements: [],
    easy_apply: "unknown",
    posted_at: null,
  };

  const key = dedupeKey(job);
  const existingId = (await store.jobIdsByDedupeKey([key])).get(key);
  const { id: jobId, created } = existingId
    ? { id: existingId, created: false }
    : await store.insertJob(args.userId, job);

  const patch = { status: "applied" as const, applied_on: appliedOn, follow_up_on: followUpOn };
  const existingApp = (await store.applicationsByJobId([jobId])).get(jobId);
  const application = existingApp
    ? await store.updateApplication(existingApp.id, {
        ...patch,
        notes: notes ? [existingApp.notes, notes].filter(Boolean).join("\n") : existingApp.notes,
      })
    : await store.insertApplication(args.userId, { job_id: jobId, ...patch, notes });

  await store.audit(args.userId, "track.manual_add", { table: "applications", id: application.id }, {
    job_id: jobId,
    job_created: created,
    application_existed: Boolean(existingApp),
    applied_on: appliedOn,
    follow_up_on: followUpOn,
  });

  return { application, jobId, attachedToExisting: !created };
}

// ---------------------------------------------------------------------------
// Track a job already in the app
// ---------------------------------------------------------------------------

/** Put a job that is already in the app on the tracker (Saved by default). */
export async function trackJob(
  store: TrackerStore,
  args: { userId: string; jobId: string; status?: unknown },
): Promise<{ application: ApplicationRow; created: boolean }> {
  assertAllowed("track");
  const status: ApplicationStatus = args.status === undefined ? "saved" : (args.status as ApplicationStatus);
  if (!isApplicationStatus(status)) bad("Unknown status.");
  if (!(await store.jobExists(args.jobId))) throw new TrackerError(404, "not_found", "That job was not found.");
  const existing = (await store.applicationsByJobId([args.jobId])).get(args.jobId);
  if (existing) return { application: existing, created: false };
  const application = await store.insertApplication(args.userId, {
    job_id: args.jobId,
    status,
    applied_on: null,
    follow_up_on: null,
    notes: null,
  });
  await store.audit(args.userId, "track.add", { table: "applications", id: application.id }, {
    job_id: args.jobId,
    status,
  });
  return { application, created: true };
}

// ---------------------------------------------------------------------------
// Changes to one application
// ---------------------------------------------------------------------------

export type ApplicationAction =
  | { action: "move"; status: ApplicationStatus }
  | { action: "mark_applied"; applied_on?: string | null; follow_up_on?: string | null }
  | { action: "edit"; applied_on?: string | null; follow_up_on?: string | null; notes?: string | null }
  | { action: "snooze" }
  | { action: "done"; note?: string | null };

/** Validate a request body into an ApplicationAction. Throws TrackerError(400) when it does not fit. */
export function parseApplicationAction(body: unknown): ApplicationAction {
  if (!body || typeof body !== "object") bad("Send a JSON object.");
  const b = body as Record<string, unknown>;
  switch (b.action) {
    case "move":
      if (!isApplicationStatus(b.status)) bad("Unknown status.");
      return { action: "move", status: b.status };
    case "mark_applied":
      return {
        action: "mark_applied",
        applied_on: dateOrNull(b.applied_on, "Date applied"),
        follow_up_on: b.follow_up_on === null ? null : dateOrNull(b.follow_up_on, "Follow-up date") ?? undefined,
      };
    case "edit": {
      const out: ApplicationAction = { action: "edit" };
      if ("applied_on" in b) out.applied_on = dateOrNull(b.applied_on, "Date applied");
      if ("follow_up_on" in b) out.follow_up_on = dateOrNull(b.follow_up_on, "Follow-up date");
      if ("notes" in b) {
        if (b.notes != null && typeof b.notes !== "string") bad("Notes must be text.");
        out.notes = text(b.notes, MAX_NOTES);
      }
      return out;
    }
    case "snooze":
      return { action: "snooze" };
    case "done":
      return { action: "done", note: text(b.note, 500) };
    default:
      bad("Unknown action. Use move, mark_applied, edit, snooze, or done.");
  }
}

/** Follow-up changes are reminders ("remind"); everything else is tracking ("track"). */
export function gateFor(action: ApplicationAction["action"]): "track" | "remind" {
  return action === "snooze" || action === "done" ? "remind" : "track";
}

export async function updateApplication(
  store: TrackerStore,
  args: { userId: string; id: string; today: string; change: ApplicationAction },
): Promise<ApplicationRow> {
  const { change } = args;
  assertAllowed(gateFor(change.action));
  const today = requireToday(args.today);

  const current = await store.getApplication(args.id);
  if (!current) throw new TrackerError(404, "not_found", "That application was not found.");

  let patch: ApplicationPatch;
  switch (change.action) {
    case "move":
      patch = { status: change.status };
      // Moving a card into Applied the first time records today, as "Mark applied" would.
      if (change.status === "applied" && !current.applied_on) {
        patch = markAppliedPatch(today, { follow_up_on: current.follow_up_on ?? undefined });
      }
      break;
    case "mark_applied":
      patch = markAppliedPatch(today, change);
      break;
    case "edit":
      patch = {};
      if (change.applied_on !== undefined) patch.applied_on = change.applied_on;
      if (change.follow_up_on !== undefined) patch.follow_up_on = change.follow_up_on;
      if (change.notes !== undefined) patch.notes = change.notes;
      if (Object.keys(patch).length === 0) bad("Nothing to change.");
      break;
    case "snooze":
      patch = snoozeFollowUp(today);
      break;
    case "done":
      patch = completeFollowUp(current.notes, today, change.note ?? undefined);
      break;
  }

  const updated = await store.updateApplication(current.id, patch);
  await store.audit(args.userId, `${gateFor(change.action)}.${change.action}`, {
    table: "applications",
    id: current.id,
  }, {
    job_id: current.job_id,
    from: { status: current.status, applied_on: current.applied_on, follow_up_on: current.follow_up_on },
    to: { status: updated.status, applied_on: updated.applied_on, follow_up_on: updated.follow_up_on },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Spreadsheet import
// ---------------------------------------------------------------------------

export interface ImportListed {
  row: number;
  title: string;
  company: string | null;
  status: ApplicationStatus;
}

export interface TrackerImportSummary {
  received: number;
  /** New job and new application. */
  created: ImportListed[];
  /** The job was already in the app; a new application was attached to it. */
  attached: ImportListed[];
  /** Rows not imported, with the reason. */
  skipped: { row: number; title: string | null; reason: string }[];
  /** Imported rows with something worth checking, such as an unrecognized status. */
  warnings: { row: number; title: string; message: string }[];
}

/**
 * Import tracker rows: dedupe each posting against the person's jobs, create
 * the job when it is new, and record an application with the sheet's status
 * and dates. A job already on the tracker is left as it is, so an import never
 * overwrites what the person changed in the app.
 */
export async function importTrackerRows(
  store: TrackerStore,
  args: { userId: string; rows: TrackerRow[]; skipped?: SkippedRow[]; fileName?: string | null },
): Promise<TrackerImportSummary> {
  assertAllowed("import");
  assertAllowed("dedupe");
  assertAllowed("track");

  const summary: TrackerImportSummary = {
    received: args.rows.length + (args.skipped?.length ?? 0),
    created: [],
    attached: [],
    skipped: (args.skipped ?? []).map((s) => ({ row: s.row, title: null, reason: s.reason })),
    warnings: [],
  };

  // Repeats inside the file: the first row wins.
  const seen = new Set<string>();
  const unique: TrackerRow[] = [];
  for (const row of args.rows) {
    const key = dedupeKey(row.job);
    if (seen.has(key)) {
      summary.skipped.push({ row: row.row, title: row.job.title, reason: "Repeated in this file" });
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  const existingJobs = await store.jobIdsByDedupeKey(unique.map((r) => dedupeKey(r.job)));
  const existingApps = await store.applicationsByJobId([...existingJobs.values()]);

  for (const row of unique) {
    const listed = { row: row.row, title: row.job.title, company: row.job.company, status: row.status };
    const existingJobId = existingJobs.get(dedupeKey(row.job));
    if (existingJobId && existingApps.has(existingJobId)) {
      summary.skipped.push({ row: row.row, title: row.job.title, reason: "Already on your tracker" });
      continue;
    }
    const { id: jobId, created } = existingJobId
      ? { id: existingJobId, created: false }
      : await store.insertJob(args.userId, row.job);
    await store.insertApplication(args.userId, {
      job_id: jobId,
      status: row.status,
      applied_on: row.applied_on,
      follow_up_on: row.follow_up_on,
      notes: row.notes,
    });
    (created ? summary.created : summary.attached).push(listed);
    for (const message of row.warnings) summary.warnings.push({ row: row.row, title: row.job.title, message });
  }

  await store.audit(args.userId, "track.import", { table: "applications", id: null }, {
    file: args.fileName ?? null,
    received: summary.received,
    created: summary.created.length,
    attached: summary.attached.length,
    skipped: summary.skipped.length,
  });

  summary.skipped.sort((a, b) => a.row - b.row);
  return summary;
}
