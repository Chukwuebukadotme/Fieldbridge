/**
 * Approved transformation registry.
 *
 * The AI may only *select* one of these identifiers. Trusted code below performs
 * the transformation. Nothing here evaluates model-generated text.
 */

export class TransformationError extends Error {
  name = "TransformationError";
}

/** The identifier is not in the approved registry. */
export class UnknownTransformationError extends TransformationError {
  name = "UnknownTransformationError";
}

const ANY_TYPE = new Set(["number", "integer", "string", "date", "datetime", "boolean"]);
const NUMERIC = new Set(["number", "integer"]);

// --- Implementations ------------------------------------------------------------------

export function identity(value: unknown): unknown {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw new TransformationError("Value is blank; identity will not substitute a default.");
  }
  return value;
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function toNumber(value: unknown): number {
  if (typeof value === "boolean") throw new TransformationError("Boolean is not a numeric amount.");
  if (value === null || value === undefined) throw new TransformationError("Value is blank; it will not be treated as zero.");
  let number: number;
  if (typeof value === "number") {
    number = value;
  } else {
    const text = String(value).trim().replace(/,/g, "");
    if (!text) throw new TransformationError("Value is blank; it will not be treated as zero.");
    if (!DECIMAL.test(text)) throw new TransformationError(`'${value}' is not a number.`);
    number = Number(text);
  }
  if (!Number.isFinite(number)) throw new TransformationError(`'${value}' is not a finite number.`);
  return number;
}

/** Divide a numeric annual amount by 12. No rounding is applied. */
export function annualToMonthly(annualValue: unknown): number {
  return toNumber(annualValue) / 12;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

function toDate(value: unknown): CalendarDate {
  const match = ISO_DATE.exec(String(value ?? "").trim());
  if (!match) throw new TransformationError(`'${value}' is not an ISO date (YYYY-MM-DD).`);
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new TransformationError(`'${value}' is not a real calendar date.`);
  }
  return { year, month, day };
}

function toUtcDate(value: unknown): CalendarDate {
  const text = String(value ?? "").trim();
  if (!ISO_DATETIME.test(text)) throw new TransformationError(`'${value}' is not an ISO 8601 date-time.`);
  if (!HAS_ZONE.test(text)) {
    throw new TransformationError(`'${value}' has no timezone, so the submission date is ambiguous.`);
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) throw new TransformationError(`'${value}' is not a valid date-time.`);
  return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() };
}

/**
 * Completed years between date of birth and the UTC calendar date of submission.
 *
 * The birthday counts once its month and day have been reached. A 29 February
 * birthday is therefore reached on 1 March in non-leap years.
 */
export function calculateAgeAtSubmission(dateOfBirth: unknown, submittedAt: unknown): number {
  const dob = toDate(dateOfBirth);
  const submitted = toUtcDate(submittedAt);
  const dobKey = dob.year * 10000 + dob.month * 100 + dob.day;
  const submittedKey = submitted.year * 10000 + submitted.month * 100 + submitted.day;
  if (dobKey > submittedKey) throw new TransformationError("Date of birth is after the submission date.");
  const birthdayNotReached = submitted.month * 100 + submitted.day < dob.month * 100 + dob.day;
  return submitted.year - dob.year - (birthdayNotReached ? 1 : 0);
}

// --- Registry -------------------------------------------------------------------------------

export interface TestTemplate {
  case: string;
  given: string;
  expect: string;
}

export interface TransformationSpec {
  id: string;
  label: string;
  formula: string;
  inputRoles: string[];
  inputTypes: Set<string>[];
  outputType: string | null; // null: same type as the single input
  unitRule: "same" | "annual_to_monthly" | "years" | "none";
  requiresConfirmation: boolean;
  fn: ((...values: unknown[]) => unknown) | null;
  assumptions: string[];
  tests: TestTemplate[];
}

export const REGISTRY: Record<string, TransformationSpec> = {
  identity: {
    id: "identity",
    label: "Identity (copy value)",
    formula: "target = source",
    inputRoles: ["Source value"],
    inputTypes: [ANY_TYPE],
    outputType: null,
    unitRule: "same",
    requiresConfirmation: false,
    fn: identity,
    assumptions: [],
    tests: [
      { case: "Sample record", given: "{src0} = {sample0}", expect: "{target} = {sample_out}" },
      { case: "Blank value", given: "{src0} is blank", expect: "Record flagged; no default substituted" },
    ],
  },
  annual_to_monthly: {
    id: "annual_to_monthly",
    label: "Annual to monthly (÷ 12)",
    formula: "target = source ÷ 12",
    inputRoles: ["Annual amount"],
    inputTypes: [NUMERIC],
    outputType: "number",
    unitRule: "annual_to_monthly",
    requiresConfirmation: true,
    fn: annualToMonthly,
    assumptions: ["The source amount covers a full 12-month period."],
    tests: [
      { case: "Sample record", given: "{src0} = {sample0}", expect: "{target} = {sample_out}" },
      { case: "Zero income", given: "{src0} = 0", expect: "{target} = 0" },
      { case: "Not divisible by 12", given: "{src0} = 1000", expect: "{target} = 83.333… (unrounded; confirm rounding rule)" },
      { case: "Non-numeric value", given: "{src0} = 'unknown'", expect: "Record rejected; never coerced to 0" },
      { case: "Blank value", given: "{src0} is blank", expect: "Record rejected; never treated as 0" },
    ],
  },
  calculate_age_at_submission: {
    id: "calculate_age_at_submission",
    label: "Age at submission (completed years)",
    formula: "target = completed years from date_of_birth to UTC date of submitted_at",
    inputRoles: ["Date of birth", "Submission timestamp"],
    inputTypes: [new Set(["date"]), new Set(["datetime"])],
    outputType: "integer",
    unitRule: "years",
    requiresConfirmation: true,
    fn: calculateAgeAtSubmission as (...values: unknown[]) => unknown,
    assumptions: [
      "The submission date is the UTC calendar date of the submission timestamp.",
      "A 29 February birthday is reached on 1 March in non-leap years.",
    ],
    tests: [
      { case: "Sample record", given: "{src0} = {sample0}, {src1} = {sample1}", expect: "{target} = {sample_out}" },
      { case: "Birthday not yet reached", given: "{src0} = 2008-09-02, {src1} = 2026-09-01T10:30:00Z", expect: "{target} = 17" },
      { case: "Birthday on submission date", given: "{src0} = 2008-09-01, {src1} = 2026-09-01T10:30:00Z", expect: "{target} = 18" },
      { case: "Leap-day birthday, non-leap year", given: "{src0} = 2008-02-29, {src1} = 2026-02-28T12:00:00Z", expect: "{target} = 17" },
      { case: "Offset timestamp near midnight", given: "{src0} = 2008-09-01, {src1} = 2026-09-01T00:30:00+01:00", expect: "{target} = 17 (UTC date is 31 Aug)" },
      { case: "Date of birth after submission", given: "{src0} = 2027-01-01, {src1} = 2026-09-01T10:30:00Z", expect: "Record rejected" },
    ],
  },
  none: {
    id: "none",
    label: "None (no valid transformation)",
    formula: "No transformation available; target cannot be populated.",
    inputRoles: [],
    inputTypes: [],
    outputType: null,
    unitRule: "none",
    requiresConfirmation: false,
    fn: null,
    assumptions: [],
    tests: [
      { case: "Source not identified", given: "No source field", expect: "Blocked; no test can run until a source field is confirmed" },
    ],
  },
};

export const APPROVED_IDS = Object.keys(REGISTRY);

export function getSpec(transformationId: string): TransformationSpec {
  const spec = Object.hasOwn(REGISTRY, transformationId) ? REGISTRY[transformationId] : undefined;
  if (!spec) {
    throw new UnknownTransformationError(
      `'${transformationId}' is not an approved transformation. Approved: ${APPROVED_IDS.join(", ")}.`,
    );
  }
  return spec;
}

export function findSpec(transformationId: string): TransformationSpec | undefined {
  return Object.hasOwn(REGISTRY, transformationId) ? REGISTRY[transformationId] : undefined;
}

export function applyTransformation(transformationId: string, values: unknown[]): unknown {
  const spec = getSpec(transformationId);
  if (!spec.fn) throw new TransformationError("'none' means no valid transformation is available.");
  if (values.length !== spec.inputRoles.length) {
    throw new TransformationError(
      `'${spec.id}' expects ${spec.inputRoles.length} input(s) (${spec.inputRoles.join(", ")}); ${values.length} supplied.`,
    );
  }
  return spec.fn(...values);
}

export function formatValue(value: unknown): string {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(value);
}
