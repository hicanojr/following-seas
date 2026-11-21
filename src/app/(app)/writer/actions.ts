"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildDraft, type DraftKind } from "@/lib/chief/drafts";

const Id = z.uuid();

async function session() {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase is not configured on this server." } as const;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session has ended. Sign in again." } as const;
  return { supabase, userId: data.user.id } as const;
}

export interface GenerateDraftState {
  status: "idle" | "generated" | "error";
  message: string;
  draft: { label: string; text: string; kind: string } | null;
}

export async function generateDraft(
  _prev: GenerateDraftState,
  formData: FormData
): Promise<GenerateDraftState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error as string, draft: null };
  const { supabase } = s;

  const kind = String(formData.get("kind") ?? "");
  const jobId = Id.safeParse(formData.get("job_id"));
  if (!jobId.success) return { status: "error", message: "Please select a job.", draft: null };
  if (!["follow_up_email", "thank_you", "cover_letter"].includes(kind)) {
    return { status: "error", message: "Choose a draft type.", draft: null };
  }

  // Load the job and its application status.
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, title, company, url")
    .eq("id", jobId.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobError || !job) {
    return { status: "error", message: "That job was not found.", draft: null };
  }

  // Load career facts for cover letters.
  let facts: { credentials: string; experience: string; other: string } | null = null;
  if (kind === "cover_letter") {
    const { data: factsData, error: factsError } = await supabase
      .from("career_facts")
      .select("credentials, experience, other")
      .maybeSingle();
    if (factsError) {
      return { status: "error", message: "Could not load your career facts.", draft: null };
    }
    if (factsData) {
      facts = {
        credentials: typeof factsData.credentials === "string" ? factsData.credentials : "",
        experience: typeof factsData.experience === "string" ? factsData.experience : "",
        other: typeof factsData.other === "string" ? factsData.other : "",
      };
    }
  }

  const draft = buildDraft(
    kind as DraftKind,
    {
      id: String(job.id),
      title: String(job.title ?? ""),
      company: typeof job.company === "string" ? job.company : null,
      url: typeof job.url === "string" ? job.url : null,
      application: null,
    },
    facts
  );

  return {
    status: "generated",
    message: `${draft.label} ready. Review, edit, and send it yourself — nothing is sent automatically.`,
    draft: { label: draft.label, text: draft.text, kind: draft.kind },
  };
}