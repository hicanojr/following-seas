import { describe, expect, it } from "vitest";
import {
  ALLOWED_ACTIONS,
  FORBIDDEN_ACTIONS,
  GateError,
  LINKEDIN_RESULT_CAP,
  assertAllowed,
  clampLinkedInResults,
  isAllowed,
} from "@/lib/gates";

describe("gates", () => {
  it("allows every action on the allow-list", () => {
    for (const action of ALLOWED_ACTIONS) {
      expect(() => assertAllowed(action)).not.toThrow();
      expect(isAllowed(action)).toBe(true);
    }
  });

  it("has exactly the agreed allow-list", () => {
    expect([...ALLOWED_ACTIONS].sort()).toEqual(
      ["dedupe", "draft", "import", "remind", "score", "search", "shortlist_suggest", "track"].sort(),
    );
  });

  it("throws a forbidden GateError for every forbidden action", () => {
    for (const action of FORBIDDEN_ACTIONS) {
      expect(isAllowed(action)).toBe(false);
      try {
        assertAllowed(action);
        expect.unreachable(`${action} should throw`);
      } catch (e) {
        expect(e).toBeInstanceOf(GateError);
        expect((e as GateError).reason).toBe("forbidden");
        expect((e as GateError).action).toBe(action);
      }
    }
  });

  it("forbids the never-do actions by name", () => {
    for (const action of [
      "submit_application",
      "easy_apply",
      "send_email",
      "message_recruiter",
      "linkedin_login",
      "use_li_at_cookie",
      "hard_delete",
    ]) {
      expect(() => assertAllowed(action)).toThrow(/forbidden/);
    }
  });

  it("throws an unknown GateError for anything not listed", () => {
    for (const action of ["", "apply", "SEARCH", "search ", "delete", "post_to_linkedin"]) {
      expect(() => assertAllowed(action)).toThrow(GateError);
      try {
        assertAllowed(action);
      } catch (e) {
        expect((e as GateError).reason).toBe("unknown");
      }
    }
  });

  it("never lists an action as both allowed and forbidden", () => {
    const forbidden = new Set<string>(FORBIDDEN_ACTIONS);
    expect(ALLOWED_ACTIONS.filter((a) => forbidden.has(a))).toEqual([]);
  });
});

describe("LinkedIn result cap", () => {
  it("is 25 to 50", () => {
    expect(LINKEDIN_RESULT_CAP).toEqual({ min: 25, max: 50 });
    expect(Object.isFrozen(LINKEDIN_RESULT_CAP)).toBe(true);
  });

  it.each([
    [undefined, 25],
    [null, 25],
    [Number.NaN, 25],
    [Number.POSITIVE_INFINITY, 25],
    [-5, 25],
    [0, 25],
    [24, 25],
    [25, 25],
    [37, 37],
    [37.9, 37],
    [50, 50],
    [51, 50],
    [1000, 50],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampLinkedInResults(input as number | null | undefined)).toBe(expected);
  });
});
