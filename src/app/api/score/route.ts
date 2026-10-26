import { NextResponse } from "next/server";
import { z } from "zod";
import { GateError } from "@/lib/gates";
import { createScoringClient, isScoringConfigured, scoringModel } from "@/lib/scoring/client";
import { ScoringServiceError, scoreJobs } from "@/lib/scoring/service";
import { createClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  profileId: z.uuid(),
  jobIds: z.array(z.uuid()).max(100).optional(),
});

/** POST /api/score { profileId, jobIds? }: score jobs for one of the caller's profiles. */
export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to score jobs." }, { status: 401 });
  }

  const client = isScoringConfigured() ? createScoringClient() : null;
  if (!client) {
    return NextResponse.json(
      { error: "Scoring is not set up yet: ANTHROPIC_API_KEY is missing on the server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body with profileId." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "profileId must be a profile id; jobIds, if sent, a list of job ids." }, { status: 400 });
  }

  try {
    const outcome = await scoreJobs(
      { userId: user.id, profileId: parsed.data.profileId, jobIds: parsed.data.jobIds },
      { supabase, client, model: scoringModel() },
    );
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof ScoringServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GateError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("Scoring failed", err);
    return NextResponse.json({ error: "Scoring failed. Try again shortly." }, { status: 500 });
  }
}
