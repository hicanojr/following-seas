import { describe, expect, it, vi } from "vitest";
import {
  DEAL_BREAKER_FIT_CAP,
  DEFAULT_RUBRIC,
  HARD_GAP_FIT_CAP,
  SYSTEM_PROMPT,
  ScoringModelError,
  buildUserPrompt,
  callScoringModel,
  clampFit,
  mergeResult,
  parseModelScore,
  rubricText,
  screenedOutResult,
  type ModelScore,
  type ScoringClient,
} from "../model";
import { runPrechecks } from "../prechecks";
import type { PrecheckResult } from "../types";
import { MLT_FACTS, makeJob, makeProfile } from "./fixtures";

function pre(overrides: Partial<PrecheckResult> = {}): PrecheckResult {
  return {
    requirements_met: [],
    gaps: [],
    unmet_must_haves: [],
    confirmed_must_haves: [],
    unconfirmed_must_haves: [],
    deal_breaker_hit: null,
    hard_gaps: [],
    ...overrides,
  };
}

function modelScore(overrides: Partial<ModelScore> = {}): ModelScore {
  return { fit: 8, reason: "Strong duties match.", requirements_met: [], gaps: [], must_haves_met: [], ...overrides };
}

function mockClient(text: string, stop_reason = "end_turn") {
  const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text }], stop_reason });
  return { client: { messages: { create } } as unknown as ScoringClient, create };
}

describe("prompts", () => {
  it("system prompt forbids invented facts and sends unsure items to gaps", () => {
    expect(SYSTEM_PROMPT).toMatch(/Use only the career facts provided/);
    expect(SYSTEM_PROMPT).toMatch(/Never invent experience, numbers, titles/);
    expect(SYSTEM_PROMPT).toMatch(/dates/);
    expect(SYSTEM_PROMPT).toMatch(/unsure.*gap/);
  });

  it("uses the profile rubric when present, else the default", () => {
    expect(rubricText(makeProfile())).toBe(DEFAULT_RUBRIC);
    expect(DEFAULT_RUBRIC).toMatch(/CLIA/);
    expect(rubricText(makeProfile({ scoring_rubric: { "9-10": "custom" } }))).toContain("custom");
  });

  it("includes facts, pre-checks, and the posting in the user prompt", () => {
    const job = makeJob({ description: "Run the core lab." });
    const profile = makeProfile({ must_haves: ["Hospital setting"] });
    const p = runPrechecks(job, profile, MLT_FACTS);
    const prompt = buildUserPrompt(job, profile, MLT_FACTS, p);
    expect(prompt).toContain("MLT(ASCP)");
    expect(prompt).toContain("Pay not listed");
    expect(prompt).toContain("Hospital setting");
    expect(prompt).toContain("Run the core lab.");
  });
});

describe("validation", () => {
  it("clamps fit to whole numbers 1-10", () => {
    expect(clampFit(14)).toBe(10);
    expect(clampFit(0)).toBe(1);
    expect(clampFit(6.6)).toBe(7);
    expect(clampFit(Number.NaN)).toBe(1);
  });

  it("rejects output that does not match the schema", () => {
    expect(() => parseModelScore({ fit: 5 })).toThrow(ScoringModelError);
    expect(parseModelScore(modelScore()).fit).toBe(8);
  });
});

describe("callScoringModel", () => {
  const job = makeJob();
  const profile = makeProfile();

  it("sends the configured model and parses JSON", async () => {
    const { client, create } = mockClient(JSON.stringify(modelScore({ fit: 12 })));
    const result = await callScoringModel(job, profile, MLT_FACTS, pre(), { client, model: "test-model" });
    expect(result.fit).toBe(12); // clamped later in mergeResult
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("test-model");
    expect(params.system).toBe(SYSTEM_PROMPT);
    expect(params.output_config.format).toBeDefined();
  });

  it("throws on non-JSON, refusals, and truncation", async () => {
    await expect(callScoringModel(job, profile, null, pre(), mockClient("not json"))).rejects.toThrow(ScoringModelError);
    await expect(callScoringModel(job, profile, null, pre(), mockClient("{}", "refusal"))).rejects.toThrow(/declined/);
    await expect(callScoringModel(job, profile, null, pre(), mockClient("{", "max_tokens"))).rejects.toThrow(/room/);
  });
});

describe("mergeResult", () => {
  it("keeps pre-check findings and adds the model's", () => {
    const result = mergeResult(
      pre({ requirements_met: ["Pay clears minimum ($120,000)"], gaps: ["Pay not listed"], unmet_must_haves: ["Pay below minimum ($1)"] }),
      modelScore({ requirements_met: ["Leads lab staff"], gaps: ["Pay not listed", "Union setting unclear"] }),
    );
    expect(result.requirements_met).toEqual(["Pay clears minimum ($120,000)", "Leads lab staff"]);
    expect(result.gaps).toEqual(["Pay not listed", "Union setting unclear"]);
    expect(result.unmet_must_haves).toEqual(["Pay below minimum ($1)"]);
    expect(result.fit).toBe(8);
    expect(result.deal_breaker_hit).toBeNull();
  });

  it("lists every must-have the model did not confirm", () => {
    const result = mergeResult(
      pre({ unconfirmed_must_haves: ["Hospital setting", "Day shift"] }),
      modelScore({ must_haves_met: ["hospital setting", "Something invented"] }),
    );
    expect(result.unmet_must_haves).toEqual(["Day shift"]);
    expect(result.requirements_met).toContain("Must-have: Hospital setting");
    expect(result.requirements_met).not.toContain("Must-have: Something invented");
  });

  it("caps fit for hard gaps and deal-breakers", () => {
    expect(mergeResult(pre({ hard_gaps: ["CLIA"] }), modelScore({ fit: 9 })).fit).toBe(HARD_GAP_FIT_CAP);
    const screened = mergeResult(pre({ deal_breaker_hit: "contract" }), modelScore({ fit: 9 }));
    expect(screened.fit).toBe(DEAL_BREAKER_FIT_CAP);
    expect(screened.deal_breaker_hit).toBe("contract");
    expect(screened.reason).toMatch(/Screened out.*contract/);
  });

  it("screenedOutResult keeps the reason and lists unconfirmed must-haves", () => {
    const r = screenedOutResult(pre({ deal_breaker_hit: "night shift", unconfirmed_must_haves: ["Remote"] }));
    expect(r.fit).toBe(1);
    expect(r.reason).toMatch(/night shift/);
    expect(r.unmet_must_haves).toEqual(["Remote"]);
  });
});
