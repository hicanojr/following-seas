import "server-only";

import { createClient } from "@/lib/supabase/server";
import { supabaseTrackerStore } from "./store";
import type { TrackedApplication } from "./types";

export type LoadedApplications =
  | { state: "unconfigured" }
  | { state: "signed_out" }
  | { state: "error" }
  | { state: "ok"; applications: TrackedApplication[] };

/** The signed-in person's applications for a Server Component. Call inside <Suspense>. */
export async function loadApplications(): Promise<LoadedApplications> {
  const supabase = await createClient();
  if (!supabase) return { state: "unconfigured" };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { state: "signed_out" };
  try {
    return { state: "ok", applications: await supabaseTrackerStore(supabase).listApplications() };
  } catch (err) {
    console.error("could not load applications", err);
    return { state: "error" };
  }
}
