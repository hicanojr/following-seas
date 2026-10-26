import { describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/dedupe";

// Mirrors: lower(coalesce(company,'')) || '|' || lower(coalesce(title,'')) || '|' || lower(coalesce(location,''))
describe("dedupeKey", () => {
  it("joins lowercased company, title, location with pipes", () => {
    expect(dedupeKey({ company: "Acme Health", title: "Director, Lab", location: "Boston, MA" })).toBe(
      "acme health|director, lab|boston, ma",
    );
  });

  it("treats null and undefined as empty strings, like coalesce", () => {
    expect(dedupeKey({ company: null, title: "Director", location: undefined })).toBe("|director|");
    expect(dedupeKey({})).toBe("||");
  });

  it("matches across case differences", () => {
    const a = dedupeKey({ company: "QUEST Diagnostics", title: "Director of Operations", location: "Marlborough, MA" });
    const b = dedupeKey({ company: "Quest Diagnostics", title: "director of operations", location: "MARLBOROUGH, MA" });
    expect(a).toBe(b);
  });

  it("does not trim or collapse whitespace, because the SQL does not", () => {
    expect(dedupeKey({ company: " Acme ", title: "Lab  Director", location: "" })).toBe(" acme |lab  director|");
  });

  it("keeps different locations distinct", () => {
    expect(dedupeKey({ company: "Acme", title: "Director", location: "Boston, MA" })).not.toBe(
      dedupeKey({ company: "Acme", title: "Director", location: "Remote" }),
    );
  });
});
