"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { addDays, daysBetween, formatDate } from "@/lib/tracker/dates";
import { DEFAULT_FOLLOW_UP_DAYS } from "@/lib/tracker/followups";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus, type TrackedApplication } from "@/lib/tracker/types";
import { callTracker } from "./api";

type Mode = "view" | "mark_applied" | "edit";

const inputClass =
  "mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-base outline-none focus:border-accent";
const smallButton =
  "rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50";
const primaryButton =
  "rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-accent dark:text-navy";

export function FollowUpBadge({ date, today }: { date: string | null; today: string | null }) {
  if (!date) return null;
  const diff = today ? daysBetween(today, date) : null;
  const tone =
    diff === null
      ? "text-muted"
      : diff < 0
        ? "text-red-700 dark:text-red-300"
        : diff === 0
          ? "text-brass font-semibold"
          : "text-muted";
  const suffix = diff === null ? "" : diff < 0 ? " (overdue)" : diff === 0 ? " (today)" : "";
  return (
    <span className={tone}>
      Follow up {formatDate(date)}
      {suffix}
    </span>
  );
}

/** One application on the board. Every button records what the person did; nothing is sent. */
export function ApplicationCard({ app, today }: { app: TrackedApplication; today: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const working = busy || refreshing;

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await callTracker(`/api/applications/${app.id}`, "PATCH", body);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setMode("view");
    startTransition(() => router.refresh());
    return true;
  }

  const { job } = app;
  const where = [job.company, job.location].filter(Boolean).join(" · ");

  return (
    <article className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <h3 className="font-semibold leading-snug">{job.title}</h3>
      {where && <p className="text-sm text-muted">{where}</p>}

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-muted">
          {app.applied_on ? `Applied ${formatDate(app.applied_on)}` : "Not applied yet"}
        </span>
        {app.status !== "closed" && <FollowUpBadge date={app.follow_up_on} today={today} />}
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            View posting
          </a>
        )}
      </p>

      {app.notes && mode === "view" && (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-background px-3 py-2 text-sm text-muted">
          {app.notes}
        </p>
      )}

      {mode === "view" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`move-${app.id}`}>
            Move to
          </label>
          <select
            id={`move-${app.id}`}
            value={app.status}
            disabled={working}
            onChange={(e) => send({ action: "move", status: e.target.value as ApplicationStatus })}
            className="rounded-full border border-line bg-background px-3 py-1.5 text-xs"
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {app.status === "saved" && (
            <button type="button" className={primaryButton} disabled={working} onClick={() => setMode("mark_applied")}>
              Mark applied
            </button>
          )}
          <button type="button" className={smallButton} disabled={working} onClick={() => setMode("edit")}>
            Edit
          </button>
          {app.follow_up_on && app.status !== "closed" && (
            <>
              <button type="button" className={smallButton} disabled={working} onClick={() => send({ action: "snooze" })}>
                Snooze 3 days
              </button>
              <button type="button" className={smallButton} disabled={working} onClick={() => send({ action: "done" })}>
                Done
              </button>
            </>
          )}
        </div>
      )}

      {mode === "mark_applied" && today && (
        <MarkAppliedForm today={today} working={working} onCancel={() => setMode("view")} onSubmit={send} />
      )}
      {mode === "edit" && <EditForm app={app} working={working} onCancel={() => setMode("view")} onSubmit={send} />}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </article>
  );
}

function MarkAppliedForm({
  today,
  working,
  onCancel,
  onSubmit,
}: {
  today: string;
  working: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [appliedOn, setAppliedOn] = useState(today);
  const [followUp, setFollowUp] = useState(addDays(today, DEFAULT_FOLLOW_UP_DAYS));
  const [followTouched, setFollowTouched] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ action: "mark_applied", applied_on: appliedOn, follow_up_on: followUp || null });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-line p-3">
      <p className="text-xs text-muted">Record that you applied yourself. Fair Winds never applies for you.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium">
          Date applied
          <input
            type="date"
            required
            value={appliedOn}
            onChange={(e) => {
              setAppliedOn(e.target.value);
              if (!followTouched && e.target.value) setFollowUp(addDays(e.target.value, DEFAULT_FOLLOW_UP_DAYS));
            }}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium">
          Follow up on
          <input
            type="date"
            value={followUp}
            onChange={(e) => {
              setFollowTouched(true);
              setFollowUp(e.target.value);
            }}
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={working}>
          {working ? "Saving..." : "Save"}
        </button>
        <button type="button" className={smallButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditForm({
  app,
  working,
  onCancel,
  onSubmit,
}: {
  app: TrackedApplication;
  working: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [appliedOn, setAppliedOn] = useState(app.applied_on ?? "");
  const [followUp, setFollowUp] = useState(app.follow_up_on ?? "");
  const [notes, setNotes] = useState(app.notes ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      action: "edit",
      applied_on: appliedOn || null,
      follow_up_on: followUp || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-line p-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium">
          Date applied
          <input type="date" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium">
          Follow up on
          <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="block text-xs font-medium">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={inputClass} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={working}>
          {working ? "Saving..." : "Save"}
        </button>
        <button type="button" className={smallButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
