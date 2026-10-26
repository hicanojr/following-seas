import { NextResponse } from "next/server";
import { latestBrief } from "@/lib/brief/load";
import { jsonError, requireUser } from "@/lib/shortlist/server";

/**
 * GET /api/brief: the signed-in person's latest stored brief, or
 * `{ brief: null }` when none has been made yet. 401 JSON when signed out.
 * Uses the session client, so Row Level Security applies.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const stored = await latestBrief(auth.supabase, auth.user.id);
    return NextResponse.json({ brief: stored?.content ?? null, generatedAt: stored?.generated_at ?? null });
  } catch (err) {
    console.error("could not load the brief", err);
    return jsonError(500, "server_error", "Could not load the brief. Try again.");
  }
}
