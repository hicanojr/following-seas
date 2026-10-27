"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

/**
 * Landing page for the sign-in email link. The link carries the session tokens
 * in the URL hash (implicit flow), which the server never sees, so this runs in
 * the browser: it stores the session in cookies, then moves on. It works in
 * whichever browser opens the link.
 */
export default function ConfirmPage() {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const supabase = createClient();

    if (!supabase || !accessToken || !refreshToken) {
      window.location.replace("/login?error=link");
      return;
    }
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => window.location.replace(error ? "/login?error=link" : next));
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-12 text-center">
      <p className="text-sm text-muted">Signing you in…</p>
    </main>
  );
}
