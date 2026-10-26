"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formInput, parseProfileForm } from "@/lib/shortlist/profile-form";
import { createClient } from "@/lib/supabase/server";

/**
 * Profile editor actions. Each one checks the session itself (Server Actions are
 * reachable by direct POST) and uses the anon-key client, so RLS applies.
 * These are the person's own edits, not agent actions; they are logged to audit_log.
 */

export interface ProfileFormState {
  status: "idle" | "saved" | "error";
  message: string;
  errors: Record<string, string>;
}

const Id = z.uuid();

async function session() {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase is not configured on this server." } as const;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session has ended. Sign in again." } as const;
  return { supabase } as const;
}

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function audit(supabase: Supabase, action: string, table: string, id: string, details: Record<string, unknown>) {
  const { error } = await supabase
    .from("audit_log")
    .insert({ actor: "user", action, entity_table: table, entity_id: id, details });
  if (error) console.error("audit_log insert failed", action, error.message);
}

function duplicateName(message: string | undefined) {
  return Boolean(message && message.includes("profiles_user_name_active_key"));
}

export async function saveProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error as string, errors: {} };
  const { supabase } = s;

  const rawId = formData.get("id");
  const isNew = rawId === null || rawId === "";
  const id = isNew ? null : Id.safeParse(rawId);
  if (id && !id.success) return { status: "error", message: "That profile was not found.", errors: {} };

  let existing: Record<string, unknown> = {};
  if (id) {
    const { data } = await supabase
      .from("profiles")
      .select("must_haves, deal_breakers, plus_factors, scoring_rubric")
      .eq("id", id.data)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return { status: "error", message: "That profile was not found.", errors: {} };
    existing = data;
  }

  const parsed = parseProfileForm(formInput(formData), existing);
  if (!parsed.ok) return { status: "error", message: "Check the highlighted fields.", errors: parsed.errors };

  if (!id) {
    const { data, error } = await supabase.from("profiles").insert(parsed.value).select("id").single();
    if (error || !data) {
      if (duplicateName(error?.message)) {
        return { status: "error", message: "Check the highlighted fields.", errors: { name: "You already have a profile with that name." } };
      }
      console.error("profile insert failed", error?.message);
      return { status: "error", message: "Could not create the profile. Try again.", errors: {} };
    }
    await audit(supabase, "profile_create", "profiles", data.id as string, { name: parsed.value.name });
    redirect(`/profiles?profile=${encodeURIComponent(data.id as string)}`);
  }

  const { error } = await supabase.from("profiles").update(parsed.value).eq("id", id.data).is("deleted_at", null);
  if (error) {
    if (duplicateName(error.message)) {
      return { status: "error", message: "Check the highlighted fields.", errors: { name: "You already have a profile with that name." } };
    }
    console.error("profile update failed", error.message);
    return { status: "error", message: "Could not save the profile. Try again.", errors: {} };
  }
  await audit(supabase, "profile_update", "profiles", id.data, { fields: Object.keys(parsed.value) });
  refresh();
  return { status: "saved", message: "Saved.", errors: {} };
}

/** Soft delete: sets deleted_at. Profiles are never hard-deleted. */
export async function softDeleteProfile(formData: FormData): Promise<void> {
  const s = await session();
  if ("error" in s) return;
  const { supabase } = s;
  const id = Id.safeParse(formData.get("id"));
  if (!id.success || formData.get("confirm") !== "yes") return;

  const { error } = await supabase
    .from("profiles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("deleted_at", null);
  if (error) {
    console.error("profile soft delete failed", error.message);
    return;
  }
  await audit(supabase, "profile_soft_delete", "profiles", id.data, {});
  redirect("/profiles");
}

/**
 * Retire or restore a query in the library. Restoring a query marked "noise"
 * resets its quality to "untested", since noise queries must stay retired.
 */
export async function setQueryRetired(formData: FormData): Promise<void> {
  const s = await session();
  if ("error" in s) return;
  const { supabase } = s;
  const id = Id.safeParse(formData.get("id"));
  const retired = formData.get("retired");
  if (!id.success || (retired !== "true" && retired !== "false")) return;

  const { data: query } = await supabase.from("queries").select("id, quality").eq("id", id.data).maybeSingle();
  if (!query) return;

  const update: Record<string, unknown> = { retired: retired === "true" };
  if (retired === "false" && query.quality === "noise") update.quality = "untested";

  const { error } = await supabase.from("queries").update(update).eq("id", id.data);
  if (error) {
    console.error("query retire toggle failed", error.message);
    return;
  }
  await audit(supabase, retired === "true" ? "query_retire" : "query_restore", "queries", id.data, update);
  refresh();
}
