import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Brief" };

export default function BriefPage() {
  return (
    <>
      <PageHeader title="Brief" subtitle="Your Chief of Staff's daily report." />
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
    </>
  );
}
