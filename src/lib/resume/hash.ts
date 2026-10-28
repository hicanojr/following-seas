/**
 * sha256 hex of resume text as stored. UTF-8, no extra trimming.
 * The Python worker (worker/hashutil.py) must produce the same digest.
 */

import { createHash } from "node:crypto";

export function resumeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
