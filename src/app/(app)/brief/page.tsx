import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { FollowUpsCard } from "@/components/tracker/FollowUpsCard";
import { loadApplications } from "@/lib/tracker/load";

export const metadata: Metadata = { title: "Brief" };

export default function BriefPage() {
  return (
    <>
      <PageHeader title="Brief" subtitle="Your Chief of Staff's daily report." />
      <div className="space-y-4">
        <Suspense fallback={null}>
          <FollowUpsDue />
        </Suspense>
        <EmptyState
          heading="No brief yet"
          upcoming={[
            "New roles found since your last visit, already scored against your profiles",
            "Follow-ups that are due today",
            "Queries that keep returning noise, with suggestions to retire them",
          ]}
        >
          <p>
            Once your search profiles are set up, your Chief of Staff will put together a short brief
            here each day. It reports and suggests. It never applies or contacts anyone for you.
          </p>
        </EmptyState>
      </div>
    </>
  );
}

/** Follow-ups due, shown once the person has something on the tracker. */
async function FollowUpsDue() {
  const loaded = await loadApplications();
  if (loaded.state !== "ok" || loaded.applications.length === 0) return null;
  return <FollowUpsCard applications={loaded.applications} showTrackerLink />;
}
