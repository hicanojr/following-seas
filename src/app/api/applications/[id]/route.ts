import { NextResponse } from "next/server";
import { parseApplicationAction, supabaseTrackerStore, updateApplication } from "@/lib/tracker";
import { jsonError, readJson, requireUser, trackerErrorResponse } from "@/lib/tracker/route-helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/applications/:id with { action, today, ... }
 *   move          { status }                                 Saved, Applied, Interview, Offer, Closed
 *   mark_applied  { applied_on?, follow_up_on? }             defaults: today, and 7 days later
 *   edit          { applied_on?, follow_up_on?, notes? }
 *   snooze                                                   follow-up moves to 3 days from today
 *   done          { note? }                                  clears the follow-up, adds a dated note
 *
 * `today` is the person's local date (YYYY-MM-DD), so dates match their calendar.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return jsonError(400, "bad_input", "That is not an application id.");
  const body = await readJson(request);
  if (!body) return jsonError(400, "bad_input", "Send a JSON object.");

  try {
    const change = parseApplicationAction(body);
    const application = await updateApplication(supabaseTrackerStore(auth.supabase), {
      userId: auth.user.id,
      id,
      today: body.today as string,
      change,
    });
    return NextResponse.json({ application });
  } catch (err) {
    return trackerErrorResponse(err);
  }
}
