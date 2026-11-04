import { describe, expect, it } from "vitest";
import { parseQueryForm } from "../form";

const valid = {
  profile_id: "11111111-1111-4111-8111-111111111111",
  source: "indeed",
  query_text: " Director of Laboratory Services ",
  location: " Boston, MA ",
};

describe("parseQueryForm", () => {
  it("trims a saved query and stores an optional location filter", () => {
    expect(parseQueryForm(valid)).toEqual({
      ok: true,
      value: {
        profile_id: valid.profile_id,
        source: "indeed",
        query_text: "Director of Laboratory Services",
        filters: { location: "Boston, MA" },
      },
    });
  });

  it("uses the profile location when the location field is empty", () => {
    expect(parseQueryForm({ ...valid, location: "" })).toMatchObject({ ok: true, value: { filters: {} } });
  });

  it("rejects an unknown profile, source, or empty query", () => {
    const result = parseQueryForm({ profile_id: "bad", source: "manual", query_text: " ", location: "" });
    expect(result).toMatchObject({ ok: false, errors: { profile_id: expect.any(String), source: expect.any(String), query_text: expect.any(String) } });
  });
});
