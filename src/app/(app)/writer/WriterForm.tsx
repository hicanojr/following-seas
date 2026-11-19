"use client";

import { useActionState } from "react";
import { generateDraft, type GenerateDraftState } from "./actions";

const initial: GenerateDraftState = {
  status: "idle",
  message: "",
  draft: null,
};

const DRAFT_KINDS: { value: string; label: string }[] = [
  { value: "cover_letter", label: "Cover letter" },
  { value: "follow_up_email", label: "Follow-up email" },
  { value: "thank_you", label: "Thank-you note" },
];

const inputClass =
  "w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy";

export function WriterForm({ jobs, careerFacts }: { jobs: { id: string; title: string; company: string | null }[]; careerFacts: { credentials: string; experience: string; other: string } | null }) {
  const [state, generate, pending] = useActionState(generateDraft, initial);

  return (
    <form action={generate} className="space-y-5" noValidate>
      <div>
        <label htmlFor="draft-kind" className="block text-sm font-medium">
          Draft type
        </label>
        <select
          id="draft-kind"
          name="kind"
          defaultValue={DRAFT_KINDS[0].value}
          className={inputClass}
        >
          {DRAFT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="job-select" className="block text-sm font-medium">
          Job
        </label>
        <select id="job-select" name="job_id" defaultValue={jobs[0]?.id ?? ""} className={inputClass}>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}{j.company ? ` — ${j.company}` : ""}
            </option>
          ))}
          {jobs.length === 0 && <option value="" disabled>No jobs available</option>}
        </select>
        {jobs.length === 0 && (
          <p className="mt-1 text-xs text-muted">Import or search for jobs first, then come back to draft.</p>
        )}
      </div>

      {careerFacts && (
        <fieldset className="border border-line rounded-xl p-3 space-y-3">
          <legend className="text-xs font-medium text-muted">Your career facts (used for cover letters)</legend>
          <textarea
            name="career_credentials"
            defaultValue={careerFacts.credentials}
            rows={3}
            className={inputClass}
            placeholder="Degrees, certifications, licenses — one per line"
            readOnly
          />
          <textarea
            name="career_experience"
            defaultValue={careerFacts.experience}
            rows={4}
            className={inputClass}
            placeholder="Roles, settings, scope, and dates — one per line"
            readOnly
          />
          <p className="text-xs text-muted">
            Edit your career facts on the Profiles page so cover letters reflect your background.
          </p>
        </fieldset>
      )}

      <button
        type="submit"
        disabled={pending || jobs.length === 0}
        className={`rounded-full px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50 ${
          pending || jobs.length === 0
            ? "bg-line text-muted"
            : "bg-navy text-white"
        }`}
      >
        {pending ? "Drafting…" : "Generate draft"}
      </button>

      {state.status === "error" && (
        <p className="mt-1 text-xs text-red-800 dark:text-red-300">{state.message}</p>
      )}

      {state.status === "generated" && state.draft && (
        <section className="border border-line rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">{state.draft.label}</h3>
          <p className="text-xs text-muted">{state.message}</p>
          <textarea
            readOnly
            rows={14}
            className={inputClass}
            defaultValue={state.draft.text}
          />
          <p className="text-xs text-muted">
            Copy the text above, paste it into your email, review and edit it, then send it yourself.
            Nothing is sent automatically.
          </p>
        </section>
      )}
    </form>
  );
}