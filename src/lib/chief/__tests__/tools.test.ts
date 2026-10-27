import { beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the real gate so tests can see when it is called, relative to services.
const timeline = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/gates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gates")>();
  return {
    ...actual,
    assertAllowed: vi.fn((action: string) => {
      timeline.push(`gate:${action}`);
      return actual.assertAllowed(action);
    }),
  };
});

import { ALLOWED_ACTIONS, FORBIDDEN_ACTIONS, assertAllowed } from "@/lib/gates";
import { runTool } from "../agent";
import { CHIEF_SYSTEM_PROMPT, HARD_GATES } from "../prompt";
import { CHIEF_TOOLS, isQuoteFromMessage } from "../tools";
import {
  JOB_ID,
  PROFILE_ID,
  QUERY_ID,
  TODAY,
  WRITE_METHODS,
  fakeLogger,
  fakeServices,
  makeCtx,
  makeJob,
  makeQuery,
} from "./helpers";

beforeEach(() => {
  timeline.length = 0;
  vi.mocked(assertAllowed).mockClear();
});

/** Valid input for every tool, so each one can be exercised. */
const SAMPLE_INPUT: Record<string, Record<string, unknown>> = {
  list_profiles: {},
  list_queries: { profile_id: PROFILE_ID },
  run_search: { query_id: QUERY_ID },
  score_jobs: { profile_id: PROFILE_ID },
  list_jobs: { profile_id: PROFILE_ID, filter: "to_review" },
  suggest_shortlist: { profile_id: PROFILE_ID },
  tracker_summary: {},
  follow_ups: {},
  mark_applied: { job_id: JOB_ID, person_said: "I applied to Harbor Labs" },
  draft_note: { kind: "follow_up_email", job_id: JOB_ID },
};
const PERSON_MESSAGE = "I applied to Harbor Labs this morning";

describe("Chief tool list", () => {
  it("has exactly the expected tools", () => {
    expect(CHIEF_TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(SAMPLE_INPUT).sort());
    for (const t of CHIEF_TOOLS) expect(t.definition.name).toBe(t.name);
  });

  it("maps no tool to a forbidden action, and every action is on the allow-list", () => {
    for (const t of CHIEF_TOOLS) {
      if (t.action === null) continue;
      expect(FORBIDDEN_ACTIONS as readonly string[]).not.toContain(t.action);
      expect(ALLOWED_ACTIONS as readonly string[]).toContain(t.action);
    }
  });

  it("has no tool that applies, uses Easy Apply, sends, messages, logs in, deletes, or decides", () => {
    const banned = /submit|apply(?!_)|easy|send|email|message|recruiter|login|log_in|cookie|delete|keep|skip|decid/i;
    for (const t of CHIEF_TOOLS) {
      expect(t.name).not.toMatch(banned);
      expect(FORBIDDEN_ACTIONS as readonly string[]).not.toContain(t.name);
    }
  });

  it("gives the right gate to each tool with side effects", () => {
    const actions = Object.fromEntries(CHIEF_TOOLS.map((t) => [t.name, t.action]));
    expect(actions).toEqual({
      list_profiles: null,
      list_queries: null,
      run_search: "search",
      score_jobs: "score",
      list_jobs: null,
      suggest_shortlist: "shortlist_suggest",
      tracker_summary: null,
      follow_ups: null,
      mark_applied: "track",
      draft_note: "draft",
    });
  });

  it.each(CHIEF_TOOLS.filter((t) => t.action !== null).map((t) => [t.name, t.action] as const))(
    "%s calls assertAllowed(%s) before touching any service",
    async (name, action) => {
      const order = timeline;
      const services = fakeServices(order);
      const { logger, records } = fakeLogger();
      const result = await runTool({ name, input: SAMPLE_INPUT[name] }, makeCtx(services, PERSON_MESSAGE), logger);
      expect(result.isError).toBe(false);
      expect(order[0]).toBe(`gate:${action}`);
      expect(order.length).toBeGreaterThan(1);
      expect(records[0]).toMatchObject({ tool: name, action, ok: true });
    },
  );

  it("read-only tools never call a write service", async () => {
    for (const t of CHIEF_TOOLS.filter((t) => t.action === null || t.action === "shortlist_suggest" || t.action === "draft")) {
      const services = fakeServices();
      await runTool({ name: t.name, input: SAMPLE_INPUT[t.name] }, makeCtx(services), fakeLogger().logger);
      for (const m of WRITE_METHODS) expect(services[m]).not.toHaveBeenCalled();
    }
  });

  it("a gate refusal stops the tool before any service runs", async () => {
    const services = fakeServices();
    vi.mocked(assertAllowed).mockImplementationOnce(() => {
      throw new Error('Action "track" is forbidden for agents.');
    });
    const result = await runTool(
      { name: "mark_applied", input: SAMPLE_INPUT.mark_applied },
      makeCtx(services, PERSON_MESSAGE),
      fakeLogger().logger,
    );
    expect(result.isError).toBe(true);
    expect(services.markApplied).not.toHaveBeenCalled();
  });
});

describe("run_search", () => {
  it("refuses a retired query and explains why", async () => {
    const services = fakeServices([], { getQuery: vi.fn(async () => makeQuery({ retired: true })) });
    const result = await runTool({ name: "run_search", input: { query_id: QUERY_ID } }, makeCtx(services), fakeLogger().logger);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/retired/i);
    expect(services.runSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["indeed", "Indeed"],
    ["ziprecruiter", "ZipRecruiter"],
  ] as const)("refuses %s queries as import only", async (source, label) => {
    const services = fakeServices([], { getQuery: vi.fn(async () => makeQuery({ source })) });
    const result = await runTool({ name: "run_search", input: { query_id: QUERY_ID } }, makeCtx(services), fakeLogger().logger);
    expect(result.isError).toBe(true);
    expect(result.content).toContain(`${label} is import only`);
    expect(services.runSearch).not.toHaveBeenCalled();
  });

  it("rejects input that is not a query id", async () => {
    const services = fakeServices();
    const result = await runTool({ name: "run_search", input: { query_id: "nope" } }, makeCtx(services), fakeLogger().logger);
    expect(result.isError).toBe(true);
    expect(services.getQuery).not.toHaveBeenCalled();
  });
});

describe("mark_applied", () => {
  it("is refused when person_said is empty", async () => {
    const services = fakeServices();
    const result = await runTool(
      { name: "mark_applied", input: { job_id: JOB_ID, person_said: "   " } },
      makeCtx(services, PERSON_MESSAGE),
      fakeLogger().logger,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/person_said is empty/);
    expect(services.markApplied).not.toHaveBeenCalled();
  });

  it("is refused when person_said is missing", async () => {
    const services = fakeServices();
    const result = await runTool(
      { name: "mark_applied", input: { job_id: JOB_ID } },
      makeCtx(services, PERSON_MESSAGE),
      fakeLogger().logger,
    );
    expect(result.isError).toBe(true);
    expect(services.markApplied).not.toHaveBeenCalled();
  });

  it("is refused when person_said is not in the person's message", async () => {
    const services = fakeServices();
    const result = await runTool(
      { name: "mark_applied", input: { job_id: JOB_ID, person_said: "I applied" } },
      makeCtx(services, "Apply to this job for me"),
      fakeLogger().logger,
    );
    expect(result.isError).toBe(true);
    expect(services.markApplied).not.toHaveBeenCalled();
  });

  it("records the application with company, title, date, and link", async () => {
    const services = fakeServices();
    const result = await runTool(
      { name: "mark_applied", input: { job_id: JOB_ID, person_said: "i applied to harbor labs", date: "2026-10-25" } },
      makeCtx(services, PERSON_MESSAGE),
      fakeLogger().logger,
    );
    expect(result.isError).toBe(false);
    expect(services.markApplied).toHaveBeenCalledWith(JOB_ID, "2026-10-25", TODAY);
    expect(JSON.parse(result.content)).toMatchObject({
      recorded: true,
      company: "Harbor Labs",
      title: "Laboratory Director",
      url: "https://example.com/jobs/1",
    });
  });

  it("refuses a future date", async () => {
    const services = fakeServices();
    const result = await runTool(
      { name: "mark_applied", input: { ...SAMPLE_INPUT.mark_applied, date: "2026-12-01" } },
      makeCtx(services, PERSON_MESSAGE),
      fakeLogger().logger,
    );
    expect(result.isError).toBe(true);
    expect(services.markApplied).not.toHaveBeenCalled();
  });

  it("matches quotes regardless of case, spacing, and curly quotes", () => {
    expect(isQuoteFromMessage("I’ve applied", "Good news: I've   applied there!")).toBe(true);
    expect(isQuoteFromMessage("ok", "ok")).toBe(false);
  });
});

describe("suggest_shortlist and draft_note", () => {
  it("returns suggestions only, skipping deal-breakers", async () => {
    const services = fakeServices([], {
      listJobs: vi.fn(async () => [makeJob(), makeJob({ id: "x", deal_breaker: "Night shift" })]),
    });
    const ctx = makeCtx(services);
    const result = await runTool({ name: "suggest_shortlist", input: { profile_id: PROFILE_ID } }, ctx, fakeLogger().logger);
    const body = JSON.parse(result.content);
    expect(body.suggestions).toHaveLength(1);
    expect(body.note).toMatch(/Nothing was kept or skipped/);
    expect(services.listJobs).toHaveBeenCalledWith(PROFILE_ID, "to_review", 7);
    expect(ctx.collected.jobs.map((j) => j.id)).toEqual([makeJob().id]);
  });

  it("returns a labeled draft that was not sent", async () => {
    const ctx = makeCtx(fakeServices());
    const result = await runTool(
      { name: "draft_note", input: { kind: "follow_up_email", job_id: JOB_ID } },
      ctx,
      fakeLogger().logger,
    );
    const body = JSON.parse(result.content);
    expect(body.label).toMatch(/^Draft/);
    expect(body.sent).toBe(false);
    expect(body.text).toContain("Laboratory Director role at Harbor Labs on Oct 20, 2026");
    expect(ctx.collected.drafts).toHaveLength(1);
  });
});

describe("unknown tools", () => {
  it.each(FORBIDDEN_ACTIONS.map((a) => [a]))("a call to %s is a tool error and logs nothing as a side effect", async (name) => {
    const services = fakeServices();
    const { logger, records } = fakeLogger();
    const result = await runTool({ name, input: {} }, makeCtx(services), logger);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no tool named/);
    expect(records[0]).toMatchObject({ tool: name, action: null, ok: false });
    for (const m of Object.keys(services) as (keyof typeof services)[]) expect(services[m]).not.toHaveBeenCalled();
  });
});

describe("system prompt", () => {
  it("includes the hard gates verbatim and the career facts rule", () => {
    expect(CHIEF_SYSTEM_PROMPT).toContain(HARD_GATES);
    expect(CHIEF_SYSTEM_PROMPT).toContain(
      "Use only the person's career facts; never invent experience, numbers, titles, or dates.",
    );
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/Easy Apply status as Yes, No, or Unknown/);
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/Unmet must-have:/);
  });

  it("is frozen text with no dates, so it caches", () => {
    expect(CHIEF_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
