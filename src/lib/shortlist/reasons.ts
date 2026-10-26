/**
 * Keep and skip reasons. A decision is the person's own choice; these helpers
 * only shape what they typed or picked into the `decisions.reason` text.
 *
 * Stored form: "<chip>" or "<chip>: <note>" for a skip, and the bare note for a keep.
 */

import { z } from "zod";

export const SKIP_REASONS = [
  "Pay too low",
  "Wrong location",
  "Needs credential I lack",
  "Not a lab admin role",
  "Company",
  "Contract or temp",
  "Other",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export const NOTE_MAX = 500;

const SEPARATOR = ": ";

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
}

export function isSkipReason(value: unknown): value is SkipReason {
  return typeof value === "string" && (SKIP_REASONS as readonly string[]).includes(value);
}

/** The text stored in decisions.reason, or null when there is nothing to store. */
export function composeReason(chip: SkipReason | null | undefined, note: string | null | undefined): string | null {
  const text = clean(note);
  if (chip) return text ? `${chip}${SEPARATOR}${text}` : chip;
  return text || null;
}

/** Split a stored reason back into its chip (when it starts with one) and free text. */
export function parseReason(reason: string | null | undefined): { chip: SkipReason | null; note: string } {
  const text = (reason ?? "").trim();
  if (!text) return { chip: null, note: "" };
  for (const chip of SKIP_REASONS) {
    if (text === chip) return { chip, note: "" };
    if (text.startsWith(chip + SEPARATOR)) return { chip, note: text.slice(chip.length + SEPARATOR.length).trim() };
  }
  return { chip: null, note: text };
}

/** Body of POST /api/decisions. A skip needs a chip or some text; a keep's note is optional. */
export const DecisionBodySchema = z
  .object({
    jobId: z.uuid(),
    profileId: z.uuid(),
    decision: z.enum(["keep", "skip"]),
    chip: z.enum(SKIP_REASONS).nullish(),
    note: z.string().max(2000).nullish(),
  })
  .refine((b) => b.decision === "keep" || Boolean(b.chip) || clean(b.note).length > 0, {
    message: "Choose a reason for skipping, or write one.",
    path: ["chip"],
  });

export type DecisionBody = z.infer<typeof DecisionBodySchema>;

/** The reason to store for a validated body. Keeps never carry a skip chip. */
export function reasonFor(body: DecisionBody): string | null {
  return body.decision === "skip" ? composeReason(body.chip ?? null, body.note) : composeReason(null, body.note);
}
