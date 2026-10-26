import { describe, expect, it } from "vitest";
import { parseSalary } from "../salary";

describe("parseSalary", () => {
  it("reads an annual range", () => {
    expect(parseSalary("$155,000 - $185,000 a year")).toEqual({
      salary_min: 155000,
      salary_max: 185000,
      salary_text: "$155,000 - $185,000 a year",
    });
  });

  it("annualizes hourly pay at 2080 hours and keeps the text", () => {
    expect(parseSalary("$75 an hour")).toEqual({
      salary_min: 156000,
      salary_max: 156000,
      salary_text: "$75 an hour",
    });
  });

  it("annualizes an hourly range and ignores the bracketed note", () => {
    const r = parseSalary("$98.11 to $124.84 an hour (about $204,000 to $260,000 a year at 2,080 hours)");
    expect(r.salary_min).toBe(Math.round(98.11 * 2080));
    expect(r.salary_max).toBe(Math.round(124.84 * 2080));
  });

  it("reads Up to $200K as a maximum only", () => {
    expect(parseSalary("Up to $200K")).toMatchObject({ salary_min: null, salary_max: 200000 });
  });

  it("reads From $X as a minimum only", () => {
    expect(parseSalary("From $157,800 (annualized)")).toMatchObject({ salary_min: 157800, salary_max: null });
  });

  it("reads K ranges with per-period units on each side", () => {
    expect(parseSalary("$155K/yr - $185K/yr")).toMatchObject({ salary_min: 155000, salary_max: 185000 });
  });

  it("reads 'to' ranges with trailing extras", () => {
    expect(parseSalary("$200,000 to $240,000 plus 25% annual incentive")).toMatchObject({
      salary_min: 200000,
      salary_max: 240000,
    });
    expect(parseSalary("$93,600 - $128,700 base + commission eligible")).toMatchObject({
      salary_min: 93600,
      salary_max: 128700,
    });
  });

  it("annualizes monthly pay", () => {
    expect(parseSalary("$10,000 a month")).toMatchObject({ salary_min: 120000, salary_max: 120000 });
  });

  it("does not guess when the period is unclear or daily", () => {
    expect(parseSalary("$75")).toEqual({ salary_min: null, salary_max: null, salary_text: "$75" });
    expect(parseSalary("$900 a day")).toMatchObject({ salary_min: null, salary_max: null });
  });

  it("keeps text without numbers but leaves figures null", () => {
    expect(parseSalary("Competitive salary and benefits")).toEqual({
      salary_min: null,
      salary_max: null,
      salary_text: "Competitive salary and benefits",
    });
  });

  it("treats placeholders and empty values as missing", () => {
    for (const v of ["Not listed", "", "N/A", null, undefined]) {
      expect(parseSalary(v)).toEqual({ salary_min: null, salary_max: null, salary_text: null });
    }
  });

  it("accepts plain numbers as annual pay", () => {
    expect(parseSalary(150000)).toMatchObject({ salary_min: 150000, salary_max: 150000 });
    expect(parseSalary("150,000")).toMatchObject({ salary_min: 150000, salary_max: 150000 });
  });
});
