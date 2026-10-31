"use client";

import { useActionState } from "react";
import { saveQuery, type QueryFormState } from "./actions";

const initial: QueryFormState = { status: "idle", message: "", errors: {} };
const input = "mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm";

const SOURCES = [
  ["indeed", "Indeed"],
  ["ziprecruiter", "ZipRecruiter"],
  ["glassdoor", "Glassdoor"],
  ["google", "Google Jobs"],
  ["linkedin", "LinkedIn"],
  ["usajobs", "USAJobs"],
] as const;

export function QueryForm({ profileId }: { profileId: string }) {
  const [state, action, pending] = useActionState(saveQuery, initial);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="profile_id" value={profileId} />
      <div>
        <label htmlFor="query-source" className="block text-sm font-medium">Source</label>
        <select id="query-source" name="source" className={input} aria-invalid={Boolean(state.errors.source)}>
          {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {state.errors.source ? <p className="mt-1 text-xs text-red-800 dark:text-red-300">{state.errors.source}</p> : null}
      </div>
      <div>
        <label htmlFor="query-location" className="block text-sm font-medium">Location</label>
        <input id="query-location" name="location" maxLength={200} placeholder="Uses the profile location if blank" className={input} />
        {state.errors.location ? <p className="mt-1 text-xs text-red-800 dark:text-red-300">{state.errors.location}</p> : null}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="query-text" className="block text-sm font-medium">Search terms</label>
        <input id="query-text" name="query_text" required maxLength={300} placeholder="Director of Laboratory Services" className={input} aria-invalid={Boolean(state.errors.query_text)} />
        {state.errors.query_text ? <p className="mt-1 text-xs text-red-800 dark:text-red-300">{state.errors.query_text}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-full bg-navy px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 dark:bg-brass dark:text-navy">
          {pending ? "Saving..." : "Add query"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${state.status === "error" ? "text-red-800 dark:text-red-300" : "text-muted"}`}>{state.message}</p>
      </div>
    </form>
  );
}
