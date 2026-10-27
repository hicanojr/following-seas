import { describe, expect, it } from "vitest";
import { checkCronAuth } from "../cron-auth";

describe("checkCronAuth", () => {
  it("is 503 when CRON_SECRET is not set", () => {
    expect(checkCronAuth("Bearer anything", undefined)).toMatchObject({ ok: false, status: 503 });
    expect(checkCronAuth("Bearer ", "  ")).toMatchObject({ ok: false, status: 503 });
  });
  it("is 401 without the exact bearer header", () => {
    expect(checkCronAuth(null, "s3cret")).toMatchObject({ ok: false, status: 401 });
    expect(checkCronAuth("Bearer wrong!", "s3cret")).toMatchObject({ ok: false, status: 401 });
    expect(checkCronAuth("s3cret", "s3cret")).toMatchObject({ ok: false, status: 401 });
    expect(checkCronAuth("bearer s3cret", "s3cret")).toMatchObject({ ok: false, status: 401 });
  });
  it("passes with Authorization: Bearer <secret>", () => {
    expect(checkCronAuth("Bearer s3cret", "s3cret")).toEqual({ ok: true });
  });
});
