import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/EmptyState";
import { WriterForm } from "./WriterForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Writer" };

export default function WriterPage() {
  return (
    <>
      <PageHeader title="Writer" subtitle="Draft cover letters and notes to send yourself." />
      <Suspense fallback={<p className="text-sm text-muted">Loading your drafts…</p>}>
        <WriterContent />
      </Suspense>
    </>
  );
}

async function WriterContent() {
  const supabase = await createClient();
  if (!supabase) {
    return (
      <EmptyState heading="Not connected yet" upcoming={[]}>
        <p>Supabase is not configured on this server, so the Writer has nothing to work with yet.</p>
      </EmptyState>
    );
  }

  const { data: user } = await supabase.auth.getUser();
  if (!user) {
    return (
      <EmptyState heading="Signed out" upcoming={[]}>
        <p>
          <Link href="/login?next=/writer" className="text-accent underline underline-offset-4">
            Sign in
          </Link>{" "}
          to draft cover letters and notes.
        </p>
      </EmptyState>
    );
  }

  // Load career facts for cover letters.
  let careerFacts: { credentials: string; experience: string; other: string } | null = null;
  try {
    const { data: facts, error: factsError } = await supabase
      .from("career_facts")
      .select("credentials, experience, other")
      .maybeSingle();
    if (factsError) throw new Error(factsError.message);
    if (facts) {
      careerFacts = {
        credentials: typeof facts.credentials === "string" ? facts.credentials : "",
        experience: typeof facts.experience === "string" ? facts.experience : "",
        other: typeof facts.other === "string" ? facts.other : "",
      };
    }
  } catch (err) {
    console.error("could not load career facts", err);
  }

  // Load the person's non-deleted jobs to draft for.
  const { data: jobRows, error: jobError } = await supabase
    .from("jobs")
    .select("id, title, company")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (jobError) throw new Error(`Could not load jobs: ${jobError.message}`);

  const jobs = (jobRows ?? []).map((j) => ({
    id: String(j.id),
    title: String(j.title ?? ""),
    company: typeof j.company === "string" ? j.company : null,
  }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Drafts are for you to review, edit, and send yourself. Nothing is emailed, messaged, or
        submitted on your behalf. Cover letters use only your saved career facts — nothing is
        invented.
      </p>
      {jobs.length === 0 ? (
        <EmptyState heading="No jobs to draft for" upcoming={[]}>
          <p>
            Import or search for jobs first. Once you have postings, come here to draft a cover
            letter or note for any of them.
          </p>
        </EmptyState>
      ) : (
        <WriterForm jobs={jobs} careerFacts={careerFacts} />
      )}
    </div>
  );
}