import { NextResponse } from "next/server";
import { DecisionBodySchema, reasonFor } from "@/lib/shortlist/reasons";
import { auditUserAction, jsonError, requireUser } from "@/lib/shortlist/server";

/**
 * POST /api/decisions { jobId, profileId, decision: "keep" | "skip", chip?, note? }
 *
 * Records the person's own keep or skip for a job under one profile. Sending a
 * new decision for the same job and profile replaces the old one. This is the
 * person acting, not an agent, so it does not go through the agent gates; it is
 * logged to audit_log with actor "user".
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { supabase } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_input", "Send a JSON body with jobId, profileId, and decision.");
  }
  const parsed = DecisionBodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Check the decision and try again.";
    return jsonError(400, "bad_input", message);
  }
  const input = parsed.data;
  const reason = reasonFor(input);

  // RLS already limits these reads to the caller's rows; this also refuses soft-deleted ones.
  const [{ data: job }, { data: profile }] = await Promise.all([
    supabase.from("jobs").select("id").eq("id", input.jobId).is("deleted_at", null).maybeSingle(),
    supabase.from("profiles").select("id").eq("id", input.profileId).is("deleted_at", null).maybeSingle(),
  ]);
  if (!job || !profile) {
    return jsonError(404, "not_found", "That job or profile was not found.");
  }

  const { data: previous } = await supabase
    .from("decisions")
    .select("decision, reason")
    .eq("job_id", input.jobId)
    .eq("profile_id", input.profileId)
    .maybeSingle();

  const { data: saved, error } = await supabase
    .from("decisions")
    .upsert(
      {
        job_id: input.jobId,
        profile_id: input.profileId,
        decision: input.decision,
        reason,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "job_id,profile_id" },
    )
    .select("id, job_id, profile_id, decision, reason, decided_at")
    .single();

  if (error || !saved) {
    console.error("decision upsert failed", error?.message);
    return jsonError(500, "server_error", "Could not save that decision. Try again.");
  }

  await auditUserAction(supabase, {
    action: previous ? "decision_change" : "decision",
    entityTable: "decisions",
    entityId: saved.id as string,
    details: {
      job_id: input.jobId,
      profile_id: input.profileId,
      decision: input.decision,
      reason,
      previous: previous ? { decision: previous.decision, reason: previous.reason } : null,
    },
  });

  return NextResponse.json({ decision: saved });
}
