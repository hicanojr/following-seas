/**
 * Dedupe key for jobs. Must stay identical to the generated column in
 * supabase/migrations/0001_init.sql:
 *
 *   lower(coalesce(company, '')) || '|' || lower(coalesce(title, '')) || '|' || lower(coalesce(location, ''))
 *
 * No trimming or whitespace collapsing happens in SQL, so none happens here.
 * If you change one, change both and the tests.
 */
export function dedupeKey(job: {
  company?: string | null;
  title?: string | null;
  location?: string | null;
}): string {
  const part = (v: string | null | undefined) => (v ?? "").toLowerCase();
  return `${part(job.company)}|${part(job.title)}|${part(job.location)}`;
}
