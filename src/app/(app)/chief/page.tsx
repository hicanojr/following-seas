import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChiefChat, type UiMessage } from "@/components/chief/ChiefChat";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { isChiefConfigured } from "@/lib/chief/client";
import { latestConversationId, loadConversation } from "@/lib/chief/history";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Chief of Staff" };

export default function ChiefPage() {
  return (
    <>
      <PageHeader title="Chief of Staff" subtitle="Ask what is new, run searches, and keep your tracker current." />
      <Suspense fallback={<p className="text-sm text-muted">Loading your conversation...</p>}>
        <ChiefContent />
      </Suspense>
    </>
  );
}

async function ChiefContent() {
  const supabase = await createClient();
  if (!supabase) {
    return (
      <EmptyState heading="Not connected yet" upcoming={[]}>
        <p>Supabase is not configured on this server, so the Chief of Staff has nothing to work with yet.</p>
      </EmptyState>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <EmptyState heading="Signed out" upcoming={[]}>
        <p>
          <Link href="/login?next=/chief" className="text-accent underline underline-offset-4">
            Sign in
          </Link>{" "}
          to talk with your Chief of Staff.
        </p>
      </EmptyState>
    );
  }

  let conversationId: string | null = null;
  let messages: UiMessage[] = [];
  try {
    conversationId = await latestConversationId(supabase);
    if (conversationId) {
      messages = (await loadConversation(supabase, conversationId)).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        jobs: m.jobs,
        drafts: m.drafts,
      }));
    }
  } catch (err) {
    // History is a convenience; the chat still works without it.
    console.error("could not load chief history", err);
  }

  return (
    <ChiefChat
      configured={isChiefConfigured()}
      initialConversationId={conversationId}
      initialMessages={messages}
    />
  );
}
