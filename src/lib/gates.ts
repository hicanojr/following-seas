/**
 * Hard gates for every agent in Fair Winds.
 *
 * Agents (Chief of Staff, Search, Scoring, Tracker, Writer) must call
 * `assertAllowed(action)` before doing anything with side effects. The lists
 * below are explicit on purpose: an action that is not on the allow-list is
 * refused, even if nobody thought to forbid it.
 *
 * Changing these lists is a product decision, not a refactor. See CLAUDE.md.
 */

export const ALLOWED_ACTIONS = [
  "search",
  "import",
  "dedupe",
  "score",
  "shortlist_suggest",
  "track",
  "remind",
  "draft",
] as const;

export const FORBIDDEN_ACTIONS = [
  "submit_application",
  "easy_apply",
  "send_email",
  "message_recruiter",
  "linkedin_login",
  "use_li_at_cookie",
  "hard_delete",
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number];

export class GateError extends Error {
  readonly action: string;
  readonly reason: "forbidden" | "unknown";

  constructor(action: string, reason: "forbidden" | "unknown") {
    super(
      reason === "forbidden"
        ? `Action "${action}" is forbidden for agents. A person must do this themselves.`
        : `Action "${action}" is not on the agent allow-list.`,
    );
    this.name = "GateError";
    this.action = action;
    this.reason = reason;
  }
}

const allowed = new Set<string>(ALLOWED_ACTIONS);
const forbidden = new Set<string>(FORBIDDEN_ACTIONS);

export function isAllowed(action: string): action is AllowedAction {
  return allowed.has(action) && !forbidden.has(action);
}

/** Throws a GateError unless `action` is explicitly allowed. */
export function assertAllowed(action: string): asserts action is AllowedAction {
  if (forbidden.has(action)) throw new GateError(action, "forbidden");
  if (!allowed.has(action)) throw new GateError(action, "unknown");
}

/**
 * LinkedIn results come from the Apify actor curious_coder/linkedin-jobs-scraper.
 * Every run must request between 25 and 50 results.
 */
export const LINKEDIN_RESULT_CAP = Object.freeze({ min: 25, max: 50 });

/** Clamp a requested LinkedIn result count into the allowed range. */
export function clampLinkedInResults(requested: number | null | undefined): number {
  const { min, max } = LINKEDIN_RESULT_CAP;
  if (requested == null || !Number.isFinite(requested)) return min;
  return Math.min(max, Math.max(min, Math.floor(requested)));
}
