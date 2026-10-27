"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient, createEmailLinkClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm() {
  const params = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(params.get("error") ? "error" : "idle");
  const [message, setMessage] = useState<string | null>(
    params.get("error") ? "That sign-in link did not work. Request a new one." : null,
  );

  if (!supabase) {
    return (
      <div className="rounded-2xl border border-line bg-card p-5 text-sm leading-relaxed">
        <p className="font-semibold">Supabase is not configured</p>
        <p className="mt-2 text-muted">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          (see <code>.env.example</code>), then restart the app. Sign-in is unavailable until then.
        </p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const emailClient = createEmailLinkClient();
    if (!emailClient) return;
    setStatus("sending");
    setMessage(null);
    const redirect = new URL("/auth/confirm", window.location.origin);
    redirect.searchParams.set("next", safeNext(params.get("next")));
    const { error } = await emailClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect.toString() },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setMessage(`Check ${email} for a sign-in link.`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <label htmlFor="email" className="block text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-3 text-base outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-4 w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-accent dark:text-navy"
      >
        {status === "sending" ? "Sending link…" : "Email me a sign-in link"}
      </button>
      {message && (
        <p
          role="status"
          className={`mt-3 text-sm ${status === "error" ? "text-red-700 dark:text-red-300" : "text-muted"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
