import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/EmptyState";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Import jobs" };

export default function ImportJobsPage() {
  return (
    <>
      <PageHeader
        title="Import jobs"
        subtitle="Bring in results from Indeed, ZipRecruiter, or a tracker spreadsheet."
      />
      <ImportForm />
      <p className="mt-6 text-sm text-muted">
        Imports only save postings. Nothing is applied for, and no one is contacted.{" "}
        <Link href="/jobs" className="underline underline-offset-2 hover:text-foreground">
          Back to jobs
        </Link>
      </p>
    </>
  );
}
