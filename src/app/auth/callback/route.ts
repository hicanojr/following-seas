import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

/**
 * Magic-link landing for the PKCE `code` flow. The code can only be exchanged
 * in the browser that asked for the email (its verifier cookie), so a link sent
 * to someone else cannot sign them in. There is deliberately no token-hash
 * branch: a GET that signs in whoever opens it can swap a victim into an
 * attacker's session, and mail scanners can use the token up. Cross-browser
 * sign-in uses the emailed code typed on /login.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/login", origin));

  const code = searchParams.get("code");

  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", origin));
}
