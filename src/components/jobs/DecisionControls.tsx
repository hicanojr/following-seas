"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { NOTE_MAX, SKIP_REASONS, type SkipReason } from "@/lib/shortlist/reasons";

export interface CurrentDecision {
  decision: "keep" | "skip";
  reason: string | null;
}

type Mode = "idle" | "keep" | "skip";

async function postJson(url: string, payload: unknown): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; text: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (res.redirected || !isJson) return { ok: false, text: "Your session has ended. Sign in again." };
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const text = typeof body.message === "string" ? body.message : "That did not save. Try again.";
      return { ok: false, text };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, text: "Could not reach the server. Check your connection and try again." };
  }
}

const buttonBase = "rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50";
const primary = `${buttonBase} bg-navy text-white shadow-sm dark:bg-brass dark:text-navy`;
const secondary = `${buttonBase} border border-line text-foreground hover:bg-background`;

/**
 * Keep or Skip for one job under one profile. The person decides; nothing here
 * applies anywhere. Save to tracker only adds a "saved" row to the tracker.
 */
export function DecisionControls({
  jobId,
  profileId,
  current,
  trackerStatus,
}: {
  jobId: string;
  profileId: string;
  current: CurrentDecision | null;
  trackerStatus: string | null;
}) {
  const router = useRouter();
  const ids = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [chip, setChip] = useState<SkipReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [refreshing, startTransition] = useTransition();
  const working = busy || refreshing;

  function open(next: Mode) {
    setMessage(null);
    setChip(null);
    setNote("");
    setMode(next);
  }

  async function save(decision: "keep" | "skip") {
    if (decision === "skip" && !chip && !note.trim()) {
      setMessage({ tone: "error", text: "Pick a reason or write one." });
      return;
    }
    setBusy(true);
    const result = await postJson("/api/decisions", {
      jobId,
      profileId,
      decision,
      chip: decision === "skip" ? chip : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.text });
      return;
    }
    setMode("idle");
    setMessage({ tone: "ok", text: decision === "keep" ? "Kept." : "Skipped." });
    startTransition(() => router.refresh());
  }

  async function saveToTracker() {
    setBusy(true);
    const result = await postJson("/api/decisions/tracker", { jobId });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.text });
      return;
    }
    setMessage({
      tone: "ok",
      text: result.body.created ? "Saved to your tracker. You apply yourself when ready." : "Already in your tracker.",
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      {current && mode === "idle" ? (
        <p className="text-sm">
          <span className="font-medium">{current.decision === "keep" ? "Kept" : "Skipped"}</span>
          {current.reason ? <span className="text-muted"> · {current.reason}</span> : null}
        </p>
      ) : null}

      {mode === "idle" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {current?.decision !== "keep" ? (
            <button type="button" className={primary} disabled={working} onClick={() => open("keep")}>
              {current ? "Change to keep" : "Keep"}
            </button>
          ) : null}
          {current?.decision !== "skip" ? (
            <button type="button" className={secondary} disabled={working} onClick={() => open("skip")}>
              {current ? "Change to skip" : "Skip"}
            </button>
          ) : null}
          {current?.decision === "keep" ? (
            trackerStatus ? (
              <span className="self-center text-sm text-muted">In tracker: {trackerStatus}</span>
            ) : (
              <button type="button" className={secondary} disabled={working} onClick={saveToTracker}>
                Save to tracker
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {mode === "keep" ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={`${ids}-keep-note`} className="block text-sm font-medium">
            Note <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={`${ids}-keep-note`}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm"
            placeholder="Why it is worth a look"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={working} onClick={() => save("keep")}>
              {working ? "Saving..." : "Save keep"}
            </button>
            <button type="button" className={secondary} disabled={working} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === "skip" ? (
        <fieldset className="mt-2 space-y-2">
          <legend className="text-sm font-medium">Why skip?</legend>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => {
              const selected = chip === r;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setChip(selected ? null : r)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    selected ? "border-foreground bg-foreground text-background" : "border-line text-muted hover:text-foreground"
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <label htmlFor={`${ids}-skip-note`} className="sr-only">
            Reason in your words
          </label>
          <input
            id={`${ids}-skip-note`}
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm"
            placeholder={chip === "Other" ? "Say what it was" : "Add detail (optional)"}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={working} onClick={() => save("skip")}>
              {working ? "Saving..." : "Save skip"}
            </button>
            <button type="button" className={secondary} disabled={working} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </fieldset>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={`mt-2 text-xs ${message?.tone === "error" ? "text-red-800 dark:text-red-300" : "text-muted"}`}
      >
        {message?.text ?? ""}
      </p>
    </div>
  );
}
