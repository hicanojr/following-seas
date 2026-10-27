import { NextResponse } from "next/server";
import { addManualApplication, supabaseTrackerStore, trackJob } from "@/lib/tracker";
import { jsonError, readJson, requireUser, trackerErrorResponse } from "@/lib/tracker/route-helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/applications: the signed-in person's applications, each with its job. */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const applications = await supabaseTrackerStore(auth.supabase).listApplications();
    return NextResponse.json({ applications });
  } catch (err) {
    return trackerErrorResponse(err);
  }
}

/**
 * POST /api/applications
 *   { jobId, status? }                       put a job already in the app on the tracker
 *   { title, company?, location?, url?, applied_on?, follow_up_on?, notes?, today }
 *                                            log a job the person applied to themselves
 *
 * Records only. The person applies themselves; nothing is submitted or sent.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const body = await readJson(request);
  if (!body) return jsonError(400, "bad_input", "Send a JSON object.");
  const store = supabaseTrackerStore(auth.supabase);

  try {
    if (body.jobId !== undefined) {
      if (typeof body.jobId !== "string" || !UUID.test(body.jobId)) {
        return jsonError(400, "bad_input", "jobId must be a job id.");
      }
      const result = await trackJob(store, { userId: auth.user.id, jobId: body.jobId, status: body.status });
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    const result = await addManualApplication(store, {
      userId: auth.user.id,
      today: body.today as string,
      input: body,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return trackerErrorResponse(err);
  }
}
