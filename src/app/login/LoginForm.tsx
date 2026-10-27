"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

type Status = "idle" | "sending" | "sent" | "verifying" | "error";

// Supabase email codes are 6 digits by default; projects can raise it to 10.
const CODE_PATTERN = /^\d{6,10}$/;

export function LoginForm() {
  const params = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
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
    if (!supabase) return;
    setStatus("sending");
    setMessage(null);
    const redirect = new URL("/auth/callback", window.location.origin);
    redirect.searchParams.set("next", safeNext(params.get("next")));
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect.toString() },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setSentTo(email);
      setMessage(`Check ${email}. Type the code from the email below, or tap its link in this browser.`);
    }
  }

  // The code works in any browser and in the installed app, unlike the link,
  // which only signs in the browser that opens it.
  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || !sentTo) return;
    const token = code.replace(/\s/g, "");
    if (!CODE_PATTERN.test(token)) {
      setStatus("error");
      setMessage("Enter the number code from the email.");
      return;
    }
    setStatus("verifying");
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({ email: sentTo, token, type: "email" });
    if (error) {
      setStatus("error");
      setMessage("That code did not work. Check it, or request a new one.");
      return;
    }
    window.location.assign(safeNext(params.get("next")));
  }

  if (sentTo) {
    return (
      <form onSubmit={onVerify} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <label htmlFor="code" className="block text-sm font-medium">
          Code from the email
        </label>
        <input
          id="code"
          type="text"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-3 text-base tracking-widest outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={status === "verifying"}
          className="mt-4 w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-accent dark:text-navy"
        >
          {status === "verifying" ? "Signing in…" : "Sign in"}
        </button>
        {message && (
          <p
            role="status"
            className={`mt-3 text-sm ${status === "error" ? "text-red-700 dark:text-red-300" : "text-muted"}`}
          >
            {message}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setSentTo(null);
            setCode("");
            setStatus("idle");
            setMessage(null);
          }}
          className="mt-3 text-sm text-muted underline"
        >
          Use a different email or send a new code
        </button>
      </form>
    );
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
