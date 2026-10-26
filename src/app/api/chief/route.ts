import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runChief } from "@/lib/chief/agent";
import { chiefModel, createChiefClient, isChiefConfigured } from "@/lib/chief/client";
import { appendMessage, loadConversation } from "@/lib/chief/history";
import { supabaseChiefLogger, supabaseChiefServices } from "@/lib/chief/services";
import type { ChatTurn } from "@/lib/chief/types";
import { jsonError, requireUser } from "@/lib/shortlist/server";
import { isIsoDate, localIsoDate } from "@/lib/tracker/dates";

export const maxDuration = 60;

const BodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.uuid().optional(),
  /** The person's local date, so "today" matches their calendar. */
  today: z.string().optional(),
});

/**
 * POST /api/chief { message, conversationId?, today? }
 * One chat turn with the Chief of Staff. Returns { conversationId, reply, jobs, drafts, toolCalls, stopped }.
 * 401 when signed out, 503 when ANTHROPIC_API_KEY (or Supabase) is not configured.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { supabase, user } = auth;

  const client = isChiefConfigured() ? createChiefClient() : null;
  if (!client) {
    return jsonError(503, "missing_config", "The Chief of Staff is not set up yet: ANTHROPIC_API_KEY is missing on the server.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_input", "Send a JSON body with message.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "bad_input", "message must be text up to 4000 characters; conversationId, if sent, an id.");
  }
  const { message } = parsed.data;
  const today = isIsoDate(parsed.data.today) ? parsed.data.today : localIsoDate();
  const conversationId = parsed.data.conversationId ?? crypto.randomUUID();

  let history: ChatTurn[] = [];
  if (parsed.data.conversationId) {
    try {
      history = (await loadConversation(supabase, conversationId)).map(({ role, content }) => ({ role, content }));
    } catch (err) {
      console.error("chief history load failed", err);
    }
  }

  await appendMessage(supabase, { userId: user.id, conversationId, role: "user", content: message });

  try {
    const result = await runChief(
      { userId: user.id, message, today, history },
      {
        client,
        model: chiefModel(),
        services: supabaseChiefServices(supabase, user.id),
        logger: supabaseChiefLogger(supabase, user.id),
      },
    );
    await appendMessage(supabase, {
      userId: user.id,
      conversationId,
      role: "assistant",
      content: result.reply,
      jobs: result.jobs,
      drafts: result.drafts,
    });
    return NextResponse.json({ conversationId, ...result });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError(429, "rate_limited", "The Chief of Staff is busy right now. Try again in a minute.");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return jsonError(503, "missing_config", "The Chief of Staff's API key was rejected. Check ANTHROPIC_API_KEY.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("chief model error", err.status, err.message);
      return jsonError(502, "upstream", "The Chief of Staff could not answer just now. Try again shortly.");
    }
    console.error("chief route error", err);
    return jsonError(500, "server_error", "Something went wrong. Try again.");
  }
}
