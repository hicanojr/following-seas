"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { safeHttpUrl } from "@/components/jobs/JobCard";
import type { ChiefDraft, ChiefJob } from "@/lib/chief/types";
import { localIsoDate } from "@/lib/tracker/dates";
import { ChiefJobCard } from "./ChiefJobCard";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  jobs?: ChiefJob[];
  drafts?: ChiefDraft[];
  error?: boolean;
}

const CHIPS = [
  { label: "What is new today?", send: true },
  { label: "Run my best searches", send: true },
  { label: "Any follow-ups due?", send: true },
  { label: "I applied to ...", send: false, fill: "I applied to " },
] as const;

let counter = 0;
const localId = () => `local-${Date.now()}-${counter++}`;

export function ChiefChat({
  configured,
  initialConversationId,
  initialMessages,
}: {
  configured: boolean;
  initialConversationId: string | null;
  initialMessages: UiMessage[];
}) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending || !configured) return;
    setMessages((m) => [...m, { id: localId(), role: "user", content: message }]);
    setDraft("");
    setPending(true);
    try {
      const res = await fetch("/api/chief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversationId: conversationId ?? undefined, today: localIsoDate() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        conversationId?: string;
        reply?: string;
        jobs?: ChiefJob[];
        drafts?: ChiefDraft[];
        message?: string;
      };
      if (!res.ok) {
        const fallback = res.status === 401 ? "You are signed out. Sign in again to continue." : "Something went wrong. Try again.";
        setMessages((m) => [...m, { id: localId(), role: "assistant", content: body.message ?? fallback, error: true }]);
        return;
      }
      if (body.conversationId) setConversationId(body.conversationId);
      setMessages((m) => [
        ...m,
        { id: localId(), role: "assistant", content: body.reply ?? "", jobs: body.jobs ?? [], drafts: body.drafts ?? [] },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: localId(), role: "assistant", content: "Could not reach the server. Check your connection and try again.", error: true },
      ]);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onChip(chip: (typeof CHIPS)[number]) {
    if (chip.send) {
      void send(chip.label);
    } else {
      setDraft(chip.fill);
      inputRef.current?.focus();
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
  }

  return (
    <div className="pb-36">
      {!configured ? (
        <p className="mb-4 rounded-xl border border-line bg-card p-4 text-sm text-muted">
          The Chief of Staff is not set up yet: ANTHROPIC_API_KEY is missing on the server.
        </p>
      ) : null}

      {messages.length === 0 ? (
        <section className="rounded-2xl border border-line bg-card p-5 text-sm leading-relaxed text-muted shadow-sm">
          <div className="mb-3 h-px w-12 bg-brass" aria-hidden />
          <p>
            Ask in plain words. The Chief of Staff runs your searches, scores jobs, suggests a shortlist, and keeps your
            tracker current.
          </p>
          <p className="mt-2">
            It never applies for you, never uses Easy Apply, and never sends email or messages. You apply yourself, then
            tell it &ldquo;I applied&rdquo; and it adds the job to your list.
          </p>
        </section>
      ) : (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={newConversation}
            disabled={pending}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
          >
            New conversation
          </button>
        </div>
      )}

      <ol className="mt-4 space-y-4" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy px-4 py-2 text-sm text-white dark:bg-accent dark:text-navy">
                {m.content}
              </p>
            ) : (
              <div className="space-y-3">
                <div
                  className={`rounded-2xl rounded-bl-sm border px-4 py-3 text-sm leading-relaxed ${
                    m.error ? "border-red-700/30 bg-red-700/5" : "border-line bg-card"
                  }`}
                >
                  <RichText text={m.content} />
                </div>
                {m.jobs && m.jobs.length > 0 ? (
                  <div className="space-y-2">
                    {m.jobs.map((job) => (
                      <ChiefJobCard key={job.id} job={job} />
                    ))}
                  </div>
                ) : null}
                {m.drafts?.map((d, i) => <DraftCard key={`${d.jobId}-${d.kind}-${i}`} draft={d} />)}
              </div>
            )}
          </li>
        ))}
        {pending ? (
          <li className="text-sm text-muted" role="status">
            Working on it...
          </li>
        ) : null}
      </ol>
      <div ref={endRef} />

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-line bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 pt-2 pb-3">
          <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
            {CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => onChip(chip)}
                disabled={pending || !configured}
                className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-foreground hover:border-brass disabled:opacity-50"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <label htmlFor="chief-input" className="sr-only">
              Message the Chief of Staff
            </label>
            <textarea
              id="chief-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="Ask your Chief of Staff"
              disabled={!configured}
              className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-line bg-card px-4 py-2.5 text-base outline-none focus:border-brass"
            />
            <button
              type="submit"
              disabled={pending || !configured || !draft.trim()}
              className="h-11 shrink-0 rounded-full bg-navy px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-accent dark:text-navy"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DraftCard({ draft }: { draft: ChiefDraft }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="rounded-xl border border-brass/60 bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{draft.label}</h3>
        <span className="text-xs text-muted">Not sent</span>
      </div>
      <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed">{draft.text}</pre>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-xs text-muted">Review and edit, then send it yourself.</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft.text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="rounded-full border border-line px-3 py-1 text-xs hover:border-brass"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s)<>\]]+)/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;

/** Plain text with safe links, **bold**, and simple bullet lists. No HTML is ever injected. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-1 list-disc space-y-1 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>
              <Inline text={b} />
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="my-1">
          <Inline text={line.replace(/^#+\s*/, "")} />
        </p>,
      );
    }
  }
  flush();
  return <>{blocks}</>;
}

function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  text.split(URL_PATTERN).forEach((part, i) => {
    if (i % 2 === 1) {
      const trimmed = part.replace(/[.,;:]+$/, "");
      const href = safeHttpUrl(trimmed);
      parts.push(
        href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline underline-offset-4">
            {trimmed}
          </a>
        ) : (
          trimmed
        ),
      );
      if (trimmed !== part) parts.push(part.slice(trimmed.length));
      return;
    }
    part.split(BOLD_PATTERN).forEach((piece, j) => {
      parts.push(j % 2 === 1 ? <strong key={`${i}-${j}`}>{piece}</strong> : piece);
    });
  });
  return <>{parts}</>;
}
