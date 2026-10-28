/**
 * Model scoring for the Scoring agent.
 *
 * The client is injected so tests can mock it; the real one is built in
 * ./client.ts from ANTHROPIC_API_KEY (server only). The model sees the job,
 * the profile, the person's career facts, and the pre-check results, and
 * returns JSON that is validated, clamped, and merged with the pre-checks.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { assertAllowed } from "@/lib/gates";
import type { JobRow, ProfileRow, ScoreResult } from "@/lib/jobs/types";
import { dedupeList, formatUsd } from "./prechecks";
import { renderParsedResume, type ParsedResume } from "@/lib/resume/parsed";
import type { CareerFacts, PrecheckResult } from "./types";

/** Fast, inexpensive default. Override with SCORING_MODEL. */
export const DEFAULT_SCORING_MODEL = "claude-haiku-5-5";

/** A deal-breaker hit never scores above this. */
export const DEAL_BREAKER_FIT_CAP = 2;
/** A hard gap (such as CLIA director credentials) never scores above this. */
export const HARD_GAP_FIT_CAP = 4;

/** Only the part of the SDK client that scoring uses. */
export type ScoringClient = Pick<Anthropic, "messages">;

export const DEFAULT_RUBRIC = [
  "9-10: administrative laboratory director role, pay clears the minimum, no unmet required credentials.",
  "7-8: strong match with one open question.",
  "5-6: good duties match but an unmet required credential, pay mostly below the minimum, or a contract role.",
  "1-4: a hard gap, such as CLIA laboratory director credentials (MD, DO, doctoral degree, board certification), or outside the target setting.",
].join("\n");

export const SYSTEM_PROMPT = `You score job postings for one person's job search. You are careful and plain-spoken.

Rules you must follow:
- Use only the career facts provided. Never invent experience, numbers, titles, employers, credentials, or dates.
- A parsed resume, when one is attached, is a cached extraction of the resume the person supplied. Reuse it. Do not add facts that are not written there or in the career facts.
- When you are unsure whether the person meets a requirement, list it as a gap. Do not guess in their favor.
- requirements_met lists only requirements the posting states that the career facts clearly support. Quote the requirement briefly.
- gaps lists requirements the career facts do not show, plus open questions (unclear pay, setting, schedule, contract status).
- must_haves_met lists only must-haves, copied exactly from the list you are given, that the posting clearly confirms. Leave out any you cannot confirm.
- The pre-check findings were computed by code and are correct. Do not contradict them; they will be added to your answer.
- reason is one short line (under 160 characters) that explains the score.
- fit is a whole number from 1 to 10 that follows the scoring rubric.

Return only the JSON object.`;

/** What the model must return. Fit is clamped after validation. */
export const ModelScoreSchema = z.object({
  fit: z.number(),
  reason: z.string(),
  requirements_met: z.array(z.string()),
  gaps: z.array(z.string()),
  must_haves_met: z.array(z.string()),
});
export type ModelScore = z.infer<typeof ModelScoreSchema>;

export function clampFit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function rubricText(profile: Pick<ProfileRow, "scoring_rubric">): string {
  const rubric = profile.scoring_rubric;
  if (rubric && typeof rubric === "object" && Object.keys(rubric).length > 0) {
    return JSON.stringify(rubric, null, 2);
  }
  return DEFAULT_RUBRIC;
}

function list(items: readonly string[] | null | undefined): string {
  const clean = (items ?? []).filter((s) => typeof s === "string" && s.trim());
  return clean.length ? clean.map((s) => `- ${s}`).join("\n") : "(none)";
}

function section(text: string): string {
  return text.trim() ? text.trim() : "(none provided)";
}

/** The user message. Stable content first, the posting last. */
export function buildUserPrompt(
  job: JobRow,
  profile: ProfileRow,
  facts: CareerFacts | null,
  pre: PrecheckResult,
  parsed: ParsedResume | null = null,
): string {
  const salary =
    job.salary_text ??
    (job.salary_min != null || job.salary_max != null
      ? [job.salary_min, job.salary_max].filter((n): n is number => n != null).map(formatUsd).join(" to ")
      : "not listed");

  return `<scoring_rubric>
${rubricText(profile)}
</scoring_rubric>

<search_profile name="${profile.name}">
Target titles:
${list(profile.target_titles)}
Locations:
${list(profile.locations)}
Minimum base pay: ${profile.min_base_pay != null ? formatUsd(profile.min_base_pay) : "not set"}
Must-haves to confirm from the posting:
${list(pre.unconfirmed_must_haves)}
Plus factors:
${list(profile.plus_factors)}
</search_profile>

<career_facts>
Credentials:
${section(facts?.credentials ?? "")}

Experience:
${section(facts?.experience ?? "")}

Other:
${section(facts?.other ?? "")}
</career_facts>

${
  parsed
    ? `<parsed_resume>
${renderParsedResume(parsed)}
</parsed_resume>

`
    : ""
}<pre_check_findings>
Requirements met:
${list(pre.requirements_met)}
Gaps:
${list(pre.gaps)}
Unmet must-haves:
${list(pre.unmet_must_haves)}
</pre_check_findings>

<job_posting>
Title: ${job.title}
Company: ${job.company ?? "not listed"}
Location: ${job.location ?? "not listed"}
Salary: ${salary}
Listed requirements:
${list(job.requirements)}
Description:
${section(job.description ?? "")}
</job_posting>

Score this posting for this person.`;
}

export class ScoringModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringModelError";
  }
}

/** Validate raw model output. Throws ScoringModelError when it does not fit the schema. */
export function parseModelScore(raw: unknown): ModelScore {
  const result = ModelScoreSchema.safeParse(raw);
  if (!result.success) throw new ScoringModelError(`Model output did not match the schema: ${result.error.message}`);
  return result.data;
}

export interface ModelCallOptions {
  client: ScoringClient;
  model?: string;
}

/** Ask the model for a score. Calls assertAllowed('score') first. */
export async function callScoringModel(
  job: JobRow,
  profile: ProfileRow,
  facts: CareerFacts | null,
  pre: PrecheckResult,
  { client, model = DEFAULT_SCORING_MODEL }: ModelCallOptions,
  parsed: ParsedResume | null = null,
): Promise<ModelScore> {
  assertAllowed("score");

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(ModelScoreSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(job, profile, facts, pre, parsed) }],
  });

  if (response.stop_reason === "refusal") throw new ScoringModelError("The model declined to score this posting.");
  if (response.stop_reason === "max_tokens") throw new ScoringModelError("The model ran out of room before finishing.");

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ScoringModelError("The model did not return JSON.");
  }
  return parseModelScore(raw);
}

/**
 * Combine the pre-checks with the model's answer. Pre-check findings always
 * survive; every must-have not confirmed by the posting or the model is listed
 * as unmet; deal-breakers and hard gaps cap the fit.
 */
export function mergeResult(pre: PrecheckResult, modelScore: ModelScore): ScoreResult {
  const allowed = new Map(pre.unconfirmed_must_haves.map((m) => [m.toLowerCase(), m]));
  const modelConfirmed = new Set(
    modelScore.must_haves_met.map((m) => m.trim().toLowerCase()).filter((m) => allowed.has(m)),
  );
  const stillUnmet = pre.unconfirmed_must_haves.filter((m) => !modelConfirmed.has(m.toLowerCase()));
  const confirmedByModel = pre.unconfirmed_must_haves.filter((m) => modelConfirmed.has(m.toLowerCase()));

  let fit = clampFit(modelScore.fit);
  if (pre.hard_gaps.length > 0) fit = Math.min(fit, HARD_GAP_FIT_CAP);
  if (pre.deal_breaker_hit) fit = Math.min(fit, DEAL_BREAKER_FIT_CAP);

  const reason = pre.deal_breaker_hit
    ? `Screened out: deal-breaker "${pre.deal_breaker_hit}" found in the posting.`
    : oneLine(modelScore.reason) || "No reason given.";

  return {
    fit,
    reason,
    requirements_met: dedupeList([
      ...pre.requirements_met,
      ...confirmedByModel.map((m) => `Must-have: ${m}`),
      ...modelScore.requirements_met,
    ]),
    gaps: dedupeList([...pre.gaps, ...modelScore.gaps]),
    unmet_must_haves: dedupeList([...pre.unmet_must_haves, ...stillUnmet]),
    deal_breaker_hit: pre.deal_breaker_hit,
  };
}

/**
 * Result for a posting screened out by a deal-breaker, without a model call.
 * Nothing is deleted; the job stays visible under "Screened out".
 */
export function screenedOutResult(pre: PrecheckResult): ScoreResult {
  return {
    fit: 1,
    reason: `Screened out: deal-breaker "${pre.deal_breaker_hit}" found in the posting.`,
    requirements_met: pre.requirements_met,
    gaps: pre.gaps,
    unmet_must_haves: dedupeList([...pre.unmet_must_haves, ...pre.unconfirmed_must_haves]),
    deal_breaker_hit: pre.deal_breaker_hit,
  };
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}
