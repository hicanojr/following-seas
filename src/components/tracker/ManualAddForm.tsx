"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { addDays } from "@/lib/tracker/dates";
import { DEFAULT_FOLLOW_UP_DAYS } from "@/lib/tracker/followups";
import { callTracker } from "./api";
import { useToday } from "./useToday";

const inputClass =
  "mt-1 w-full rounded-xl border border-line bg-background px-3 py-2.5 text-base outline-none focus:border-accent";

interface AddResult {
  attachedToExisting: boolean;
}

/** Log a job the person applied to themselves that is not in the app yet. */
export function ManualAddForm() {
  const router = useRouter();
  const today = useToday();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [appliedOn, setAppliedOn] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();

  const appliedValue = appliedOn || today || "";
  const followPlaceholder = appliedValue ? addDays(appliedValue, DEFAULT_FOLLOW_UP_DAYS) : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setMessage({ kind: "error", text: "Add the job title." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await callTracker<AddResult>("/api/applications", "POST", {
      title,
      company,
      location,
      url,
      applied_on: appliedValue || null,
      follow_up_on: followUp || null,
      notes,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setMessage({
      kind: "ok",
      text: result.data.attachedToExisting
        ? "That job was already in the app, so the application was added to it."
        : "Added to your tracker.",
    });
    setTitle("");
    setCompany("");
    setLocation("");
    setUrl("");
    setAppliedOn("");
    setFollowUp("");
    setNotes("");
    startTransition(() => router.refresh());
  }

  return (
    <details className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold">Add a job you applied to</summary>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <p className="text-xs text-muted">
          For roles you found and applied to yourself outside Fair Winds. If the job is already here, the
          application is added to it.
        </p>
        <label className="block text-sm font-medium">
          Job title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Company
            <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Location
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Link to posting
          <input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Date applied
            <input type="date" value={appliedValue} onChange={(e) => setAppliedOn(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Follow up on
            <input
              type="date"
              value={followUp || followPlaceholder}
              onChange={(e) => setFollowUp(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={busy || refreshing}
          className="w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-accent dark:text-navy"
        >
          {busy ? "Saving..." : "Add to tracker"}
        </button>
        {message && (
          <p
            role="status"
            className={`text-sm ${message.kind === "error" ? "text-red-700 dark:text-red-300" : "text-muted"}`}
          >
            {message.text}
          </p>
        )}
      </form>
    </details>
  );
}
