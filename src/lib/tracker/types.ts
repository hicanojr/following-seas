/**
 * Tracker shapes. Column names match the applications and jobs tables in
 * supabase/migrations/0001_init.sql. Dates are plain "YYYY-MM-DD" strings,
 * the same as Postgres `date` columns come back from PostgREST.
 */

export const APPLICATION_STATUSES = ["saved", "applied", "interview", "offer", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  closed: "Closed",
};

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** The job fields the tracker shows next to an application. */
export interface TrackedJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  source: string;
}

export interface ApplicationRow {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  applied_on: string | null;
  follow_up_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** An application with its job, as the board and the Brief use it. */
export interface TrackedApplication extends ApplicationRow {
  job: TrackedJob;
}
