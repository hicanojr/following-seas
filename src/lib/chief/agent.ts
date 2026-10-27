/**
 * The Chief of Staff agent loop.
 *
 * One chat turn: send the history and the person's message, run the tools
 * the model asks for, return their results (errors as tool errors), and
 * repeat until the model answers, at most MAX_TOOL_ROUNDS times, within a
 * per-request time limit. The client, services, and logger are injected so
 * tests can run the loop with fakes.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { GateError } from "@/lib/gates";
import { CHIEF_SYSTEM_PROMPT, DEFAULT_CHIEF_MODEL } from "./prompt";
import { findTool, toolDefinitions, ToolRefusal, type ToolContext } from "./tools";
import type { ChatTurn, ChiefLogger, ChiefReply, ChiefServices } from "./types";

export const AGENT_NAME = "chief";
export const MAX_TOOL_ROUNDS = 8;
export const DEFAULT_TIMEOUT_MS = 55_000;
/** Earlier turns sent with each request. */
export const HISTORY_LIMIT = 20;
const MAX_TOKENS = 16_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** Only the part of the SDK client the Chief uses. */
export interface ChiefClient {
  beta: {
    messages: {
      create(params: CreateParams, options?: { signal?: AbortSignal; timeout?: number }): PromiseLike<BetaMessage>;
    };
  };
}

export interface ChiefDeps {
  client: ChiefClient;
  services: ChiefServices;
  logger: ChiefLogger;
  model?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export interface ChiefInput {
  userId: string;
  message: string;
  /** The person's local date, YYYY-MM-DD. */
  today: string;
  history?: ChatTurn[];
}

const TIMEOUT_REPLY = "I ran out of time on that one. Here is what I have so far; ask again to pick up where I left off.";
const ROUNDS_REPLY = "I stopped after several steps without finishing. Try a narrower request, such as one profile or one search.";
const REFUSAL_REPLY = "I can't help with that request.";

class DeadlineError extends Error {}

function textOf(content: BetaMessage["content"]): string {
  return content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function errorText(err: unknown): string {
  if (err instanceof ToolRefusal || err instanceof GateError) return err.message;
  if (err instanceof Error) return `That did not work: ${err.message}`;
  return "That did not work.";
}

function summarize(value: unknown): unknown {
  // Keep agent_runs rows small: counts and ids, not whole job descriptions.
  const json = JSON.stringify(value ?? null);
  return json.length <= 4000 ? value : { truncated: true, preview: json.slice(0, 4000) };
}

/** The request body. Tools and system come first and never change, so they cache. */
export function buildRequest(model: string, messages: Anthropic.Beta.Messages.BetaMessageParam[]): CreateParams {
  return {
    model,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: CHIEF_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: toolDefinitions(),
    tool_choice: { type: "auto" },
    messages,
  };
}

function userTurn(message: string, today: string): string {
  return `<context>Today is ${today}.</context>\n\n${message}`;
}

export async function runChief(input: ChiefInput, deps: ChiefDeps): Promise<ChiefReply> {
  const now = deps.now ?? (() => new Date());
  const model = deps.model ?? DEFAULT_CHIEF_MODEL;
  const deadline = Date.now() + (deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));

  const ctx: ToolContext = {
    services: deps.services,
    userId: input.userId,
    today: input.today,
    personMessage: input.message,
    collected: { jobs: [], drafts: [] },
  };
  const toolCalls: ChiefReply["toolCalls"] = [];
  const partial: string[] = [];

  const history = (input.history ?? []).slice(-HISTORY_LIMIT).filter((t) => t.content.trim());
  // The first message must come from the person.
  while (history.length && history[0].role !== "user") history.shift();
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userTurn(input.message, input.today) },
  ];

  const reply = (text: string, stopped: ChiefReply["stopped"]): ChiefReply => ({
    reply: text,
    jobs: ctx.collected.jobs,
    drafts: ctx.collected.drafts,
    toolCalls,
    stopped,
  });

  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new DeadlineError();
    return ms;
  };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await deps.client.beta.messages.create(buildRequest(model, messages), {
        signal: controller.signal,
        timeout: remaining(),
      });

      const text = textOf(response.content);
      if (response.stop_reason === "refusal") return reply(text || REFUSAL_REPLY, "refusal");

      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        if (response.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: response.content });
          continue;
        }
        return reply(text || partial.join("\n").trim() || "Done.", "done");
      }
      if (text) partial.push(text);

      if (round === MAX_TOOL_ROUNDS) {
        return reply([partial.join("\n").trim(), ROUNDS_REPLY].filter(Boolean).join("\n\n"), "max_rounds");
      }

      // Append the whole assistant turn unchanged (thinking blocks included).
      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        remaining();
        const { content, isError } = await runTool(use, ctx, deps.logger, now);
        toolCalls.push({ name: use.name, ok: !isError });
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      }
      // All results go back in one user message.
      messages.push({ role: "user", content: results });
    }
    return reply(ROUNDS_REPLY, "max_rounds");
  } catch (err) {
    if (err instanceof DeadlineError || controller.signal.aborted) {
      return reply([partial.join("\n").trim(), TIMEOUT_REPLY].filter(Boolean).join("\n\n"), "timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Run one tool call. Never throws: failures become tool errors the model can explain. */
export async function runTool(
  use: { name: string; input: unknown },
  ctx: ToolContext,
  logger: ChiefLogger,
  now: () => Date = () => new Date(),
): Promise<{ content: string; isError: boolean }> {
  const startedAt = now().toISOString();
  const tool = findTool(use.name);
  let ok = false;
  let output: unknown = null;
  let error: string | null = null;

  if (!tool) {
    error = `There is no tool named "${use.name}". The Chief of Staff cannot apply, use Easy Apply, send messages, or log in anywhere.`;
  } else {
    const parsed = tool.schema.safeParse(use.input ?? {});
    if (!parsed.success) {
      error = `Bad input for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`;
    } else {
      try {
        output = await tool.run(parsed.data, ctx);
        ok = true;
      } catch (err) {
        error = errorText(err);
      }
    }
  }

  try {
    await logger.toolCall({
      tool: use.name,
      action: tool?.action ?? null,
      input: use.input ?? null,
      ok,
      output: ok ? summarize(output) : null,
      error,
      startedAt,
      finishedAt: now().toISOString(),
    });
  } catch (err) {
    console.error("chief tool log failed", err);
  }

  return ok ? { content: JSON.stringify(output), isError: false } : { content: error ?? "Failed.", isError: true };
}
