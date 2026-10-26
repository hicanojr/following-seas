import type { ScoreResult } from "@/lib/jobs/types";

/**
 * The person's career facts sheet (table career_facts). Each section is plain
 * text, one fact per line. Agents may use nothing else about the person.
 */
export interface CareerFacts {
  credentials: string;
  experience: string;
  other: string;
}

export const EMPTY_CAREER_FACTS: CareerFacts = Object.freeze({
  credentials: "",
  experience: "",
  other: "",
});

/** What the deterministic checks found before any model call. */
export interface PrecheckResult {
  requirements_met: string[];
  gaps: string[];
  unmet_must_haves: string[];
  /** Must-haves found word for word in the posting. */
  confirmed_must_haves: string[];
  /** Must-haves the checks could not confirm; the model may confirm them from the posting. */
  unconfirmed_must_haves: string[];
  deal_breaker_hit: string | null;
  /** Hard gaps that cap the fit score (for example CLIA director credentials). */
  hard_gaps: string[];
}

export type { ScoreResult };
