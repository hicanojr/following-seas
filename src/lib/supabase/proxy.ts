import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./env";

/** Paths that do not require a signed-in user. */
export const PUBLIC_PATHS = ["/login", "/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie and redirects signed-out visitors to
 * /login. Fails closed: when Supabase is not configured, app routes redirect
 * to /login, which shows a setup notice.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const config = getSupabasePublicConfig();

  const toLogin = () => {
    // API callers get JSON, not an HTML redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  };

  if (!config) {
    return isPublicPath(pathname) ? NextResponse.next({ request }) : toLogin();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // getClaims validates the JWT; do not put code between client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublicPath(pathname)) return toLogin();

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/brief";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
