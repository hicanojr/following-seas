import { describe, expect, it, vi } from "vitest";
import { buildUsaJobsUrl, mapUsaJobsItem, searchUsaJobs } from "../usajobs";
import { MissingConfigError } from "../errors";

const result = {
  MatchedObjectId: "812345600",
  MatchedObjectDescriptor: {
    PositionID: "VA-26-123",
    PositionTitle: "Supervisory Medical Technologist (Laboratory Manager)",
    PositionURI: "https://www.usajobs.gov/job/812345600",
    PositionLocationDisplay: "Boston, Massachusetts",
    OrganizationName: "Veterans Health Administration",
    DepartmentName: "Department of Veterans Affairs",
    PositionRemuneration: [{ MinimumRange: "120000.0", MaximumRange: "156000.0", RateIntervalCode: "PA", Description: "Per Year" }],
    QualificationSummary: "Must hold MLS (ASCP) certification.",
    PublicationStartDate: "2026-10-20T00:00:00.0000",
    UserArea: { Details: { JobSummary: "Manages the clinical lab." } },
  },
};

describe("USAJobs", () => {
  it("builds the search URL and caps results at 50", () => {
    const url = new URL(buildUsaJobsUrl({ keywords: "laboratory director", location: "Boston, MA", resultsPerPage: 500 }));
    expect(url.origin + url.pathname).toBe("https://data.usajobs.gov/api/search");
    expect(url.searchParams.get("Keyword")).toBe("laboratory director");
    expect(url.searchParams.get("LocationName")).toBe("Boston, MA");
    expect(url.searchParams.get("ResultsPerPage")).toBe("50");
    expect(new URL(buildUsaJobsUrl({ keywords: "x", resultsPerPage: 10 })).searchParams.get("ResultsPerPage")).toBe("10");
  });

  it("maps a search result", () => {
    expect(mapUsaJobsItem(result)).toEqual({
      source: "usajobs",
      external_id: "812345600",
      url: "https://www.usajobs.gov/job/812345600",
      title: "Supervisory Medical Technologist (Laboratory Manager)",
      company: "Veterans Health Administration",
      location: "Boston, Massachusetts",
      salary_min: 120000,
      salary_max: 156000,
      salary_text: "$120,000 - $156,000 Per Year",
      description: "Manages the clinical lab.",
      requirements: ["Must hold MLS (ASCP) certification."],
      easy_apply: "no",
      posted_at: "2026-10-20T00:00:00.000Z",
    });
  });

  it("annualizes hourly pay and leaves unclear intervals null", () => {
    const hourly = { MatchedObjectDescriptor: { ...result.MatchedObjectDescriptor, PositionRemuneration: [{ MinimumRange: "50", MaximumRange: "60", RateIntervalCode: "PH" }] } };
    expect(mapUsaJobsItem(hourly)).toMatchObject({ salary_min: 104000, salary_max: 124800 });
    const odd = { MatchedObjectDescriptor: { ...result.MatchedObjectDescriptor, PositionRemuneration: [{ MinimumRange: "1", MaximumRange: "2", RateIntervalCode: "WC" }] } };
    expect(mapUsaJobsItem(odd)).toMatchObject({ salary_min: null, salary_max: null });
  });

  it("sends the key and email headers", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ SearchResult: { SearchResultItems: [result] } }), { status: 200 }),
    );
    const jobs = await searchUsaJobs({ keywords: "lab" }, { apiKey: "k", userAgent: "me@example.com", fetch: fetchMock });
    expect(jobs).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization-Key"]).toBe("k");
    expect(headers["User-Agent"]).toBe("me@example.com");
  });

  it("refuses without the key or email", async () => {
    const fetchMock = vi.fn();
    await expect(searchUsaJobs({ keywords: "x" }, { apiKey: undefined, userAgent: "a@b.c", fetch: fetchMock })).rejects.toBeInstanceOf(MissingConfigError);
    await expect(searchUsaJobs({ keywords: "x" }, { apiKey: "k", userAgent: undefined, fetch: fetchMock })).rejects.toBeInstanceOf(MissingConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
