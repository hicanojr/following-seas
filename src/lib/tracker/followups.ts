/**
 * Follow-up reminders. Pure functions: they sort applications into overdue,
 * due today, and upcoming, and work out the change for Snooze and Done.
 * Reminders show in the app only. Nothing here sends anything to anyone.
 */

import { addDays, daysBetween, isIsoDate } from "./dates";
import type { ApplicationStatus } from "./types";

/** Days after applying that the first follow-up falls by default. */
export const DEFAULT_FOLLOW_UP_DAYS = 7;
/** How far "Snooze" pushes a follow-up, counted from today. */
export const SNOOZE_DAYS = 3;
/** The upcoming window, in days after today. */
export const UPCOMING_DAYS = 7;

/** Closed applications never need a follow-up. */
const NO_FOLLOW_UP: ReadonlySet<ApplicationStatus> = new Set(["closed"]);

export interface FollowUpCandidate {
  status: ApplicationStatus;
  follow_up_on: string | null;
}

export interface FollowUps<T> {
  overdue: T[];
  dueToday: T[];
  upcoming: T[];
}

/**
 * Overdue (before today), due today, and upcoming (the next 7 days, not
 * counting today). Each list is sorted by follow-up date, earliest first.
 * Applications without a follow-up date, closed ones, and ones further out
 * are left out.
 */
export function classifyFollowUps<T extends FollowUpCandidate>(
  apps: readonly T[],
  today: string,
  upcomingDays: number = UPCOMING_DAYS,
): FollowUps<T> {
  if (!isIsoDate(today)) throw new RangeError(`Not a date: ${today}`);
  const result: FollowUps<T> = { overdue: [], dueToday: [], upcoming: [] };
  for (const app of apps) {
    if (NO_FOLLOW_UP.has(app.status) || !isIsoDate(app.follow_up_on)) continue;
    const diff = daysBetween(today, app.follow_up_on);
    if (diff < 0) result.overdue.push(app);
    else if (diff === 0) result.dueToday.push(app);
    else if (diff <= upcomingDays) result.upcoming.push(app);
  }
  const byDate = (a: T, b: T) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? "");
  result.overdue.sort(byDate);
  result.dueToday.sort(byDate);
  result.upcoming.sort(byDate);
  return result;
}

/** Number of follow-ups that need attention now (overdue plus due today). */
export function dueCount(followUps: FollowUps<unknown>): number {
  return followUps.overdue.length + followUps.dueToday.length;
}

/** The default follow-up date for an application made on `appliedOn`. */
export function defaultFollowUp(appliedOn: string): string {
  return addDays(appliedOn, DEFAULT_FOLLOW_UP_DAYS);
}

/** Snooze: the follow-up moves to 3 days after today. */
export function snoozeFollowUp(today: string, days: number = SNOOZE_DAYS): { follow_up_on: string } {
  return { follow_up_on: addDays(today, days) };
}

/** Add a line "YYYY-MM-DD: text" to the end of the notes. */
export function appendDatedNote(notes: string | null | undefined, today: string, text: string): string {
  const line = `${today}: ${text.trim()}`;
  const existing = (notes ?? "").replace(/\s+$/, "");
  return existing ? `${existing}\n${line}` : line;
}

/** Done: the follow-up date is cleared and a dated note records it. */
export function completeFollowUp(
  notes: string | null | undefined,
  today: string,
  text = "Followed up.",
): { follow_up_on: null; notes: string } {
  return { follow_up_on: null, notes: appendDatedNote(notes, today, text) };
}
