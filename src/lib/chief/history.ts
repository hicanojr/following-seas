/**
 * Chat history in chat_messages (supabase/migrations/0005_chief.sql). Uses
 * the request's Supabase client, so Row Level Security limits every read and
 * write to the signed-in person. History is append-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTurn, ChiefDraft, ChiefJob } from "./types";

export interface StoredMessage extends ChatTurn {
  id: string;
  jobs: ChiefJob[];
  drafts: ChiefDraft[];
  created_at: string;
}

const LOAD_LIMIT = 60;

function attachments(value: unknown): { jobs: ChiefJob[]; drafts: ChiefDraft[] } {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    jobs: Array.isArray(v.jobs) ? (v.jobs as ChiefJob[]) : [],
    drafts: Array.isArray(v.drafts) ? (v.drafts as ChiefDraft[]) : [],
  };
}

/** Messages in one conversation, oldest first. */
export async function loadConversation(supabase: SupabaseClient, conversationId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, attachments, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(LOAD_LIMIT);
  if (error) throw new Error(`Could not load the conversation: ${error.message}`);
  return (data ?? [])
    .reverse()
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({
      id: String(r.id),
      role: r.role as ChatTurn["role"],
      content: String(r.content ?? ""),
      created_at: String(r.created_at),
      ...attachments(r.attachments),
    }));
}

/** The person's most recent conversation id, or null. */
export async function latestConversationId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("conversation_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load chat history: ${error.message}`);
  return data ? String(data.conversation_id) : null;
}

export async function appendMessage(
  supabase: SupabaseClient,
  entry: { userId: string; conversationId: string; role: ChatTurn["role"]; content: string; jobs?: ChiefJob[]; drafts?: ChiefDraft[] },
): Promise<void> {
  const { error } = await supabase.from("chat_messages").insert({
    user_id: entry.userId,
    conversation_id: entry.conversationId,
    role: entry.role,
    content: entry.content,
    attachments: { jobs: entry.jobs ?? [], drafts: entry.drafts ?? [] },
  });
  if (error) console.error("chat_messages insert failed", error.message);
}
