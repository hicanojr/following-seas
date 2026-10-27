/** Only allow same-site relative redirects after login. Defaults to /brief. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/brief";
  }
  return next;
}
