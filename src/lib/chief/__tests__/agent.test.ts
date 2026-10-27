import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_ROUNDS, buildRequest, runChief } from "../agent";
import { CHIEF_SYSTEM_PROMPT } from "../prompt";
import {
  JOB_ID,
  QUERY_ID,
  TODAY,
  WRITE_METHODS,
  fakeClient,
  fakeLogger,
  fakeServices,
  message,
  text,
  toolResults,
  toolUse,
} from "./helpers";

const input = (msg: string) => ({ userId: "user-1", message: msg, today: TODAY });

describe("runChief", () => {
  it("runs a search through the tool loop and logs the call", async () => {
    const { client, requests } = fakeClient([
      toolUse("run_search", { query_id: QUERY_ID }),
      text("Ran your LinkedIn search: 12 new jobs, 15 duplicates, 3 noise."),
    ]);
    const services = fakeServices();
    const { logger, records } = fakeLogger();

    const out = await runChief(input("Run my best searches"), { client, services, logger });

    expect(out.stopped).toBe("done");
    expect(out.reply).toContain("12 new jobs");
    expect(services.runSearch).toHaveBeenCalledWith(QUERY_ID);
    expect(out.toolCalls).toEqual([{ name: "run_search", ok: true }]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tool: "run_search", action: "search", ok: true });

    // Second request carries the assistant tool_use turn and one tool_result.
    expect(requests).toHaveLength(2);
    const results = toolResults(requests[1]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_run_search" });
    expect(results[0].is_error).toBeUndefined();
    expect(JSON.parse(results[0].content)).toMatchObject({ imported: 12, source: "linkedin" });
  });

  it('refuses "apply to this job for me" with no write', async () => {
    const { client, requests } = fakeClient([
      text(
        "I can't apply for you; you always apply yourself. Here is the link: https://example.com/jobs/1 (Easy Apply: No). Tell me when you've applied and I'll add it to your tracker.",
      ),
    ]);
    const services = fakeServices();
    const { logger, records } = fakeLogger();

    const out = await runChief(input("Apply to this job for me"), { client, services, logger });

    expect(out.reply).toMatch(/can't apply/);
    expect(out.toolCalls).toEqual([]);
    expect(records).toEqual([]);
    for (const m of WRITE_METHODS) expect(services[m]).not.toHaveBeenCalled();
    // The model was offered no tool that could apply, send, or log in.
    const names = (requests[0].tools as { name: string }[]).map((t) => t.name);
    expect(names.some((n) => /apply|submit|send|email|message|login/.test(n))).toBe(false);
  });

  it("turns an attempt to call a forbidden tool into a tool error, with no write", async () => {
    const { client, requests } = fakeClient([
      toolUse("submit_application", { job_id: JOB_ID }),
      text("I can't submit applications. You apply yourself."),
    ]);
    const services = fakeServices();
    const { logger, records } = fakeLogger();

    const out = await runChief(input("Apply to this job for me"), { client, services, logger });

    expect(out.toolCalls).toEqual([{ name: "submit_application", ok: false }]);
    expect(toolResults(requests[1])[0]).toMatchObject({ is_error: true });
    expect(records[0]).toMatchObject({ action: null, ok: false });
    for (const m of WRITE_METHODS) expect(services[m]).not.toHaveBeenCalled();
  });

  it("does not let the model mark a job applied when the person asked it to apply", async () => {
    const { client, requests } = fakeClient([
      toolUse("mark_applied", { job_id: JOB_ID, person_said: "" }),
      text("I can't apply for you. Tell me once you have applied."),
    ]);
    const services = fakeServices();
    const out = await runChief(input("Apply to this job for me"), { client, services, logger: fakeLogger().logger });

    expect(services.markApplied).not.toHaveBeenCalled();
    const result = toolResults(requests[1])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/person_said is empty/);
    expect(out.toolCalls).toEqual([{ name: "mark_applied", ok: false }]);
  });

  it("marks applied when the person says so, quoting them", async () => {
    const { client } = fakeClient([
      toolUse("mark_applied", { job_id: JOB_ID, person_said: "I applied to the Harbor Labs director job" }),
      text("Added to your list: Harbor Labs, Laboratory Director, Oct 26, 2026, https://example.com/jobs/1."),
    ]);
    const services = fakeServices();
    const { logger, records } = fakeLogger();
    await runChief(input("I applied to the Harbor Labs director job today"), { client, services, logger });

    expect(services.markApplied).toHaveBeenCalledWith(JOB_ID, TODAY, TODAY);
    expect(records[0]).toMatchObject({ tool: "mark_applied", action: "track", ok: true });
  });

  it("returns service errors to the model as tool errors", async () => {
    const { client, requests } = fakeClient([
      toolUse("score_jobs", { profile_id: "11111111-1111-4111-8111-111111111111" }),
      text("Scoring failed: the database was unavailable."),
    ]);
    const services = fakeServices([], {
      scoreJobs: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const out = await runChief(input("Score my jobs"), { client, services, logger: fakeLogger().logger });
    expect(toolResults(requests[1])[0]).toMatchObject({ is_error: true, content: "That did not work: database unavailable" });
    expect(out.stopped).toBe("done");
  });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds`, async () => {
    const responses = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, (_, i) =>
      toolUse("tracker_summary", {}, `toolu_${i}`),
    );
    const { client, create } = fakeClient(responses);
    const services = fakeServices();
    const out = await runChief(input("Loop forever"), { client, services, logger: fakeLogger().logger });

    expect(out.stopped).toBe("max_rounds");
    expect(services.trackerSummary).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
  });

  it("returns a timeout reply when the request takes too long", async () => {
    const create = vi.fn(
      (_params: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const client = { beta: { messages: { create } } } as never;
    const out = await runChief(input("What is new today?"), {
      client,
      services: fakeServices(),
      logger: fakeLogger().logger,
      timeoutMs: 20,
    });
    expect(out.stopped).toBe("timeout");
    expect(out.reply).toMatch(/ran out of time/);
  });

  it("handles a refusal stop reason without running tools", async () => {
    const { client } = fakeClient([message([], "refusal")]);
    const services = fakeServices();
    const out = await runChief(input("something"), { client, services, logger: fakeLogger().logger });
    expect(out.stopped).toBe("refusal");
    for (const m of WRITE_METHODS) expect(services[m]).not.toHaveBeenCalled();
  });

  it("collects job cards from list_jobs for the UI", async () => {
    const { client } = fakeClient([
      toolUse("list_jobs", { profile_id: "11111111-1111-4111-8111-111111111111", filter: "to_review" }),
      text("One new job to review."),
    ]);
    const out = await runChief(input("What is new today?"), {
      client,
      services: fakeServices(),
      logger: fakeLogger().logger,
    });
    expect(out.jobs).toHaveLength(1);
    expect(out.jobs[0]).toMatchObject({ easy_apply: "No", url: "https://example.com/jobs/1" });
  });

  it("sends prior turns first, starting with the person, and today's date only in the user turn", async () => {
    const { client, requests } = fakeClient([text("Hi.")]);
    await runChief(
      {
        ...input("Any follow-ups due?"),
        history: [
          { role: "assistant", content: "orphan" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hello. How can I help?" },
        ],
      },
      { client, services: fakeServices(), logger: fakeLogger().logger },
    );
    const msgs = requests[0].messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[2].content).toContain(`Today is ${TODAY}`);
    expect(msgs[2].content).toContain("Any follow-ups due?");
  });
});

describe("buildRequest", () => {
  it("uses the configured model, a cached system prompt, auto tool choice, and fallbacks", () => {
    const req = buildRequest("claude-opus-5-5", [{ role: "user", content: "hi" }]);
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.tool_choice).toEqual({ type: "auto" });
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.system).toEqual([{ type: "text", text: CHIEF_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    expect(req).not.toHaveProperty("thinking");
  });
});
