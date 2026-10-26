/**
 * Draft notes for the person to review, edit, and send themselves. They are
 * built only from what the app knows about the job and the application. They
 * contain no facts about the person, so nothing about their experience can
 * be invented; brackets mark what the person fills in. Nothing here sends
 * anything to anyone.
 */

import { formatDate } from "@/lib/tracker/dates";
import type { ChiefDraft, JobForDraft } from "./types";

export const DRAFT_KINDS = ["follow_up_email", "thank_you"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_NOTICE = "Draft only. Not sent. Review and edit it, then send it yourself if you choose.";

function roleLine(job: JobForDraft): string {
  return job.company ? `the ${job.title} role at ${job.company}` : `the ${job.title} role`;
}

export function buildDraft(kind: DraftKind, job: JobForDraft): ChiefDraft {
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
  } else {
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
  }

  return {
    kind,
    jobId: job.id,
    label: kind === "follow_up_email" ? "Draft: follow-up email" : "Draft: thank-you note",
    text,
  };
}
