import { describe, expect, it } from "vitest";
import { buildDraft, DRAFT_KINDS, DRAFT_NOTICE } from "../drafts";
import type { JobForDraft } from "../types";

const baseJob: JobForDraft = {
  id: "job-1",
  title: "Laboratory Director",
  company: "Harbor Labs",
  url: "https://example.com/jobs/1",
  application: { status: "applied" as const, applied_on: "2026-10-20" },
};

const facts = {
  credentials: "CLIA laboratory director certification\nMD, Pathology",
  experience: "10 years directing clinical laboratories\nCAP accreditation lead",
  other: "Available for relocation",
};

describe("drafts", () => {
  it("lists exactly the agreed draft kinds", () => {
    expect([...DRAFT_KINDS].sort()).toEqual(["cover_letter", "follow_up_email", "thank_you"].sort());
  });

  it("builds a follow-up email draft", () => {
    const draft = buildDraft("follow_up_email", baseJob);
    expect(draft.kind).toBe("follow_up_email");
    expect(draft.label).toBe("Draft: follow-up email");
    expect(draft.text).toContain("Subject: Following up on Laboratory Director at Harbor Labs");
    expect(draft.text).toContain("on Oct 20, 2026");
  });

  it("builds a thank-you note draft", () => {
    const draft = buildDraft("thank_you", baseJob);
    expect(draft.kind).toBe("thank_you");
    expect(draft.label).toBe("Draft: thank-you note");
    expect(draft.text).toContain("Subject: Thank you, Laboratory Director conversation");
    expect(draft.text).toContain("Best regards,");
  });

  it("builds a cover letter draft with career facts", () => {
    const draft = buildDraft("cover_letter", baseJob, facts);
    expect(draft.kind).toBe("cover_letter");
    expect(draft.label).toBe("Draft: cover letter");
    expect(draft.text).toContain("Subject: Application for Laboratory Director at Harbor Labs");
    expect(draft.text).toContain("CLIA laboratory director certification");
    expect(draft.text).toContain("10 years directing clinical laboratories");
    expect(draft.text).toContain("Sincerely,");
    expect(draft.text).toContain("[Your name]");
  });

  it("builds a cover letter draft without career facts", () => {
    const draft = buildDraft("cover_letter", baseJob);
    expect(draft.kind).toBe("cover_letter");
    expect(draft.text).toContain("Subject: Application for Laboratory Director at Harbor Labs");
    expect(draft.text).not.toContain("CLIA");
    expect(draft.text).not.toContain("My background includes:");
    expect(draft.text).not.toContain("My experience includes:");
    expect(draft.text).toContain("[Your name]");
  });

  it("builds a follow-up email without applied date", () => {
    const jobNoDate: JobForDraft = { ...baseJob, application: null };
    const draft = buildDraft("follow_up_email", jobNoDate);
    expect(draft.text).toContain("[date you applied]");
    expect(draft.text).not.toContain("on 2026-10-20");
  });

  it("builds a draft for a job with no company", () => {
    const jobNoCompany: JobForDraft = { ...baseJob, company: null };
    const draft = buildDraft("cover_letter", jobNoCompany, facts);
    expect(draft.text).toContain("Subject: Application for Laboratory Director");
    expect(draft.text).not.toContain("Harbor Labs");
    expect(draft.text).toContain("CLIA laboratory director certification");
  });

  it("DRAFT_NOTICE is present and non-empty", () => {
    expect(DRAFT_NOTICE.length).toBeGreaterThan(0);
    expect(DRAFT_NOTICE).toContain("Draft only");
    expect(DRAFT_NOTICE).toContain("Not sent");
  });
});