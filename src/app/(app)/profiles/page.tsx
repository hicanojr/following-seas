import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { profileToFormInput, type ProfileFormInput } from "@/lib/shortlist/profile-form";
import { MIN_AGREEMENT, shortlistStats, type DecisionHistoryItem, type ShortlistStats } from "@/lib/shortlist/stats";
import { createClient } from "@/lib/supabase/server";
import { setQueryRetired } from "./actions";
import { DeleteProfile } from "./DeleteProfile";
import { ProfileEditor } from "./ProfileEditor";

export const metadata: Metadata = { title: "Profiles" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const EMPTY_FORM: ProfileFormInput = {
  name: "",
  target_titles: "",
  locations: "",
  min_base_pay: "",
  must_haves: "",
  deal_breakers: "",
  plus_factors: "",
  noise_keywords: "",
  noise_allow: "",
};

export default function ProfilesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Profiles" subtitle="What you're looking for, and how to find it." />
      <Suspense fallback={<p className="text-sm text-muted">Loading profiles...</p>}>
        <ProfilesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

async function ProfilesContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <EmptyState heading="Not connected yet" upcoming={[]}>
        <p>Supabase is not configured on this server, so there are no profiles to show.</p>
      </EmptyState>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <EmptyState heading="Signed out" upcoming={[]}>
        <p>
          <Link href="/login?next=/profiles" className="text-accent underline underline-offset-4">
            Sign in
          </Link>{" "}
          to see your profiles.
        </p>
      </EmptyState>
    );
  }

  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id, name, target_titles, locations, min_base_pay, must_haves, deal_breakers, plus_factors, scoring_rubric")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const profiles = (profileRows ?? []) as Record<string, unknown>[];

  const creating = params.new === "1" || profiles.length === 0;
  const requested = typeof params.profile === "string" ? params.profile : undefined;
  const profile = creating ? null : (profiles.find((p) => p.id === requested) ?? profiles[0]);

  return (
    <div className="space-y-6">
      <nav aria-label="Your profiles" className="-mx-1 flex flex-wrap gap-2">
        {profiles.map((p) => {
          const current = p.id === profile?.id;
          return (
            <Link
              key={p.id as string}
              href={`/profiles?profile=${encodeURIComponent(p.id as string)}`}
              aria-current={current ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                current ? "border-foreground bg-foreground text-background" : "border-line text-muted hover:text-foreground"
              }`}
            >
              {String(p.name ?? "")}
            </Link>
          );
        })}
        <Link
          href="/profiles?new=1"
          aria-current={creating ? "page" : undefined}
          className={`rounded-full border border-dashed px-3 py-1 text-sm ${
            creating ? "border-foreground text-foreground" : "border-line text-muted hover:text-foreground"
          }`}
        >
          New profile
        </Link>
      </nav>

      {profile ? (
        <ProfileDetail profile={profile} />
      ) : (
        <section className={card} aria-labelledby="new-profile-heading">
          <h2 id="new-profile-heading" className="text-lg font-semibold">
            New profile
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            A profile is one line of search, such as a director role in one field. Each one is private to you.
          </p>
          <ProfileEditor key="new" profileId={null} values={EMPTY_FORM} />
        </section>
      )}
    </div>
  );
}

async function ProfileDetail({ profile }: { profile: Record<string, unknown> }) {
  const supabase = await createClient();
  if (!supabase) return null;
  const id = profile.id as string;

  const [{ data: decisionRows }, { data: scoreRows }, { data: queryRows }] = await Promise.all([
    supabase.from("decisions").select("job_id, decision, reason").eq("profile_id", id),
    supabase.from("scores").select("job_id, fit").eq("profile_id", id),
    supabase
      .from("queries")
      .select("id, source, query_text, quality, runs, relevant_hits, total_hits, retired")
      .eq("profile_id", id)
      .order("retired", { ascending: true })
      .order("source", { ascending: true })
      .order("query_text", { ascending: true }),
  ]);

  const fitByJob = new Map((scoreRows ?? []).map((s) => [s.job_id as string, Number(s.fit)]));
  const history: DecisionHistoryItem[] = (decisionRows ?? [])
    .filter((d) => d.decision === "keep" || d.decision === "skip")
    .map((d) => ({
      decision: d.decision as "keep" | "skip",
      fit: fitByJob.get(d.job_id as string) ?? null,
      reason: (d.reason as string | null) ?? null,
    }));
  const stats = shortlistStats(history);

  return (
    <>
      <section className={card} aria-labelledby="edit-heading">
        <h2 id="edit-heading" className="mb-4 text-lg font-semibold">
          Edit profile
        </h2>
        <ProfileEditor key={id} profileId={id} values={profileToFormInput(profile)} />
      </section>

      <StatsCard stats={stats} />

      <QueryLibrary queries={(queryRows ?? []) as Record<string, unknown>[]} />

      <section className={card} aria-labelledby="remove-heading">
        <h2 id="remove-heading" className="text-lg font-semibold">
          Remove this profile
        </h2>
        <p className="mt-1 mb-3 text-sm text-muted">Hides it from your lists. Nothing is erased.</p>
        <DeleteProfile profileId={id} name={String(profile.name ?? "")} />
      </section>
    </>
  );
}

function StatsCard({ stats }: { stats: ShortlistStats }) {
  const t = stats.threshold;
  return (
    <section className={card} aria-labelledby="stats-heading">
      <h2 id="stats-heading" className="text-lg font-semibold">
        Your keep and skip history
      </h2>
      <p className="mt-1 text-sm">
        {t.threshold === null ? (
          <>
            <span className="font-medium">Auto shortlist: off</span>
            {t.needed > 0 ? ` (needs ${t.needed} more decision${t.needed === 1 ? "" : "s"})` : null}
          </>
        ) : (
          <>
            <span className="font-medium">Auto shortlist: off.</span> Suggested threshold for you to consider: fit{" "}
            <span className="font-semibold">{t.threshold}</span> or higher.
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">
        {t.reason} A threshold is suggested only after 30 decisions on scored jobs with at least{" "}
        {Math.round(MIN_AGREEMENT * 100)}% agreement. Nothing is kept or skipped for you.
      </p>

      {stats.total === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No decisions yet. Keep or skip jobs on the Jobs page and the counts will build here.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">By fit score</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 font-medium">
                    Fit
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Kept
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Skipped
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.bands.map((b) => (
                  <tr key={b.band} className="border-t border-line">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {b.band}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{b.keep}</td>
                    <td className="py-1.5 text-right tabular-nums">{b.skip}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-medium">
                  <th scope="row" className="py-1.5 text-left">
                    Total
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{stats.keeps}</td>
                  <td className="py-1.5 text-right tabular-nums">{stats.skips}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Top skip reasons</h3>
            {stats.topSkipReasons.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No skips yet.</p>
            ) : (
              <ol className="mt-2 space-y-1 text-sm">
                {stats.topSkipReasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-3 border-t border-line py-1.5">
                    <span className="min-w-0 break-words">{r.reason}</span>
                    <span className="tabular-nums text-muted">{r.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const QUALITY_TONE: Record<string, string> = {
  good: "border-emerald-700/40 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300",
  mixed: "border-brass/60 bg-brass/10",
  noise: "border-red-700/30 bg-red-700/5 text-red-800 dark:text-red-300",
  untested: "border-line text-muted",
};

const SOURCE_LABEL: Record<string, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  linkedin: "LinkedIn",
  usajobs: "USAJobs",
  manual: "Manual",
};

function hits(relevant: unknown, total: unknown): string {
  const t = typeof total === "number" ? total : null;
  const r = typeof relevant === "number" ? relevant : null;
  if (t === null && r === null) return "Hits not counted";
  if (r === null) return `${t} hits`;
  return `${r} of ${t ?? "?"} relevant`;
}

function QueryLibrary({ queries }: { queries: Record<string, unknown>[] }) {
  return (
    <section className={card} aria-labelledby="queries-heading">
      <h2 id="queries-heading" className="text-lg font-semibold">
        Query library
      </h2>
      <p className="mt-1 text-xs text-muted">
        Searches the Search agent runs for this profile. Retired queries are skipped. Restoring a noise query marks it
        untested so it is judged again.
      </p>
      {queries.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No queries yet. Queries appear here as searches are added and run.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {queries.map((q) => {
            const retired = q.retired === true;
            const quality = String(q.quality ?? "untested");
            const text = String(q.query_text ?? "");
            const runs = Number(q.runs ?? 0);
            return (
              <li
                key={q.id as string}
                className={`rounded-xl border border-line p-3 text-sm ${retired ? "bg-background opacity-75" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 break-words font-medium">{text}</p>
                  <form action={setQueryRetired} className="shrink-0">
                    <input type="hidden" name="id" value={q.id as string} />
                    <input type="hidden" name="retired" value={retired ? "false" : "true"} />
                    <button
                      type="submit"
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                      aria-label={`${retired ? "Restore" : "Retire"} query: ${text}`}
                    >
                      {retired ? "Restore" : "Retire"}
                    </button>
                  </form>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{SOURCE_LABEL[String(q.source)] ?? String(q.source)}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 capitalize ${QUALITY_TONE[quality] ?? QUALITY_TONE.untested}`}
                  >
                    {quality}
                  </span>
                  <span>
                    {runs} run{runs === 1 ? "" : "s"}
                  </span>
                  <span>{hits(q.relevant_hits, q.total_hits)}</span>
                  {retired ? <span className="font-medium text-foreground">Retired</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
