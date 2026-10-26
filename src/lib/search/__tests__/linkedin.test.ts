import { describe, expect, it, vi } from "vitest";
import {
  APIFY_RUN_SYNC_URL,
  buildActorInput,
  buildLinkedInSearchUrl,
  linkedInEasyApply,
  mapLinkedInItem,
  searchLinkedIn,
} from "../linkedin";
import { MissingConfigError, UpstreamError } from "../errors";

const item = {
  id: "4012345678",
  title: "Director of Laboratory Operations",
  companyName: "Example Health",
  location: "Boston, MA",
  link: "https://www.linkedin.com/jobs/view/4012345678",
  salaryInfo: ["$150,000.00/yr", "$180,000.00/yr"],
  postedAt: "2026-10-20",
  descriptionText: "Lead lab operations.",
  applyMethod: "OffsiteApply",
  applyUrl: "https://careers.example.com/1",
};

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 201 }));
}

describe("LinkedIn search URL and input", () => {
  it("builds a public search URL with keywords, location, and recency", () => {
    const url = new URL(
      buildLinkedInSearchUrl({ keywords: " Director of Laboratory ", location: "United States", recency: "week" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(url.searchParams.get("keywords")).toBe("Director of Laboratory");
    expect(url.searchParams.get("location")).toBe("United States");
    expect(url.searchParams.get("f_TPR")).toBe("r604800");
  });

  it("omits f_TPR when no recency is given", () => {
    expect(new URL(buildLinkedInSearchUrl({ keywords: "x" })).searchParams.has("f_TPR")).toBe(false);
  });

  it("clamps the count to 25..50", () => {
    expect(buildActorInput({ keywords: "x", count: 500 }).count).toBe(50);
    expect(buildActorInput({ keywords: "x", count: 1 }).count).toBe(25);
    expect(buildActorInput({ keywords: "x" }).count).toBe(25);
  });

  it("never includes cookies or login fields", () => {
    const input = buildActorInput({ keywords: "x" });
    expect(Object.keys(input).sort()).toEqual(["count", "scrapeCompany", "urls"]);
    expect(JSON.stringify(input).toLowerCase()).not.toMatch(/cookie|li_at|password|login/);
  });
});

describe("mapLinkedInItem", () => {
  it("maps actor output to a NormalizedJob", () => {
    expect(mapLinkedInItem(item)).toEqual({
      source: "linkedin",
      external_id: "4012345678",
      url: "https://www.linkedin.com/jobs/view/4012345678",
      title: "Director of Laboratory Operations",
      company: "Example Health",
      location: "Boston, MA",
      salary_min: 150000,
      salary_max: 180000,
      salary_text: "$150,000.00/yr - $180,000.00/yr",
      description: "Lead lab operations.",
      requirements: [],
      easy_apply: "no",
      posted_at: "2026-10-20T00:00:00.000Z",
    });
  });

  it("sets easy_apply only when clearly indicated", () => {
    expect(linkedInEasyApply({ applyMethod: "EasyApply" })).toBe("yes");
    expect(linkedInEasyApply({ applyMethod: "ComplexOnsiteApply" })).toBe("yes");
    expect(linkedInEasyApply({ applyMethod: "OffsiteApply" })).toBe("no");
    expect(linkedInEasyApply({ applyUrl: "https://careers.example.com" })).toBe("unknown");
    expect(linkedInEasyApply({})).toBe("unknown");
  });

  it("skips items without a title", () => {
    expect(mapLinkedInItem({ companyName: "X" })).toBeNull();
  });
});

describe("searchLinkedIn", () => {
  it("calls Apify run-sync with a bearer token and no cookies", async () => {
    const fetchMock = okFetch([item, { foo: 1 }]);
    const jobs = await searchLinkedIn({ keywords: "lab director", count: 40 }, { token: "test-token", fetch: fetchMock });
    expect(jobs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(APIFY_RUN_SYNC_URL);
    expect(url).not.toContain("test-token");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("cookie");
    expect(JSON.parse(init.body as string).count).toBe(40);
  });

  it("never returns more than the clamped count", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...item, id: String(i), title: `Job ${i}` }));
    const jobs = await searchLinkedIn({ keywords: "x", count: 30 }, { token: "t", fetch: okFetch(many) });
    expect(jobs).toHaveLength(30);
  });

  it("refuses without APIFY_TOKEN and makes no call", async () => {
    const fetchMock = okFetch([]);
    await expect(searchLinkedIn({ keywords: "x" }, { token: undefined, fetch: fetchMock })).rejects.toBeInstanceOf(
      MissingConfigError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 402 }));
    await expect(searchLinkedIn({ keywords: "x" }, { token: "t", fetch: fetchMock })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});
