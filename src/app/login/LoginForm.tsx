"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeOtp } from "@/lib/otp";
import { safeNext } from "@/lib/safe-next";

type Status = "idle" | "sending" | "sent" | "verifying" | "error";

const INPUT =
  "mt-2 w-full rounded-xl border border-line bg-background px-3 py-3 text-base outline-none focus:border-accent";
const BUTTON =
  "mt-4 w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-accent dark:text-navy";

export function LoginForm() {
  const params = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
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

  const codeStep = status === "sent" || status === "verifying" || (status === "error" && code !== "");

  async function sendEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    setStatus("sending");
    setMessage(null);
    // The emailed link (PKCE) only works in this browser. The code works anywhere it is typed.
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
      setMessage(`We emailed ${email}. Enter the code from the email, or open the link in this browser.`);
    }
  }

  async function verifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    const token = normalizeOtp(code);
    if (!token) {
      setStatus("error");
      setMessage("Enter the numeric code from the email.");
      return;
    }
    setStatus("verifying");
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      setStatus("error");
      setMessage("That code did not work. Check it, or request a new one.");
      return;
    }
    // Full load so the server sees the new session cookies.
    // nosemgrep: javascript.browser.security.open-redirect.js-open-redirect -- safeNext only returns same-site paths
    window.location.replace(safeNext(params.get("next")));
  }

  if (codeStep) {
    return (
      <form onSubmit={verifyCode} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <label htmlFor="code" className="block text-sm font-medium">
          Code from the email
        </label>
        <input
          id="code"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 \-]*"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          className={INPUT}
        />
        <button type="submit" disabled={status === "verifying"} className={BUTTON}>
          {status === "verifying" ? "Signing in…" : "Sign in"}
        </button>
        {message && (
          <p role="status" className={`mt-3 text-sm ${status === "error" ? "text-red-700 dark:text-red-300" : "text-muted"}`}>
            {message}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setCode("");
            setStatus("idle");
            setMessage(null);
          }}
          className="mt-4 w-full text-sm text-muted underline"
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendEmail} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
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
        className={INPUT}
      />
      <button type="submit" disabled={status === "sending"} className={BUTTON}>
        {status === "sending" ? "Sending…" : "Email me a sign-in code"}
      </button>
      {message && (
        <p role="status" className={`mt-3 text-sm ${status === "error" ? "text-red-700 dark:text-red-300" : "text-muted"}`}>
          {message}
        </p>
      )}
    </form>
  );
}
