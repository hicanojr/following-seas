"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { softDeleteProfile } from "./actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-red-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "Removing..." : "Yes, remove it"}
    </button>
  );
}

/** Soft delete with a confirm step. The profile is hidden, not erased. */
export function DeleteProfile({ profileId, name }: { profileId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-full border border-line px-4 py-2 text-sm text-red-800 hover:bg-background dark:text-red-300"
      >
        Remove profile
      </button>
    );
  }

  return (
    <form
      action={softDeleteProfile}
      role="alertdialog"
      aria-labelledby="delete-profile-title"
      aria-describedby="delete-profile-desc"
      className="space-y-3 rounded-xl border border-red-700/30 bg-red-700/5 p-4"
    >
      <input type="hidden" name="id" value={profileId} />
      <input type="hidden" name="confirm" value="yes" />
      <p id="delete-profile-title" className="text-sm font-semibold">
        Remove “{name}”?
      </p>
      <p id="delete-profile-desc" className="text-sm text-muted">
        It disappears from your lists and searches. Nothing is erased: its jobs, scores, and decisions stay on
        file.
      </p>
      <div className="flex flex-wrap gap-2">
        <ConfirmButton />
        <button
          type="button"
          autoFocus
          onClick={() => setConfirming(false)}
          className="rounded-full border border-line px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
