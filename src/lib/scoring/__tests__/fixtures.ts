import type { JobRow, ProfileRow } from "@/lib/jobs/types";
import type { CareerFacts } from "../types";

export function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    user_id: "00000000-0000-0000-0000-0000000000u1",
    dedupe_key: "acme|lab services manager|denver, co",
    source: "indeed",
    external_id: null,
    url: "https://example.com/job/1",
    title: "Laboratory Services Manager",
    company: "Acme Health",
    location: "Denver, CO",
    salary_min: null,
    salary_max: null,
    salary_text: null,
    description: "",
    requirements: [],
    easy_apply: "unknown",
    posted_at: null,
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "00000000-0000-0000-0000-0000000000p1",
    user_id: "00000000-0000-0000-0000-0000000000u1",
    name: "Director, lab services",
    target_titles: ["Director of Laboratory Services"],
    locations: [],
    min_base_pay: null,
    must_haves: [],
    deal_breakers: [],
    plus_factors: [],
    scoring_rubric: {},
    ...overrides,
  };
}

export const MLT_FACTS: CareerFacts = {
  credentials: "MLT(ASCP)\nAssociate degree, clinical laboratory science",
  experience: "Laboratory manager, community hospital",
  other: "",
};
