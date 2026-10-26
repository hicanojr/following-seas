/**
 * Batch dedupe using the same key as the database (src/lib/dedupe.ts):
 * company|title|location, lower case. Duplicates within a batch keep the first
 * posting; postings whose key is already saved for the user are skipped.
 */

import { dedupeKey } from "@/lib/dedupe";
import type { NormalizedJob } from "@/lib/jobs/types";

export interface DuplicateJob {
  job: NormalizedJob;
  key: string;
  reason: "duplicate_in_batch" | "already_saved";
}

export function dedupeBatch(
  jobs: NormalizedJob[],
  existingKeys: ReadonlySet<string> = new Set(),
): { unique: NormalizedJob[]; duplicates: DuplicateJob[] } {
  const seen = new Set<string>();
  const unique: NormalizedJob[] = [];
  const duplicates: DuplicateJob[] = [];
  for (const job of jobs) {
    const key = dedupeKey(job);
    if (existingKeys.has(key)) {
      duplicates.push({ job, key, reason: "already_saved" });
    } else if (seen.has(key)) {
      duplicates.push({ job, key, reason: "duplicate_in_batch" });
    } else {
      seen.add(key);
      unique.push(job);
    }
  }
  return { unique, duplicates };
}
