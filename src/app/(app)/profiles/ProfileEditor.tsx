"use client";

import { useActionState } from "react";
import type { ProfileFormInput } from "@/lib/shortlist/profile-form";
import { saveProfile, type ProfileFormState } from "./actions";

const initial: ProfileFormState = { status: "idle", message: "", errors: {} };

type FieldName = keyof ProfileFormInput;

const LIST_FIELDS: { name: FieldName; label: string; hint: string; rows: number }[] = [
  { name: "target_titles", label: "Target titles", hint: "One per line.", rows: 4 },
  { name: "locations", label: "Locations", hint: "One per line. Leave empty for anywhere.", rows: 3 },
  { name: "must_haves", label: "Must-haves", hint: "One per line. Unmet ones are flagged on each job.", rows: 3 },
  { name: "deal_breakers", label: "Deal-breakers", hint: "One per line. A hit sets the job aside under Screened out.", rows: 3 },
  { name: "plus_factors", label: "Plus factors", hint: "One per line. Nice to have, never required.", rows: 3 },
  {
    name: "noise_keywords",
    label: "Noise keywords",
    hint: "One per line. Titles with these words are dropped at search time, with the reason kept.",
    rows: 3,
  },
  {
    name: "noise_allow",
    label: "Allowed words",
    hint: "One per line. Built-in noise words to stop dropping, such as forensic.",
    rows: 2,
  },
];

const inputClass = "w-full rounded-xl border border-line bg-background px-3 py-2 text-sm";

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-800 dark:text-red-300">
      {text}
    </p>
  );
}

export function ProfileEditor({ profileId, values }: { profileId: string | null; values: ProfileFormInput }) {
  const [state, action, pending] = useActionState(saveProfile, initial);
  const err = state.errors;

  return (
    <form action={action} className="space-y-4" noValidate>
      {profileId ? <input type="hidden" name="id" value={profileId} /> : null}

      <div>
        <label htmlFor="profile-name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="profile-name"
          name="name"
          defaultValue={values.name}
          required
          maxLength={120}
          aria-invalid={Boolean(err.name)}
          aria-describedby={err.name ? "profile-name-error" : undefined}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError id="profile-name-error" text={err.name} />
      </div>

      <div>
        <label htmlFor="profile-pay" className="block text-sm font-medium">
          Minimum base pay
        </label>
        <p className="text-xs text-muted">Yearly, in US dollars. Leave empty for no minimum.</p>
        <input
          id="profile-pay"
          name="min_base_pay"
          inputMode="numeric"
          defaultValue={values.min_base_pay}
          placeholder="150000"
          aria-invalid={Boolean(err.min_base_pay)}
          aria-describedby={err.min_base_pay ? "profile-pay-error" : undefined}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError id="profile-pay-error" text={err.min_base_pay} />
      </div>

      {LIST_FIELDS.map((f) => (
        <div key={f.name}>
          <label htmlFor={`profile-${f.name}`} className="block text-sm font-medium">
            {f.label}
          </label>
          <p className="text-xs text-muted">{f.hint}</p>
          <textarea
            id={`profile-${f.name}`}
            name={f.name}
            defaultValue={values[f.name]}
            rows={f.rows}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-navy px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 dark:bg-brass dark:text-navy"
        >
          {pending ? "Saving..." : profileId ? "Save profile" : "Create profile"}
        </button>
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${state.status === "error" ? "text-red-800 dark:text-red-300" : "text-muted"}`}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
