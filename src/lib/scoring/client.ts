import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SCORING_MODEL, type ScoringClient } from "./model";

/** True when the server has a key for the Scoring agent. */
export function isScoringConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The model to score with: SCORING_MODEL, or a fast, inexpensive default. */
export function scoringModel(): string {
  return process.env.SCORING_MODEL?.trim() || DEFAULT_SCORING_MODEL;
}

/** Anthropic client for scoring, or null without ANTHROPIC_API_KEY. Server only. */
export function createScoringClient(): ScoringClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}
