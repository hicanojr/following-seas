/**
 * Map the free-text Status column of a tracker spreadsheet to an application
 * status. Anything not recognized, and an empty cell, becomes "saved".
 */

import type { ApplicationStatus } from "./types";

export interface MappedStatus {
  status: ApplicationStatus;
  /** False when the text was not empty and was not recognized. */
  recognized: boolean;
}

const RULES: [RegExp, ApplicationStatus][] = [
  // "Not applied", "Not yet applied", "To apply", "Will apply" first, so "applied" does not match them.
  [/^(?:not\b|to\s+apply|will\s+apply|haven'?t|have\s+not|planning|plan\s+to)/, "saved"],
  [/reject|declin|closed|withdr|no\s+longer|not\s+selected|not\s+moving|filled|ghost|dead|pass(?:ed)?\b|lost/, "closed"],
  [/offer/, "offer"],
  [/interview|screen|on-?site|final\s+round|second\s+round/, "interview"],
  [/appl|submit|sent/, "applied"],
  [/saved?|track|shortlist|interest|watch|to\s*do|consider|maybe|research/, "saved"],
];

export function mapTrackerStatus(value: unknown): MappedStatus {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return { status: "saved", recognized: true };
  for (const [pattern, status] of RULES) {
    if (pattern.test(text)) return { status, recognized: true };
  }
  return { status: "saved", recognized: false };
}
