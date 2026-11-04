import { describe, expect, it } from "vitest";
import { normalizeOtp } from "../otp";

describe("normalizeOtp", () => {
  it("accepts 6 to 10 digits", () => {
    expect(normalizeOtp("123456")).toBe("123456");
    expect(normalizeOtp("1234567890")).toBe("1234567890");
  });

  it("strips the spaces and dashes people and mail apps add", () => {
    expect(normalizeOtp(" 123 456 ")).toBe("123456");
    expect(normalizeOtp("123-456")).toBe("123456");
  });

  it("rejects short, long, and non-numeric input", () => {
    expect(normalizeOtp("12345")).toBeNull();
    expect(normalizeOtp("12345678901")).toBeNull();
    expect(normalizeOtp("12a456")).toBeNull();
    expect(normalizeOtp("")).toBeNull();
  });
});
