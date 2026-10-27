import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { ChiefClient } from "./agent";
import { DEFAULT_CHIEF_MODEL } from "./prompt";

/** True when the server has a key for the Chief of Staff. */
export function isChiefConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The Chief's model: CHIEF_MODEL, or a capable current default. */
export function chiefModel(): string {
  return process.env.CHIEF_MODEL?.trim() || DEFAULT_CHIEF_MODEL;
}

/** Anthropic client for the Chief, or null without ANTHROPIC_API_KEY. Server only. */
export function createChiefClient(): ChiefClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 1 });
}
