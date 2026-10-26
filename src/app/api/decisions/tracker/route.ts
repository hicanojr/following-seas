import { NextResponse } from "next/server";
import { z } from "zod";
import { auditUserAction, jsonError, requireUser } from "@/lib/shortlist/server";

const BodySchema = z.object({ jobId: z.uuid() });

/**
 * POST /api/decisions/tracker { jobId }
 *
 * "Save to tracker" for a kept job: adds an applications row with status
 * "saved" when the job has none. It never changes an existing row and never
 * applies anywhere; the person applies themselves.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { supabase } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_input", "Send a JSON body with jobId.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "bad_input", "jobId must be a job id.");
  const { jobId } = parsed.data;

  const { data: job } = await supabase.from("jobs").select("id").eq("id", jobId).is("deleted_at", null).maybeSingle();
  if (!job) return jsonError(404, "not_found", "That job was not found.");

  const { data: existing } = await supabase
    .from("applications")
    .select("id, status")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ created: false, application: existing });
  }

  const { data: created, error } = await supabase
    .from("applications")
    .insert({ job_id: jobId, status: "saved" })
    .select("id, status")
    .single();

  if (error) {
    // 23505: another request saved it first. Report the row that is there.
    if (error.code === "23505") {
      const { data: row } = await supabase.from("applications").select("id, status").eq("job_id", jobId).maybeSingle();
      return NextResponse.json({ created: false, application: row });
    }
    console.error("save to tracker failed", error.message);
    return jsonError(500, "server_error", "Could not save to the tracker. Try again.");
  }

  await auditUserAction(supabase, {
    action: "save_to_tracker",
    entityTable: "applications",
    entityId: created.id as string,
    details: { job_id: jobId, status: "saved" },
  });

  return NextResponse.json({ created: true, application: created });
}
