/**
 * The one-time code from the sign-in email. Supabase sends 6 digits by default
 * and allows up to 10. Mail apps and people add spaces or dashes ("123 456"),
 * so strip those, then accept digits only. Returns null when it cannot be a code.
 */
export function normalizeOtp(input: string): string | null {
  const code = input.replace(/[\s-]/g, "");
  return /^\d{6,10}$/.test(code) ? code : null;
}
