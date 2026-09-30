/** Typed objects shared by the mapping engine, rule checks, review actions and exporter. */

import { z } from "zod";

// --- Statuses ------------------------------------------------------------------

export const READY = "Ready";
export const REVIEW = "Review required";
export const MISSING = "Missing";
export const BLOCKED = "Blocked";
export const APPROVED = "Approved";

/** Statuses the AI (and a single rule check) may use. "Approved" is reserved for a person. */
export const PROPOSAL_STATUSES = [READY, REVIEW, MISSING, BLOCKED] as const;
export type CheckStatus = (typeof PROPOSAL_STATUSES)[number];
export type MappingStatus = CheckStatus | typeof APPROVED;

/** Risk-first ordering: most severe first. Approved sorts last. */
export const RISK_ORDER: Record<MappingStatus, number> = {
  [BLOCKED]: 0,
  [MISSING]: 1,
  [REVIEW]: 2,
  [READY]: 3,
  [APPROVED]: 4,
};
export const SEVERITY: Record<CheckStatus, number> = { [READY]: 0, [REVIEW]: 1, [MISSING]: 2, [BLOCKED]: 3 };

export type Decision = "Pending" | "Approved" | "Rejected";

export const TRANSFORMATION_IDS = ["identity", "annual_to_monthly", "calculate_age_at_submission", "none"] as const;
export type TransformationId = (typeof TRANSFORMATION_IDS)[number];

export const DEMO_REVIEWER = "Demo reviewer";

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// --- Inputs ----------------------------------------------------------------------

export interface Requirement {
  id: string;
  text: string;
  line: number;
}

export interface DictionaryField {
  field_name: string;
  data_type: string;
  description: string;
  unit: string;
  sample_value: string;
}

export interface TargetField {
  name: string;
  data_type: string;
  unit: string;
  required: boolean;
  description: string;
  // Semantic tags used by deterministic checks (not by the AI).
  income_basis?: "gross" | "net";
  is_consent_time?: boolean;
}

/** Destination workflow definition for the Northstar Lending demo integration. */
export const TARGET_FIELDS: TargetField[] = [
  {
    name: "monthly_gross_income_gbp",
    data_type: "number",
    unit: "GBP/month",
    required: true,
    description: "Applicant's gross (pre-deduction) income per month, in pounds sterling.",
    income_basis: "gross",
  },
  {
    name: "applicant_age_years",
    data_type: "integer",
    unit: "years",
    required: true,
    description: "Applicant's age in completed years on the application submission date.",
  },
  {
    name: "consent_timestamp",
    data_type: "datetime",
    unit: "UTC",
    required: true,
    description: "Exact date and time at which the applicant gave consent.",
    is_consent_time: true,
  },
];

export const PROJECT = {
  customer: "Northstar Lending",
  objective: "Connect an affordability data feed to a credit-decisioning workflow.",
};

// --- AI mapping contract -------------------------------------------------------------
// The live model must return exactly this shape. Unknown keys, unknown
// transformations and the "Approved" status are rejected by validation.

export const MappingProposalSchema = z.strictObject({
  requirement_id: z.string(),
  target_field: z.string(),
  source_fields: z.array(z.string()),
  transformation_id: z.enum(TRANSFORMATION_IDS),
  evidence_quote: z.string(),
  reasoning: z.string(),
  assumptions: z.array(z.string()),
  status: z.enum(PROPOSAL_STATUSES),
});

export const MappingBatchSchema = z.strictObject({
  mappings: z.array(MappingProposalSchema),
  open_questions: z.array(z.string()),
});

export type MappingProposal = z.infer<typeof MappingProposalSchema>;
export type MappingBatch = z.infer<typeof MappingBatchSchema>;

// --- Working state ------------------------------------------------------------------------

/**
 * A mapping under review. Deliberately looser than MappingProposal so that rule
 * checks, not the type system, report problems such as an unknown transformation.
 */
export interface Mapping {
  requirement_id: string;
  target_field: string;
  source_fields: string[];
  transformation_id: string;
  evidence_quote: string;
  reasoning: string;
  assumptions: string[];
  proposed_status: CheckStatus | null; // the AI's own view; cleared once a reviewer edits
  decision: Decision;
  decided_at: string | null;
  origin: "demo" | "live_ai" | "placeholder";
  edited_by_reviewer: boolean;
  revision: number;
}

export function mappingFromProposal(p: MappingProposal, origin: Mapping["origin"]): Mapping {
  return {
    requirement_id: p.requirement_id,
    target_field: p.target_field,
    source_fields: [...p.source_fields],
    transformation_id: p.transformation_id,
    evidence_quote: p.evidence_quote,
    reasoning: p.reasoning,
    assumptions: [...p.assumptions],
    proposed_status: p.status,
    decision: "Pending",
    decided_at: null,
    origin,
    edited_by_reviewer: false,
    revision: 0,
  };
}

export interface CheckResult {
  number: number;
  name: string;
  status: CheckStatus;
  checked: string; // plain-language description of what was checked
  evidence: string; // the evidence or sample value used
  remediation: string | null;
}

export interface Preview {
  inputs: [string, string][]; // (field, sample value)
  output: string | null;
  error: string | null;
}

export interface MappingEvaluation {
  status: MappingStatus;
  checks: CheckResult[];
  preview: Preview;
  reasons: string[]; // short explanation of why the status is what it is
}

export interface AuditEvent {
  timestamp: string;
  actor: string;
  action: string;
  target_field: string | null;
  previous_value: string | null;
  new_value: string | null;
}

export interface OpenQuestion {
  id: number;
  text: string;
  raised_by: string;
  resolved: boolean;
}
