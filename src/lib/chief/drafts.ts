/**
 * Draft notes and cover letters for the person to review, edit, and send
 * themselves. They are built only from what the app knows about the job, the
 * application, and the person's career facts. Nothing here invents experience;
 * brackets mark what the person fills in. Nothing here sends anything to
 * anyone.
 */

import { formatDate } from "@/lib/tracker/dates";
import type { CareerFacts } from "@/lib/scoring/types";
import type { ChiefDraft, JobForDraft } from "./types";

export const DRAFT_KINDS = ["follow_up_email", "thank_you", "cover_letter"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_NOTICE = "Draft only. Not sent. Review and edit it, then send it yourself if you choose.";

function roleLine(job: JobForDraft): string {
  return job.company ? `the ${job.title} role at ${job.company}` : `the ${job.title} role`;
}

function factsSection(label: string, facts: CareerFacts | null, key: keyof CareerFacts): string[] {
  const value = facts?.[key]?.trim();
  if (!value) return [];
  return [label, ...value.split("\n").map((line) => `- ${line.trim()}`).filter((l) => l.length > 2), ""];
}

export function buildDraft(kind: DraftKind, job: JobForDraft, facts: CareerFacts | null = null): ChiefDraft {
  const role = roleLine(job);
  const applied = job.application?.applied_on ? formatDate(job.application.applied_on) : null;

  let text: string;
  if (kind === "follow_up_email") {
    const subject = `Subject: Following up on ${job.title}${job.company ? ` at ${job.company}` : ""}`;
    const when = applied ? ` on ${applied}` : " [date you applied]";
    text = [
      subject,
      "",
      "Hello [name or Hiring Team],",
      "",
      `I applied for ${role}${when} and wanted to follow up. I remain very interested in the position and would welcome the chance to talk about how I could contribute.`,
      "",
      "[Optional: one sentence on why this role fits you, using only your own facts.]",
      "",
      "Thank you for your time and consideration.",
      "",
      "Best regards,",
      "[Your name]",
      "[Your phone or email]",
    ].join("\n");
  } else if (kind === "thank_you") {
    text = [
      `Subject: Thank you, ${job.title} conversation`,
      "",
      "Hello [interviewer's name],",
      "",
      `Thank you for taking the time to speak with me about ${role}. I enjoyed learning more about the team and the work.`,
      "",
      "[Add one specific point from your conversation.]",
      "",
      "I remain very interested in the position and look forward to hearing about next steps.",
      "",
      "Best regards,",
      "[Your name]",
    ].join("\n");
  } else {
    // cover_letter
    const lines: string[] = [];
    lines.push(`Subject: Application for ${job.title}${job.company ? ` at ${job.company}` : ""}`);
    lines.push("");
    lines.push("Dear Hiring Manager,");
    lines.push("");
    lines.push(
      `I am writing to apply for ${role}. ${job.company ? `I have followed ${job.company}'s work and am excited about the opportunity to contribute to the team.` : "I am excited about the opportunity to contribute to your team."}`
    );
    lines.push("");

    // Career facts: credentials and experience
    const credLines = factsSection("My background includes:", facts, "credentials");
    const expLines = factsSection("My experience includes:", facts, "experience");
    lines.push(...credLines, ...expLines);

    lines.push(`What draws me to ${job.company || "this role"} is the chance to apply my background to work that matters. I would welcome the opportunity to discuss how my skills and experience align with your needs.`);
    lines.push("");
    lines.push("Thank you for your time and consideration.");
    lines.push("");
    lines.push("Sincerely,");
    lines.push("[Your name]");
    lines.push("[Your phone or email]");

    text = lines.join("\n");
  }

  const label =
    kind === "follow_up_email"
      ? "Draft: follow-up email"
      : kind === "thank_you"
      ? "Draft: thank-you note"
      : "Draft: cover letter";

  return {
    kind,
    jobId: job.id,
    label,
    text,
  };
}
