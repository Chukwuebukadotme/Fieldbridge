import { beforeEach, describe, expect, it } from "vitest";

import { APPROVED, BLOCKED, MISSING, REVIEW, type MappingEvaluation } from "@/lib/models";
import { approve, correct, evaluateAll, getMapping, reject, riskSorted, ruleContext, type Workspace } from "@/lib/review";
import { evaluateMapping } from "@/lib/rules";

import { demoWorkspace } from "./helpers";

const check = (ev: MappingEvaluation, n: number) => ev.checks.find((c) => c.number === n)!;
let ws: Workspace;

beforeEach(async () => {
  ws = await demoWorkspace();
});

it("produces the expected demo outcomes in risk order", () => {
  const ev = evaluateAll(ws);
  expect(riskSorted(ws, ev)[0].target_field).toBe("consent_timestamp");
  expect(ev.consent_timestamp.status).toBe(MISSING);
  expect(ev.monthly_gross_income_gbp.status).toBe(REVIEW);
  expect(ev.monthly_gross_income_gbp.preview.output).toBe("4000");
  expect(ev.applicant_age_years.status).toBe(REVIEW);
  expect(ev.applicant_age_years.preview.output).toBe("34");
});

it("reports a missing source field as Missing", () => {
  expect(check(evaluateAll(ws).consent_timestamp, 1).status).toBe(MISSING);
});

it("blocks a source field that is not in the dictionary", () => {
  ws = correct(ws, "monthly_gross_income_gbp", ["annual_income_invented"], "annual_to_monthly");
  const ev = evaluateAll(ws).monthly_gross_income_gbp;
  expect(check(ev, 2).status).toBe(BLOCKED);
  expect(ev.status).toBe(BLOCKED);
});

it("blocks an evidence quote that is not in the document", () => {
  const mapping = { ...getMapping(ws, "monthly_gross_income_gbp"), evidence_quote: "Decisioning requires monthly net income in GBP." };
  const ev = evaluateMapping(mapping, ruleContext(ws));
  expect(check(ev, 5).status).toBe(BLOCKED);
  expect(ev.status).toBe(BLOCKED);
});

it("blocks an unregistered transformation and never runs it", () => {
  const mapping = { ...getMapping(ws, "monthly_gross_income_gbp"), transformation_id: "divide_by_12_generated" };
  const ev = evaluateMapping(mapping, ruleContext(ws));
  expect(check(ev, 4).status).toBe(BLOCKED);
  expect(ev.preview.output).toBeNull();
});

it("never accepts submitted_at as consent_timestamp", () => {
  ws = correct(ws, "consent_timestamp", ["submitted_at"], "identity");
  const ev = evaluateAll(ws).consent_timestamp;
  expect(check(ev, 9).status).toBe(BLOCKED);
  expect(ev.status).toBe(BLOCKED);
  expect(() => approve(ws, "consent_timestamp")).toThrow();
});

describe("semantic mismatches", () => {
  it("blocks net income for a gross target", () => {
    ws = {
      ...ws,
      dictionary: [...ws.dictionary, { field_name: "annual_net_income_gbp", data_type: "number", description: "Annual take-home pay after tax", unit: "GBP/year", sample_value: "36000" }],
    };
    ws = correct(ws, "monthly_gross_income_gbp", ["annual_net_income_gbp"], "annual_to_monthly");
    expect(check(evaluateAll(ws).monthly_gross_income_gbp, 7).status).toBe(BLOCKED);
  });

  it("blocks a different currency", () => {
    ws = {
      ...ws,
      dictionary: [...ws.dictionary, { field_name: "annual_gross_income_eur", data_type: "number", description: "Annual gross income before deductions", unit: "EUR/year", sample_value: "56000" }],
    };
    ws = correct(ws, "monthly_gross_income_gbp", ["annual_gross_income_eur"], "annual_to_monthly");
    expect(check(evaluateAll(ws).monthly_gross_income_gbp, 6).status).toBe(BLOCKED);
  });
});

it("audits approvals, edits and rejections, and re-runs checks after an edit", () => {
  const original = ws;
  ws = approve(ws, "monthly_gross_income_gbp");
  expect(evaluateAll(ws).monthly_gross_income_gbp.status).toBe(APPROVED);
  expect(evaluateAll(original).monthly_gross_income_gbp.status).toBe(REVIEW); // actions do not mutate

  // Editing an approved mapping resets it to Pending, and the checks re-run.
  ws = correct(ws, "monthly_gross_income_gbp", ["annual_gross_income_gbp"], "identity");
  expect(getMapping(ws, "monthly_gross_income_gbp").decision).toBe("Pending");
  expect(check(evaluateAll(ws).monthly_gross_income_gbp, 6).status).toBe(BLOCKED); // annual value in a monthly field

  ws = reject(ws, "applicant_age_years", "Confirm timezone first");
  expect(evaluateAll(ws).applicant_age_years.status).toBe(BLOCKED);

  expect(ws.audit.map((e) => e.action)).toEqual([
    "Generated mapping proposals",
    "Approved mapping",
    "Changed transformation",
    "Decision reset after edit",
    "Rejected mapping",
  ]);
  expect(ws.audit[2]).toMatchObject({ previous_value: "annual_to_monthly", new_value: "identity", actor: "Demo reviewer" });
});
