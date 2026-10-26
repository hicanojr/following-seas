"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Turn the daily run on or off for the signed-in person. Checks the session
 * itself (Server Actions are reachable by direct POST) and uses the anon-key
 * client, so Row Level Security applies. Logged to audit_log as the person's own change.
 */
export async function setDailyRun(formData: FormData): Promise<void> {
  const value = formData.get("daily_run");
  if (value !== "true" && value !== "false") return;
  const supabase = await createClient();
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;

  const dailyRun = value === "true";
  const { error } = await supabase
    .from("brief_settings")
    .upsert({ user_id: data.user.id, daily_run: dailyRun }, { onConflict: "user_id" });
  if (error) {
    console.error("brief settings update failed", error.message);
    return;
  }
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor: "user",
    action: dailyRun ? "daily_run_on" : "daily_run_off",
    entity_table: "brief_settings",
    details: { daily_run: dailyRun },
  });
  if (auditError) console.error("audit_log insert failed", auditError.message);
  refresh();
}
