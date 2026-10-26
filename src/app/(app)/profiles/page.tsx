import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Profiles" };

export default function ProfilesPage() {
  return (
    <>
      <PageHeader title="Profiles" subtitle="What you're looking for, and how to find it." />
      <EmptyState
        heading="No search profiles yet"
        upcoming={[
          "Target titles, locations, and minimum base pay",
          "Must-haves, deal-breakers, and plus factors used for scoring",
          "A query library that learns which searches are good, mixed, or noise",
        ]}
      >
        <p>
          A profile is one line of search, such as a director role in one field. You can keep
          several, and each one is private to you.
        </p>
      </EmptyState>
    </>
  );
}
