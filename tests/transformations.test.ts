import { describe, expect, it } from "vitest";

import { MappingProposalSchema } from "@/lib/models";
import {
  annualToMonthly,
  applyTransformation,
  calculateAgeAtSubmission,
  TransformationError,
  UnknownTransformationError,
} from "@/lib/transformations";

describe("annual_to_monthly", () => {
  it("divides by twelve", () => {
    expect(annualToMonthly(48000)).toBe(4000);
    expect(annualToMonthly("48000")).toBe(4000);
    expect(annualToMonthly("1000")).toBeCloseTo(83.3333, 4);
  });

  it.each(["", "unknown", null, true, "nan", "0x10"])("never coerces %j to a number", (bad) => {
    expect(() => annualToMonthly(bad)).toThrow(TransformationError);
  });
});

describe("calculate_age_at_submission", () => {
  it("gives 34 for the demo record", () => {
    expect(calculateAgeAtSubmission("1992-04-17", "2026-09-01T10:30:00Z")).toBe(34);
  });

  it.each([
    ["2008-09-02", "2026-09-01T10:30:00Z", 17], // birthday is tomorrow
    ["2008-09-01", "2026-09-01T10:30:00Z", 18], // birthday is today
    ["2008-08-31", "2026-09-01T10:30:00Z", 18], // birthday was yesterday
    ["2008-02-29", "2026-02-28T12:00:00Z", 17], // leap-day birthday not reached in a non-leap year
    ["2008-02-29", "2026-03-01T12:00:00Z", 18],
  ])("dob %s at %s is %i", (dob, submitted, expected) => {
    expect(calculateAgeAtSubmission(dob, submitted)).toBe(expected);
  });

  it("uses the UTC submission date", () => {
    // 00:30 on 1 Sep in UTC+1 is still 31 Aug in UTC, so the birthday has not been reached.
    expect(calculateAgeAtSubmission("2008-09-01", "2026-09-01T00:30:00+01:00")).toBe(17);
  });

  it("rejects ambiguous or impossible inputs", () => {
    expect(() => calculateAgeAtSubmission("1992-04-17", "2026-09-01T10:30:00")).toThrow(/no timezone/);
    expect(() => calculateAgeAtSubmission("2027-01-01", "2026-09-01T10:30:00Z")).toThrow(TransformationError);
    expect(() => calculateAgeAtSubmission("1992-02-30", "2026-09-01T10:30:00Z")).toThrow(TransformationError);
  });
});

it("rejects an unknown transformation in the registry and in the AI contract", () => {
  expect(() => applyTransformation("eval_formula", ["48000"])).toThrow(UnknownTransformationError);
  expect(() => applyTransformation("constructor", ["48000"])).toThrow(UnknownTransformationError);
  const proposal = MappingProposalSchema.safeParse({
    requirement_id: "R1",
    target_field: "monthly_gross_income_gbp",
    source_fields: ["annual_gross_income_gbp"],
    transformation_id: "x / 12",
    evidence_quote: "Decisioning requires monthly gross income in GBP.",
    reasoning: "",
    assumptions: [],
    status: "Ready",
  });
  expect(proposal.success).toBe(false);
});
