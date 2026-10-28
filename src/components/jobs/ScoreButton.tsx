"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Status = { kind: "idle" } | { kind: "working" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/** Asks the Scoring agent to score this profile's unscored jobs. It never applies anywhere. */
export function ScoreButton({ profileId, disabled }: { profileId: string; disabled?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [refreshing, startTransition] = useTransition();
  const busy = status.kind === "working" || refreshing;

  async function score() {
    setStatus({ kind: "working" });
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const isJson = res.headers.get("content-type")?.includes("application/json");
      if (res.redirected || !isJson) {
        setStatus({ kind: "error", text: "Your session has ended. Sign in again to score jobs." });
        return;
      }
      const body = (await res.json()) as {
        error?: string;
        scored?: number;
        screenedOut?: number;
        prefiltered?: number;
        awaitingEmbedding?: number;
        failed?: unknown[];
      };
      if (!res.ok) {
        setStatus({ kind: "error", text: body.error ?? "Scoring failed. Try again shortly." });
        return;
      }
      const scored = body.scored ?? 0;
      const failed = body.failed?.length ?? 0;
      const parts = [scored === 0 ? "No new jobs to score." : `Scored ${scored} job${scored === 1 ? "" : "s"}.`];
      if (body.screenedOut) parts.push(`${body.screenedOut} screened out.`);
      if (body.prefiltered) parts.push(`${body.prefiltered} held back. Only the closest postings are scored.`);
      if (body.awaitingEmbedding) parts.push(`${body.awaitingEmbedding} waiting on an embedding.`);
      if (failed) parts.push(`${failed} could not be scored.`);
      setStatus({ kind: "done", text: parts.join(" ") });
      startTransition(() => router.refresh());
    } catch {
      setStatus({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={score}
        disabled={busy || disabled}
        className="rounded-full bg-navy px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 dark:bg-brass dark:text-navy"
      >
        {busy ? "Scoring..." : "Score new jobs"}
      </button>
      <p role="status" aria-live="polite" className="text-xs text-muted">
        {status.kind === "done" || status.kind === "error" ? status.text : ""}
      </p>
    </div>
  );
}
