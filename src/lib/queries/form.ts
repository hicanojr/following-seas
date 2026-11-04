import { z } from "zod";

export const QUERY_SOURCES = ["indeed", "ziprecruiter", "glassdoor", "google", "linkedin", "usajobs"] as const;

export interface QueryFormInput {
  profile_id: string;
  source: string;
  query_text: string;
  location: string;
}

export type QueryFormResult =
  | { ok: true; value: { profile_id: string; source: (typeof QUERY_SOURCES)[number]; query_text: string; filters: { location?: string } } }
  | { ok: false; errors: Record<string, string> };

export function queryFormInput(form: { get(name: string): unknown }): QueryFormInput {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return { profile_id: text("profile_id"), source: text("source"), query_text: text("query_text"), location: text("location") };
}

export function parseQueryForm(input: QueryFormInput): QueryFormResult {
  const parsed = z
    .object({
      profile_id: z.uuid("That profile was not found."),
      source: z.enum(QUERY_SOURCES, { error: "Choose a supported source." }),
      query_text: z.string().trim().min(1, "Enter what to search for.").max(300, "Keep the search under 300 characters."),
      location: z.string().trim().max(200, "Keep the location under 200 characters."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message])),
    };
  }
  const { profile_id, source, query_text, location } = parsed.data;
  return { ok: true, value: { profile_id, source, query_text, filters: location ? { location } : {} } };
}
