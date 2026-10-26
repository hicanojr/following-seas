import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/brief/admin";
import { checkCronAuth } from "@/lib/brief/cron-auth";
import { dailySearchCap, runDailyForUser, usersWithActiveProfiles } from "@/lib/brief/daily";
import { createScoringClient, scoringModel } from "@/lib/scoring/client";
import { scoreJobs } from "@/lib/scoring/service";
import { runSearch } from "@/lib/search/service";
import { searchEnv } from "@/lib/search/route-helpers";

/** Searches and scoring for every person can take a while. */
export const maxDuration = 300;

/**
 * GET /api/cron/daily: the scheduled daily run (see vercel.json).
 *
 * Protected by `Authorization: Bearer ${CRON_SECRET}`: 503 when CRON_SECRET is
 * not set, 401 when the header does not match. There is no user session here.
 *
 * SERVICE ROLE: this is the only route that uses the service role key. It
 * bypasses Row Level Security, so all per-person work goes through
 * runDailyForUser, which filters every query by that person's user id.
 *
 * For each person with at least one active profile (and the daily run left
 * on): run their non-retired LinkedIn and USAJobs queries, up to
 * DAILY_SEARCH_CAP a day; score new jobs when ANTHROPIC_API_KEY is set; store
 * the brief. Everything is logged to agent_runs and audit_log. Nothing is sent
 * to anyone: the brief is read in the app.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 503 ? "missing_config" : "unauthorized", message: auth.message }, { status: auth.status });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "missing_config", message: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the daily run." },
      { status: 503 },
    );
  }

  const client = createScoringClient();
  const deps = {
    supabase,
    now: () => new Date(),
    searchEnv: searchEnv(),
    cap: dailySearchCap(process.env.DAILY_SEARCH_CAP),
    runSearch,
    scoring: client ? { scoreJobs, client, model: scoringModel() } : null,
  };

  let userIds: string[];
  try {
    userIds = await usersWithActiveProfiles(supabase);
  } catch (err) {
    console.error("daily run: could not list users", err);
    return NextResponse.json({ error: "server_error", message: "Could not list users." }, { status: 500 });
  }

  const totals = { users: userIds.length, succeeded: 0, skipped: 0, failed: 0, searches: 0, scored: 0, briefs: 0 };
  // One person at a time keeps provider rate limits and costs predictable.
  for (const userId of userIds) {
    try {
      const r = await runDailyForUser(userId, deps);
      totals[r.status] += 1;
      totals.searches += r.searches.length;
      totals.scored += r.scored;
      if (r.briefSaved) totals.briefs += 1;
    } catch (err) {
      totals.failed += 1;
      console.error("daily run failed for a user", err);
    }
  }

  // Counts only; no user ids or job details leave this route.
  return NextResponse.json({ ok: true, scoring: Boolean(client), ...totals });
}
