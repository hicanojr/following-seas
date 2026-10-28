"use client";

import { useActionState } from "react";
import { saveResume, type ResumeFormState } from "./actions";

const initial: ResumeFormState = { status: "idle", message: "" };

export function ResumeForm({
  rawText,
  status,
}: {
  rawText: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(saveResume, initial);
  return (
    <form action={action} className="mt-4 space-y-3">
      <label htmlFor="base-resume" className="block text-sm font-medium">
        Resume text
      </label>
      <textarea
        id="base-resume"
        name="raw_text"
        rows={12}
        defaultValue={rawText}
        maxLength={80000}
        className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm"
        placeholder="Paste the resume you want jobs compared with."
      />
      <p className="text-xs text-muted">{status}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-navy px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 dark:bg-brass dark:text-navy"
        >
          {pending ? "Saving..." : "Save resume"}
        </button>
        {state.message ? (
          <p role="status" className={`text-sm ${state.status === "error" ? "text-red-800 dark:text-red-300" : "text-muted"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
