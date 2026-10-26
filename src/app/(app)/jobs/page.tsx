import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <>
      <PageHeader title="Jobs" subtitle="Postings gathered for your profiles." />
      <EmptyState
        heading="No jobs on deck"
        upcoming={[
          "Imported results from Indeed and ZipRecruiter",
          "LinkedIn results, 25 to 50 per run",
          "A fit score from 1 to 10 with the reason, gaps, and any deal-breaker",
          "Keep or skip, so the shortlist stays yours to decide",
        ]}
      >
        <p>
          Jobs appear here after a search or an import. Duplicates across sources are merged by
          company, title, and location.
        </p>
      </EmptyState>
    </>
  );
}
