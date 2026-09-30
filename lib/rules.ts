/**
 * Deterministic readiness checks.
 *
 * Every pass/fail decision here is ordinary code. The AI's proposal is an input
 * to these checks; it never decides whether a check passes.
 */

import {
  APPROVED,
  BLOCKED,
  MISSING,
  READY,
  REVIEW,
  SEVERITY,
  type CheckResult,
  type CheckStatus,
  type DictionaryField,
  type Mapping,
  type MappingEvaluation,
  type MappingStatus,
  type Preview,
  type Requirement,
  type TargetField,
} from "./models";
import { applyTransformation, findSpec, formatValue, REGISTRY, TransformationError } from "./transformations";

const TARGET_ACCEPTS: Record<string, string[]> = {
  number: ["number", "integer"],
  integer: ["integer"],
  datetime: ["datetime"],
  date: ["date"],
  string: ["string"],
  boolean: ["boolean"],
};
const CURRENCY = /\b(GBP|EUR|USD|CHF|JPY|CAD|AUD)\b/;
const PER_YEAR = /\/\s*(year|yr|annum)\b|\bper\s+(year|annum)\b|\bannual/i;
const PER_MONTH = /\/\s*(month|mo)\b|\bper\s+month\b|\bmonthly/i;
const NET = /\bnet\b|after[- ]tax|take[- ]home|after deductions/i;
const GROSS = /\bgross\b|before deductions|pre[- ]tax|before tax/i;
const SUBMISSION_NAME = /submi(t|ssion)/i;
const SUBMISSION_DESC = /\bsubmi(t|tted|ssion)\b|\bapplication (was )?received\b/i;

export const CHECK_NAMES: Record<number, string> = {
  1: "Source field present",
  2: "Source exists in dictionary",
  3: "Data types compatible",
  4: "Approved transformation",
  5: "Evidence quoted verbatim",
  6: "Units and currency compatible",
  7: "Gross and net income not mixed",
  8: "Transformation runs on sample",
  9: "Consent time not substituted",
  10: "Human approval recorded",
};

export interface RuleContext {
  requirementsText: string;
  requirements: Record<string, Requirement>;
  dictionary: Record<string, DictionaryField>;
  targets: Record<string, TargetField>;
  requirementsName: string;
  dictionaryName: string;
}

function result(number: number, status: CheckStatus, checked: string, evidence: string, remediation?: string): CheckResult {
  return {
    number,
    name: CHECK_NAMES[number],
    status,
    checked,
    evidence,
    remediation: status === READY ? null : (remediation ?? null),
  };
}

function notRun(number: number, checked: string, why: string, status: CheckStatus = MISSING): CheckResult {
  return result(number, status, checked, `Not run: ${why}`, "Resolves once the earlier findings are fixed.");
}

const has = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key);

function unitParts(unit: string): [string | null, "year" | "month" | null] {
  const currency = CURRENCY.exec(unit ?? "");
  const period = PER_YEAR.test(unit ?? "") ? "year" : PER_MONTH.test(unit ?? "") ? "month" : null;
  return [currency ? currency[1] : null, period];
}

export function incomeBasis(field: DictionaryField): "gross" | "net" | "ambiguous" | null {
  const text = `${field.field_name.replace(/_/g, " ")} ${field.description}`;
  const isNet = NET.test(text);
  const isGross = GROSS.test(text);
  if (isNet && isGross) return "ambiguous";
  return isNet ? "net" : isGross ? "gross" : null;
}

export function isSubmissionTime(field: DictionaryField): boolean {
  return SUBMISSION_NAME.test(field.field_name) || SUBMISSION_DESC.test(field.description);
}

// --- Individual checks -------------------------------------------------------------------

function checkSourcePresent(m: Mapping): CheckResult {
  const checked = "At least one source field is proposed for this target.";
  if (m.source_fields.length) return result(1, READY, checked, m.source_fields.join(", "));
  return result(
    1,
    MISSING,
    checked,
    "No source field proposed.",
    `Ask the lender which field supplies ${m.target_field}. Leave it Missing until a field is confirmed.`,
  );
}

function checkSourceExists(m: Mapping, ctx: RuleContext): CheckResult {
  const checked = `Every proposed source field exists in ${ctx.dictionaryName}.`;
  if (!m.source_fields.length) return notRun(2, checked, "no source field proposed.");
  const unknown = m.source_fields.filter((f) => !has(ctx.dictionary, f));
  if (unknown.length) {
    return result(
      2,
      BLOCKED,
      checked,
      `Not found: ${unknown.join(", ")}`,
      "Select a field that exists in the uploaded dictionary. Proposals must not invent fields.",
    );
  }
  const found = m.source_fields
    .map((f) => `${f} (${ctx.dictionary[f].data_type}, ${ctx.dictionary[f].unit || "no unit"})`)
    .join("; ");
  return result(2, READY, checked, `Found: ${found}`);
}

function checkTypes(m: Mapping, ctx: RuleContext): CheckResult {
  const target = ctx.targets[m.target_field];
  const checked = `Source types suit the transformation, and its output suits the target type (${target.data_type}).`;
  if (!m.source_fields.length) return notRun(3, checked, "no source field proposed.");
  const spec = findSpec(m.transformation_id);
  if (!spec) return notRun(3, checked, "transformation is not registered.", BLOCKED);
  if (spec.id === "none") {
    return result(3, BLOCKED, checked, "'none' produces no value.", "Choose an approved transformation or remove the source fields.");
  }
  if (m.source_fields.some((f) => !has(ctx.dictionary, f))) {
    return notRun(3, checked, "a source field is not in the dictionary.", BLOCKED);
  }
  if (m.source_fields.length !== spec.inputRoles.length) {
    return result(
      3,
      BLOCKED,
      checked,
      `${spec.id} expects ${spec.inputRoles.length} input(s) (${spec.inputRoles.join(", ")}); ${m.source_fields.length} supplied.`,
      "Supply exactly the inputs the transformation needs, in order.",
    );
  }
  for (let i = 0; i < spec.inputRoles.length; i++) {
    const name = m.source_fields[i];
    const sourceType = ctx.dictionary[name].data_type;
    if (!spec.inputTypes[i].has(sourceType)) {
      return result(
        3,
        BLOCKED,
        checked,
        `${spec.inputRoles[i]} must be ${[...spec.inputTypes[i]].sort().join(" or ")}; ${name} is ${sourceType}.`,
        "Pick a source field of the expected type, or a different transformation.",
      );
    }
  }
  const outputType = spec.outputType ?? ctx.dictionary[m.source_fields[0]].data_type;
  const accepted = TARGET_ACCEPTS[target.data_type] ?? [target.data_type];
  const inputs = m.source_fields.map((f) => `${f} (${ctx.dictionary[f].data_type})`).join(", ");
  const evidence = `${inputs} → ${outputType}; target requires ${target.data_type}.`;
  if (!accepted.includes(outputType)) {
    return result(3, BLOCKED, checked, evidence, "Choose a transformation whose output type matches the target.");
  }
  return result(3, READY, checked, evidence);
}

function checkRegistry(m: Mapping): CheckResult {
  const checked = "The transformation is one of the approved registry identifiers.";
  const spec = findSpec(m.transformation_id);
  if (!spec) {
    return result(
      4,
      BLOCKED,
      checked,
      `'${m.transformation_id}' is not registered.`,
      `Choose one of: ${Object.keys(REGISTRY).join(", ")}. Generated formulas are never executed.`,
    );
  }
  if (spec.id === "none" && m.source_fields.length) {
    return result(4, BLOCKED, checked, "'none' selected, but source fields are supplied.", "Choose a transformation for these fields, or remove them.");
  }
  if (spec.id === "none") {
    return result(4, READY, checked, "'none' is registered. It records that no transformation is possible yet.");
  }
  return result(4, READY, checked, `${spec.id}: ${spec.formula}`);
}

function checkEvidence(m: Mapping, ctx: RuleContext): CheckResult {
  const checked = `The evidence quote appears character-for-character in ${ctx.requirementsName}.`;
  const quote = m.evidence_quote;
  if (!quote.trim()) {
    return result(5, BLOCKED, checked, "No evidence quote supplied.", "Cite the requirement passage that justifies this mapping.");
  }
  const index = ctx.requirementsText.indexOf(quote);
  if (index < 0) {
    return result(
      5,
      BLOCKED,
      checked,
      `Not found in document: “${quote}”`,
      "Evidence may be paraphrased or invented. Select the requirement passage from the document.",
    );
  }
  const line = ctx.requirementsText.slice(0, index).split("\n").length;
  const cited = has(ctx.requirements, m.requirement_id) ? ctx.requirements[m.requirement_id] : undefined;
  if (!cited) {
    return result(
      5,
      REVIEW,
      checked,
      `Quote found on line ${line}, but requirement ${m.requirement_id || "(none)"} does not exist.`,
      "Correct the requirement identifier.",
    );
  }
  if (!cited.text.includes(quote) && !quote.includes(cited.text)) {
    const holder = Object.values(ctx.requirements).find((r) => r.text.includes(quote))?.id ?? "another passage";
    return result(
      5,
      REVIEW,
      checked,
      `Quote found on line ${line} (${holder}), but the proposal cites ${m.requirement_id}.`,
      "Confirm which requirement this mapping satisfies.",
    );
  }
  return result(5, READY, checked, `${m.requirement_id}, line ${line}: “${quote}”`);
}

function checkUnits(m: Mapping, ctx: RuleContext): CheckResult {
  const target = ctx.targets[m.target_field];
  const checked = `The output unit and currency match the target (${target.unit}).`;
  if (!m.source_fields.length) return notRun(6, checked, "no source field proposed.");
  const spec = findSpec(m.transformation_id);
  if (!spec || spec.id === "none") return notRun(6, checked, "no approved transformation to determine the output unit.", BLOCKED);
  if (m.source_fields.some((f) => !has(ctx.dictionary, f))) {
    return notRun(6, checked, "a source field is not in the dictionary.", BLOCKED);
  }

  const first = ctx.dictionary[m.source_fields[0]];
  const [srcCurrency, srcPeriod] = unitParts(first.unit);
  let outCurrency: string | null;
  let outPeriod: string | null;
  let outLabel: string;
  if (spec.unitRule === "annual_to_monthly") {
    if (srcPeriod === "month") {
      return result(6, BLOCKED, checked, `${first.field_name} is already monthly (${first.unit}).`, "Use identity, not annual_to_monthly.");
    }
    if (srcPeriod === null) {
      return result(
        6,
        REVIEW,
        checked,
        `${first.field_name} unit '${first.unit || "blank"}' does not state a period.`,
        "Confirm the source is an annual amount.",
      );
    }
    [outCurrency, outPeriod, outLabel] = [srcCurrency, "month", `${srcCurrency ?? "?"}/month`];
  } else if (spec.unitRule === "years") {
    [outCurrency, outPeriod, outLabel] = [null, null, "years"];
  } else {
    [outCurrency, outPeriod, outLabel] = [srcCurrency, srcPeriod, first.unit];
  }

  const [tgtCurrency, tgtPeriod] = unitParts(target.unit);
  const trail = `${m.source_fields.map((f) => ctx.dictionary[f].unit || "no unit").join(" + ")} → ${spec.id} → ${outLabel || "no unit"}; target ${target.unit}`;

  if (tgtCurrency || tgtPeriod) {
    if (tgtCurrency && outCurrency && outCurrency !== tgtCurrency) {
      return result(6, BLOCKED, checked, trail, `${outCurrency} and ${tgtCurrency} are not equivalent, and no approved conversion exists.`);
    }
    if (tgtPeriod && outPeriod && outPeriod !== tgtPeriod) {
      return result(6, BLOCKED, checked, trail, `Output is per ${outPeriod}; target is per ${tgtPeriod}. Select the matching transformation.`);
    }
    if ((tgtCurrency && !outCurrency) || (tgtPeriod && !outPeriod)) {
      return result(6, REVIEW, checked, trail, "The source unit does not state its currency or period. Confirm with the lender.");
    }
    return result(6, READY, checked, trail);
  }
  if (!outLabel) return result(6, REVIEW, checked, trail, "The source unit is blank. Confirm it with the lender.");
  if (outLabel.trim().toLowerCase() !== target.unit.trim().toLowerCase()) {
    return result(6, BLOCKED, checked, trail, `'${outLabel}' does not match '${target.unit}', and no approved conversion exists.`);
  }
  return result(6, READY, checked, trail);
}

function checkGrossNet(m: Mapping, ctx: RuleContext): CheckResult {
  const target = ctx.targets[m.target_field];
  const checked = "Gross and net income are not treated as equivalent.";
  if (!target.income_basis) return result(7, READY, checked, "Not applicable: target is not an income field.");
  if (!m.source_fields.length) return notRun(7, checked, "no source field proposed.");
  if (m.source_fields.some((f) => !has(ctx.dictionary, f))) {
    return notRun(7, checked, "a source field is not in the dictionary.", BLOCKED);
  }
  const known = m.source_fields.map((f) => ctx.dictionary[f]);
  for (const field of known) {
    const basis = incomeBasis(field);
    if ((basis === "gross" || basis === "net") && basis !== target.income_basis) {
      return result(
        7,
        BLOCKED,
        checked,
        `${field.field_name} is ${basis} income (“${field.description}”); target requires ${target.income_basis}.`,
        "Use a gross income field. No approved transformation converts net to gross.",
      );
    }
    if (basis === null || basis === "ambiguous") {
      return result(
        7,
        REVIEW,
        checked,
        `${field.field_name}: “${field.description || "no description"}” does not clearly state gross or net.`,
        "Confirm with the lender whether this amount is before or after deductions.",
      );
    }
  }
  return result(7, READY, checked, `${known.map((f) => `${f.field_name}: ${incomeBasis(f)}`).join("; ")}; target: ${target.income_basis}`);
}

export function runPreview(m: Mapping, ctx: RuleContext): Preview {
  const inputs: [string, string][] = m.source_fields.map((f) => [f, has(ctx.dictionary, f) ? ctx.dictionary[f].sample_value : "—"]);
  if (!m.source_fields.length) return { inputs, output: null, error: "No source field, so there is nothing to preview." };
  if (!findSpec(m.transformation_id)) {
    return { inputs, output: null, error: `'${m.transformation_id}' is not an approved transformation.` };
  }
  if (m.source_fields.some((f) => !has(ctx.dictionary, f))) {
    return { inputs, output: null, error: "A source field is not in the dictionary." };
  }
  try {
    const output = applyTransformation(m.transformation_id, inputs.map(([, value]) => value));
    return { inputs, output: formatValue(output), error: null };
  } catch (error) {
    if (error instanceof TransformationError) return { inputs, output: null, error: error.message };
    throw error;
  }
}

function checkSample(m: Mapping, ctx: RuleContext, preview: Preview): CheckResult {
  const checked = "The transformation runs on the dictionary's sample values.";
  if (!m.source_fields.length) return notRun(8, checked, "no source field proposed.");
  if (!findSpec(m.transformation_id) || m.transformation_id === "none") {
    return notRun(8, checked, "no approved transformation to run.", BLOCKED);
  }
  if (m.source_fields.some((f) => !has(ctx.dictionary, f))) {
    return notRun(8, checked, "a source field is not in the dictionary.", BLOCKED);
  }
  const blank = preview.inputs.filter(([, value]) => !value).map(([f]) => f);
  if (blank.length) {
    return result(8, REVIEW, checked, `No sample value for ${blank.join(", ")}.`, "Ask the lender for a representative sample value.");
  }
  const shown = preview.inputs.map(([f, value]) => `${f} = ${value}`).join(", ");
  if (preview.error) {
    return result(8, BLOCKED, checked, `${shown} → error: ${preview.error}`, "Fix the source value format or choose a different transformation.");
  }
  return result(8, READY, checked, `${shown} → ${m.target_field} = ${preview.output}`);
}

function checkConsent(m: Mapping, ctx: RuleContext): CheckResult {
  const target = ctx.targets[m.target_field];
  const checked = "Consent time is not filled from the application submission time.";
  if (!target.is_consent_time) return result(9, READY, checked, "Not applicable: target is not a consent timestamp.");
  const substitute = m.source_fields
    .filter((f) => has(ctx.dictionary, f))
    .map((f) => ctx.dictionary[f])
    .find(isSubmissionTime);
  if (substitute) {
    return result(
      9,
      BLOCKED,
      checked,
      `${substitute.field_name}: “${substitute.description}”`,
      `${substitute.field_name} records application submission, not consent. Remove it and ask the lender which field ` +
        "records the exact consent time and its timezone.",
    );
  }
  if (!m.source_fields.length) {
    return result(9, READY, checked, `No substitute used. ${m.target_field} is reported as Missing, not filled from submission time.`);
  }
  return result(9, READY, checked, `${m.source_fields.join(", ")} is not a submission-time field.`);
}

function checkApproval(m: Mapping, ruleStatus: MappingStatus): CheckResult {
  const checked = "A named reviewer has approved this required mapping.";
  if (m.decision === "Approved") {
    const when = m.decided_at ? m.decided_at.replace("T", " ").replace("Z", " UTC") : "time not recorded";
    return result(10, READY, checked, `Approved by Demo reviewer, ${when}.`);
  }
  if (m.decision === "Rejected") {
    return result(10, BLOCKED, checked, "Rejected by reviewer.", "Correct the mapping; it then returns for review.");
  }
  if (ruleStatus === BLOCKED || ruleStatus === MISSING) {
    return result(10, REVIEW, checked, "Awaiting decision.", "Resolve the blocking findings, then approve.");
  }
  return result(10, REVIEW, checked, "Awaiting decision.", "Confirm the assumptions and approve, or correct the mapping.");
}

// --- Evaluation --------------------------------------------------------------------------------

export function evaluateMapping(m: Mapping, ctx: RuleContext): MappingEvaluation {
  const preview = runPreview(m, ctx);
  const checks = [
    checkSourcePresent(m),
    checkSourceExists(m, ctx),
    checkTypes(m, ctx),
    checkRegistry(m),
    checkEvidence(m, ctx),
    checkUnits(m, ctx),
    checkGrossNet(m, ctx),
    checkSample(m, ctx, preview),
    checkConsent(m, ctx),
  ];
  const worst = checks.reduce<CheckStatus>((acc, c) => (SEVERITY[c.status] > SEVERITY[acc] ? c.status : acc), READY);
  let reasons: string[] = [];
  let status: MappingStatus;

  if (m.decision === "Rejected") {
    status = BLOCKED;
    reasons.push("Rejected by reviewer. Correct the mapping to return it for review.");
  } else if (worst === BLOCKED || worst === MISSING) {
    status = worst;
    reasons = checks
      .filter((c) => c.status === worst && !c.evidence.startsWith("Not run"))
      .map((c) => `${c.name}: ${c.remediation ?? c.evidence}`);
  } else {
    status = worst;
    reasons = checks.filter((c) => c.status === REVIEW).map((c) => `${c.name}: ${c.remediation}`);
    const spec = findSpec(m.transformation_id);
    if (spec?.requiresConfirmation) {
      status = REVIEW;
      reasons.push(`${spec.id} relies on assumptions that need human confirmation.`);
    }
    if (m.assumptions.length) {
      status = REVIEW;
      reasons.push(`The proposal states ${m.assumptions.length} assumption(s) to confirm.`);
    }
    // The AI can ask for review but cannot block, clear, or approve anything.
    if (m.proposed_status && m.proposed_status !== READY) {
      status = REVIEW;
      if (!reasons.length) reasons.push("The AI proposal flagged this mapping for review.");
    }
    if (m.decision === "Approved") {
      status = APPROVED;
      reasons = ["Approved by Demo reviewer."];
    } else if (status === READY) {
      reasons.push("All rule checks passed. Awaiting approval.");
    }
  }

  checks.push(checkApproval(m, status));
  return { status, checks, preview, reasons };
}

export function canApprove(evaluation: MappingEvaluation, mapping: Mapping): boolean {
  return mapping.decision !== "Approved" && (evaluation.status === READY || evaluation.status === REVIEW);
}
