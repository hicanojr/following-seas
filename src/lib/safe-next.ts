const FALLBACK = "/brief";
const BASE = "https://same-site.invalid";

/**
 * Only allow same-site relative redirects after login. Defaults to /brief.
 * Browsers drop tabs and newlines and treat "\" as "/", so "/\t/evil.example"
 * would become "//evil.example". Reject those characters, then make sure the
 * path still resolves to this origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(next)) {
    return FALLBACK;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== BASE) return FALLBACK;
  return url.pathname + url.search + url.hash;
}
