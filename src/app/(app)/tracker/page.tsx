import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <>
      <PageHeader title="Tracker" subtitle="Where each application stands." />
      <EmptyState
        heading="Nothing tracked yet"
        upcoming={[
          "Saved, applied, interview, offer, and closed",
          "The date you applied and when to follow up",
          "Import from an existing tracker spreadsheet",
        ]}
      >
        <p>
          When you apply somewhere yourself, log it here and Fair Winds will remind you when a
          follow-up is due.
        </p>
      </EmptyState>
    </>
  );
}
