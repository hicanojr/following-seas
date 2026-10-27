import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { FollowUpsCard } from "@/components/tracker/FollowUpsCard";
import { ManualAddForm } from "@/components/tracker/ManualAddForm";
import { TrackerBoard } from "@/components/tracker/TrackerBoard";
import { TrackerImportForm } from "@/components/tracker/TrackerImportForm";
import { loadApplications } from "@/lib/tracker/load";

export const metadata: Metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <>
      <PageHeader title="Tracker" subtitle="Where each application stands." />
      <Suspense fallback={<p className="text-sm text-muted">Loading your tracker...</p>}>
        <TrackerContent />
      </Suspense>
      <p className="mt-6 text-xs text-muted">
        You apply yourself. Fair Winds records what you tell it and reminds you to follow up. It never
        submits applications, never uses Easy Apply, and never emails or messages anyone.
      </p>
    </>
  );
}

async function TrackerContent() {
  const loaded = await loadApplications();

  if (loaded.state === "unconfigured") {
    return (
      <EmptyState heading="Not connected yet" upcoming={[]}>
        <p>Supabase is not configured on this server, so there is nothing to track yet.</p>
      </EmptyState>
    );
  }
  if (loaded.state === "signed_out") {
    return (
      <EmptyState heading="Signed out" upcoming={[]}>
        <p>
          <Link href="/login?next=/tracker" className="text-accent underline underline-offset-4">
            Sign in
          </Link>{" "}
          to see your tracker.
        </p>
      </EmptyState>
    );
  }
  if (loaded.state === "error") {
    return (
      <EmptyState heading="Could not load your tracker" upcoming={[]}>
        <p>Something went wrong reading your applications. Refresh to try again.</p>
      </EmptyState>
    );
  }

  const { applications } = loaded;
  return (
    <div className="space-y-4">
      {applications.length === 0 ? (
        <EmptyState
          heading="Nothing tracked yet"
          upcoming={[
            "Saved, applied, interview, offer, and closed",
            "The date you applied and when to follow up",
            "A running list of every job you applied to, ready to download",
          ]}
        >
          <p>
            When you apply somewhere yourself, log it here and Fair Winds will remind you when a follow-up is
            due. You can also bring in an existing tracker spreadsheet.
          </p>
        </EmptyState>
      ) : (
        <FollowUpsCard applications={applications} />
      )}
      <ManualAddForm />
      <TrackerImportForm />
      {applications.length > 0 && <TrackerBoard applications={applications} />}
    </div>
  );
}
