import { vi } from "vitest";
import type { ChiefClient } from "../agent";
import type { ToolContext } from "../tools";
import type { ChiefJob, ChiefLogger, ChiefServices, QuerySummary, ToolCallRecord } from "../types";

export const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
export const QUERY_ID = "22222222-2222-4222-8222-222222222222";
export const JOB_ID = "33333333-3333-4333-8333-333333333333";
export const TODAY = "2026-10-26";

export function makeQuery(overrides: Partial<QuerySummary> = {}): QuerySummary {
  return {
    id: QUERY_ID,
    profile_id: PROFILE_ID,
    source: "linkedin",
    query_text: "laboratory director",
    quality: "good",
    retired: false,
    runs: 3,
    last_run_at: null,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<ChiefJob> = {}): ChiefJob {
  return {
    id: JOB_ID,
    title: "Laboratory Director",
    company: "Harbor Labs",
    location: "Boston, MA",
    salary: "$150,000 to $170,000",
    fit: 8,
    reason: "Administrative lab director role, pay clears the minimum.",
    gaps: [],
    unmet_must_haves: [],
    deal_breaker: null,
    easy_apply: "No",
    url: "https://example.com/jobs/1",
    ...overrides,
  };
}

/** Every service is a mock that records the order it was called in. */
export function fakeServices(order: string[] = [], overrides: Partial<ChiefServices> = {}) {
  const track = <T>(name: string, value: T) =>
    vi.fn(async () => {
      order.push(`service:${name}`);
      return value;
    });
  const services: ChiefServices = {
    listProfiles: track("listProfiles", []),
    listQueries: track("listQueries", [makeQuery()]),
    getQuery: track("getQuery", makeQuery()),
    runSearch: track("runSearch", { source: "linkedin" as const, received: 30, imported: 12, duplicates: 15, noise: 3 }),
    scoreJobs: track("scoreJobs", { scored: 12, screenedOut: 2, failed: 0 }),
    listJobs: track("listJobs", [makeJob()]),
    trackerSummary: track("trackerSummary", {
      counts: { saved: 1, applied: 2, interview: 0, offer: 0, closed: 0 },
      recentlyApplied: [],
    }),
    followUps: track("followUps", { overdue: [], dueToday: [], upcoming: [] }),
    getJobForDraft: track("getJobForDraft", {
      id: JOB_ID,
      title: "Laboratory Director",
      company: "Harbor Labs",
      url: "https://example.com/jobs/1",
      application: { status: "applied" as const, applied_on: "2026-10-20" },
    }),
    markApplied: track("markApplied", {
      company: "Harbor Labs",
      title: "Laboratory Director",
      applied_on: TODAY,
      url: "https://example.com/jobs/1",
    }),
    ...overrides,
  };
  return services;
}

export const WRITE_METHODS: (keyof ChiefServices)[] = ["runSearch", "scoreJobs", "markApplied"];

export function fakeLogger() {
  const records: ToolCallRecord[] = [];
  const logger: ChiefLogger = {
    toolCall: vi.fn(async (r: ToolCallRecord) => {
      records.push(r);
    }),
  };
  return { logger, records };
}

export function makeCtx(services: ChiefServices, personMessage = "hello"): ToolContext {
  return { services, userId: "user-1", today: TODAY, personMessage, collected: { jobs: [], drafts: [] } };
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export function message(content: Block[], stop_reason: string) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

export const text = (t: string, stop = "end_turn") => message([{ type: "text", text: t }], stop);
export const toolUse = (name: string, input: unknown, id = `toolu_${name}`) =>
  message([{ type: "tool_use", id, name, input }], "tool_use");

/** A fake Anthropic client that replays scripted responses and records each request. */
export function fakeClient(responses: unknown[]) {
  const requests: { messages: unknown[]; [k: string]: unknown }[] = [];
  const queue = [...responses];
  const create = vi.fn(async (params: { messages: unknown[] }) => {
    requests.push(structuredClone(params) as { messages: unknown[] });
    const next = queue.shift();
    if (!next) throw new Error("fake client ran out of responses");
    return next;
  });
  const client = { beta: { messages: { create } } } as unknown as ChiefClient;
  return { client, create, requests };
}

/** The tool_result blocks in the last user message of a request. */
export function toolResults(request: { messages: unknown[] }) {
  const last = request.messages[request.messages.length - 1] as { content: unknown };
  return (Array.isArray(last.content) ? last.content : []) as {
    type: string;
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }[];
}
