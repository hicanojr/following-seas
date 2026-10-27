import { NextResponse, type NextRequest } from "next/server";
import { runSearch, supabaseSearchStore } from "@/lib/search";
import { errorResponse, jsonError, requireUser, searchEnv } from "@/lib/search/route-helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/search { queryId, profileId? }
 * Runs one saved LinkedIn or USAJobs query and saves new postings.
 * Indeed and ZipRecruiter are import only and return 400.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_input", "Send a JSON body with queryId.");
  }
  const { queryId, profileId } = (body ?? {}) as { queryId?: unknown; profileId?: unknown };
  if (typeof queryId !== "string" || !UUID.test(queryId)) {
    return jsonError(400, "bad_input", "queryId must be a query id.");
  }
  if (profileId != null && (typeof profileId !== "string" || !UUID.test(profileId))) {
    return jsonError(400, "bad_input", "profileId must be a profile id.");
  }

  try {
    const summary = await runSearch(
      { userId: auth.user.id, queryId, profileId: (profileId as string | undefined) ?? null },
      { store: supabaseSearchStore(auth.supabase), env: searchEnv() },
    );
    return NextResponse.json(summary);
  } catch (err) {
    return errorResponse(err);
  }
}
