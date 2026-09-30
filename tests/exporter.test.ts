import { expect, it } from "vitest";

import { buildBrief } from "@/lib/exporter";
import { addQuestion, approve } from "@/lib/review";

import { demoWorkspace } from "./helpers";

it("keeps open questions, audit events and the NOT READY state in the brief", async () => {
  let ws = await demoWorkspace();
  ws = approve(ws, "monthly_gross_income_gbp");
  ws = addQuestion(ws, "Is income verified or self-declared?");
  const brief = buildBrief(ws);

  expect(brief).toContain("NOT READY FOR BUILD");
  expect(brief).toContain("Which source field records the exact consent time, and in which timezone?");
  expect(brief).toContain("Is income verified or self-declared?");
  expect(brief).toContain("consent_timestamp: no source field satisfies R3");
  const audit = brief.split("## 11. Audit history")[1];
  expect(audit).toContain("Approved mapping");
  expect(audit).toContain("Demo reviewer");
  const approved = brief.split("## 3. Approved mappings")[1].split("## 4.")[0];
  expect(approved).toContain("monthly_gross_income_gbp");
  expect(approved).not.toContain("consent_timestamp");
  for (const heading of ["Transformation formulas", "Requirement evidence", "Assumptions", "Readiness-check results", "Initial test plan", "Prototype limitations"]) {
    expect(brief).toContain(heading);
  }
  expect(brief).not.toMatch(/fictional/i);
});
