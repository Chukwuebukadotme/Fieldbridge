/** Provider-neutral AI contract: the system prompt, request payload and structural validation. */

import type { DictionaryField, MappingBatch, TargetField } from "../models";
import { APPROVED_IDS } from "../transformations";

export const SYSTEM_PROMPT = `You are assisting an integration analyst who is mapping a lender's source data to a \
credit-decisioning workflow's required target fields. You propose mappings; deterministic code checks them and a \
person approves them. You do not make lending or credit decisions.

Return exactly one mapping proposal for every target field supplied, plus any open questions.

Rules:
- Do not invent source fields. Use only field_name values supplied in the data dictionary.
- Quote evidence exactly, character for character, from the requirements text. Do not paraphrase, merge or \
reformat passages. Use the requirement identifier (for example R1) that contains the quote.
- Use only these transformation identifiers: ${APPROVED_IDS.join(", ")}. Never write formulas or code.
- For calculate_age_at_submission, list source_fields in this order: date of birth field, submission timestamp field.
- Return a missing mapping (source_fields empty, transformation_id "none", status "Missing") when the evidence \
is insufficient.
- Do not infer consent time from submission time or any other timestamp that does not record consent.
- Do not treat gross and net income as equivalent.
- Do not treat different currencies as equivalent.
- Surface uncertainty as an assumption or an open question.
- status must be one of: Ready, Review required, Missing, Blocked. Never mark a proposal Approved; only a human \
reviewer can approve.`;

/** Dictionary fields as sent to a model: sample values are deliberately withheld. */
export type PromptField = Omit<DictionaryField, "sample_value">;

export function withoutSamples(dictionary: DictionaryField[] | PromptField[]): PromptField[] {
  return dictionary.map(({ field_name, data_type, description, unit }) => ({ field_name, data_type, description, unit }));
}

export function buildUserPayload(requirementsText: string, dictionary: PromptField[], targets: TargetField[]): string {
  // The model does not need record-level data to propose a mapping; samples run locally.
  return JSON.stringify(
    {
      requirements_text: requirementsText,
      data_dictionary: withoutSamples(dictionary),
      target_fields: targets.map((t) => ({
        name: t.name,
        data_type: t.data_type,
        unit: t.unit,
        required: t.required,
        description: t.description,
      })),
      approved_transformations: APPROVED_IDS,
    },
    null,
    2,
  );
}

/** Structural checks the JSON schema cannot express. Returns a list of problems. */
export function validateBatch(batch: MappingBatch, targets: TargetField[]): string[] {
  const problems: string[] = [];
  const known = new Set(targets.map((t) => t.name));
  const seen = new Set<string>();
  for (const proposal of batch.mappings) {
    if (!known.has(proposal.target_field)) problems.push(`Unknown target field '${proposal.target_field}'.`);
    else if (seen.has(proposal.target_field)) problems.push(`Duplicate proposal for '${proposal.target_field}'.`);
    seen.add(proposal.target_field);
  }
  for (const name of [...known].sort()) {
    if (!seen.has(name)) problems.push(`No proposal for target field '${name}'.`);
  }
  return problems;
}
