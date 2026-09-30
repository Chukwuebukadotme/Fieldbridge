"""Deterministic readiness checks.

Every pass/fail decision here is ordinary Python. The AI's proposal is an input
to these checks; it never decides whether a check passes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from models import (
    APPROVED,
    BLOCKED,
    MISSING,
    READY,
    REVIEW,
    SEVERITY,
    CheckResult,
    DictionaryField,
    Mapping,
    MappingEvaluation,
    Preview,
    Requirement,
    TargetField,
)
from transformations import REGISTRY, TransformationError, apply_transformation, format_value

TARGET_ACCEPTS = {
    "number": {"number", "integer"},
    "integer": {"integer"},
    "datetime": {"datetime"},
    "date": {"date"},
    "string": {"string"},
    "boolean": {"boolean"},
}
CURRENCY = re.compile(r"\b(GBP|EUR|USD|CHF|JPY|CAD|AUD)\b")
PER_YEAR = re.compile(r"/\s*(year|yr|annum)\b|\bper\s+(year|annum)\b|\bannual", re.I)
PER_MONTH = re.compile(r"/\s*(month|mo)\b|\bper\s+month\b|\bmonthly", re.I)
NET = re.compile(r"\bnet\b|after[- ]tax|take[- ]home|after deductions", re.I)
GROSS = re.compile(r"\bgross\b|before deductions|pre[- ]tax|before tax", re.I)
SUBMISSION_NAME = re.compile(r"submi(t|ssion)", re.I)
SUBMISSION_DESC = re.compile(r"\bsubmi(t|tted|ssion)\b|\bapplication (was )?received\b", re.I)

CHECK_NAMES = {
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
}


@dataclass
class RuleContext:
    requirements_text: str
    requirements: dict[str, Requirement]
    dictionary: dict[str, DictionaryField]
    targets: dict[str, TargetField]
    requirements_name: str = "requirements document"
    dictionary_name: str = "data dictionary"


def _result(number: int, status: str, checked: str, evidence: str, remediation: str | None = None) -> CheckResult:
    return CheckResult(
        number=number,
        name=CHECK_NAMES[number],
        status=status,
        checked=checked,
        evidence=evidence,
        remediation=None if status == READY else remediation,
    )


def _not_run(number: int, checked: str, why: str, status: str = MISSING) -> CheckResult:
    return _result(number, status, checked, f"Not run: {why}", "Resolves once the earlier findings are fixed.")


def _unit_parts(unit: str) -> tuple[str | None, str | None]:
    currency = CURRENCY.search(unit or "")
    if PER_YEAR.search(unit or ""):
        period = "year"
    elif PER_MONTH.search(unit or ""):
        period = "month"
    else:
        period = None
    return (currency.group(1) if currency else None), period


def income_basis(field: DictionaryField) -> str | None:
    text = f"{field.field_name.replace('_', ' ')} {field.description}"
    is_net, is_gross = bool(NET.search(text)), bool(GROSS.search(text))
    if is_net and is_gross:
        return "ambiguous"
    return "net" if is_net else "gross" if is_gross else None


def is_submission_time(field: DictionaryField) -> bool:
    return bool(SUBMISSION_NAME.search(field.field_name) or SUBMISSION_DESC.search(field.description))


# --- Individual checks ---------------------------------------------------------------


def check_source_present(m: Mapping, ctx: RuleContext) -> CheckResult:
    checked = "At least one source field is proposed for this target."
    if m.source_fields:
        return _result(1, READY, checked, ", ".join(m.source_fields))
    return _result(
        1,
        MISSING,
        checked,
        "No source field proposed.",
        f"Ask the lender which field supplies {m.target_field}. Leave it Missing until a field is confirmed.",
    )


def check_source_exists(m: Mapping, ctx: RuleContext) -> CheckResult:
    checked = f"Every proposed source field exists in {ctx.dictionary_name}."
    if not m.source_fields:
        return _not_run(2, checked, "no source field proposed.")
    unknown = [f for f in m.source_fields if f not in ctx.dictionary]
    if unknown:
        return _result(
            2,
            BLOCKED,
            checked,
            f"Not found: {', '.join(unknown)}",
            "Select a field that exists in the uploaded dictionary. Proposals must not invent fields.",
        )
    found = "; ".join(f"{f} ({ctx.dictionary[f].data_type}, {ctx.dictionary[f].unit or 'no unit'})" for f in m.source_fields)
    return _result(2, READY, checked, f"Found: {found}")


def check_types(m: Mapping, ctx: RuleContext) -> CheckResult:
    target = ctx.targets[m.target_field]
    checked = f"Source types suit the transformation, and its output suits the target type ({target.data_type})."
    if not m.source_fields:
        return _not_run(3, checked, "no source field proposed.")
    spec = REGISTRY.get(m.transformation_id)
    if spec is None:
        return _not_run(3, checked, "transformation is not registered.", BLOCKED)
    if spec.id == "none":
        return _result(3, BLOCKED, checked, "'none' produces no value.", "Choose an approved transformation or remove the source fields.")
    if any(f not in ctx.dictionary for f in m.source_fields):
        return _not_run(3, checked, "a source field is not in the dictionary.", BLOCKED)
    if len(m.source_fields) != len(spec.input_roles):
        return _result(
            3,
            BLOCKED,
            checked,
            f"{spec.id} expects {len(spec.input_roles)} input(s) ({', '.join(spec.input_roles)}); "
            f"{len(m.source_fields)} supplied.",
            "Supply exactly the inputs the transformation needs, in order.",
        )
    for role, allowed, name in zip(spec.input_roles, spec.input_types, m.source_fields):
        source_type = ctx.dictionary[name].data_type
        if source_type not in allowed:
            return _result(
                3,
                BLOCKED,
                checked,
                f"{role} must be {' or '.join(sorted(allowed))}; {name} is {source_type}.",
                "Pick a source field of the expected type, or a different transformation.",
            )
    output_type = spec.output_type or ctx.dictionary[m.source_fields[0]].data_type
    accepted = TARGET_ACCEPTS.get(target.data_type, {target.data_type})
    inputs = ", ".join(f"{f} ({ctx.dictionary[f].data_type})" for f in m.source_fields)
    if output_type not in accepted:
        return _result(
            3,
            BLOCKED,
            checked,
            f"{inputs} → {output_type}; target requires {target.data_type}.",
            "Choose a transformation whose output type matches the target.",
        )
    return _result(3, READY, checked, f"{inputs} → {output_type}; target requires {target.data_type}.")


def check_registry(m: Mapping, ctx: RuleContext) -> CheckResult:
    checked = "The transformation is one of the approved registry identifiers."
    spec = REGISTRY.get(m.transformation_id)
    if spec is None:
        return _result(
            4,
            BLOCKED,
            checked,
            f"'{m.transformation_id}' is not registered.",
            f"Choose one of: {', '.join(REGISTRY)}. Generated formulas are never executed.",
        )
    if spec.id == "none" and m.source_fields:
        return _result(
            4,
            BLOCKED,
            checked,
            "'none' selected, but source fields are supplied.",
            "Choose a transformation for these fields, or remove them.",
        )
    if spec.id == "none":
        return _result(4, READY, checked, "'none' is registered. It records that no transformation is possible yet.")
    return _result(4, READY, checked, f"{spec.id}: {spec.formula}")


def check_evidence(m: Mapping, ctx: RuleContext) -> CheckResult:
    checked = f"The evidence quote appears character-for-character in {ctx.requirements_name}."
    quote = m.evidence_quote
    if not quote.strip():
        return _result(5, BLOCKED, checked, "No evidence quote supplied.", "Cite the requirement passage that justifies this mapping.")
    index = ctx.requirements_text.find(quote)
    if index < 0:
        return _result(
            5,
            BLOCKED,
            checked,
            f"Not found in document: “{quote}”",
            "Evidence may be paraphrased or invented. Select the requirement passage from the document.",
        )
    line = ctx.requirements_text.count("\n", 0, index) + 1
    cited = ctx.requirements.get(m.requirement_id)
    if cited is None:
        return _result(
            5,
            REVIEW,
            checked,
            f"Quote found on line {line}, but requirement {m.requirement_id} does not exist.",
            "Correct the requirement identifier.",
        )
    if quote not in cited.text and cited.text not in quote:
        holder = next((r.id for r in ctx.requirements.values() if quote in r.text), "another passage")
        return _result(
            5,
            REVIEW,
            checked,
            f"Quote found on line {line} ({holder}), but the proposal cites {m.requirement_id}.",
            "Confirm which requirement this mapping satisfies.",
        )
    return _result(5, READY, checked, f"{m.requirement_id}, line {line}: “{quote}”")


def check_units(m: Mapping, ctx: RuleContext) -> CheckResult:
    target = ctx.targets[m.target_field]
    checked = f"The output unit and currency match the target ({target.unit})."
    if not m.source_fields:
        return _not_run(6, checked, "no source field proposed.")
    spec = REGISTRY.get(m.transformation_id)
    if spec is None or spec.id == "none":
        return _not_run(6, checked, "no approved transformation to determine the output unit.", BLOCKED)
    if any(f not in ctx.dictionary for f in m.source_fields):
        return _not_run(6, checked, "a source field is not in the dictionary.", BLOCKED)

    first = ctx.dictionary[m.source_fields[0]]
    src_currency, src_period = _unit_parts(first.unit)
    if spec.unit_rule == "annual_to_monthly":
        if src_period == "month":
            return _result(6, BLOCKED, checked, f"{first.field_name} is already monthly ({first.unit}).", "Use identity, not annual_to_monthly.")
        if src_period is None:
            return _result(6, REVIEW, checked, f"{first.field_name} unit '{first.unit or 'blank'}' does not state a period.", "Confirm the source is an annual amount.")
        out_currency, out_period, out_label = src_currency, "month", f"{src_currency or '?'}/month"
    elif spec.unit_rule == "years":
        out_currency, out_period, out_label = None, None, "years"
    else:
        out_currency, out_period, out_label = src_currency, src_period, first.unit

    tgt_currency, tgt_period = _unit_parts(target.unit)
    trail = f"{' + '.join(ctx.dictionary[f].unit or 'no unit' for f in m.source_fields)} → {spec.id} → {out_label or 'no unit'}; target {target.unit}"

    if tgt_currency or tgt_period:
        if tgt_currency and out_currency and out_currency != tgt_currency:
            return _result(6, BLOCKED, checked, trail, f"{out_currency} and {tgt_currency} are not equivalent, and no approved conversion exists.")
        if tgt_period and out_period and out_period != tgt_period:
            return _result(6, BLOCKED, checked, trail, f"Output is per {out_period}; target is per {tgt_period}. Select the matching transformation.")
        if (tgt_currency and not out_currency) or (tgt_period and not out_period):
            return _result(6, REVIEW, checked, trail, "The source unit does not state its currency or period. Confirm with the lender.")
        return _result(6, READY, checked, trail)

    if not out_label:
        return _result(6, REVIEW, checked, trail, "The source unit is blank. Confirm it with the lender.")
    if out_label.strip().lower() != target.unit.strip().lower():
        return _result(6, BLOCKED, checked, trail, f"'{out_label}' does not match '{target.unit}', and no approved conversion exists.")
    return _result(6, READY, checked, trail)


def check_gross_net(m: Mapping, ctx: RuleContext) -> CheckResult:
    target = ctx.targets[m.target_field]
    checked = "Gross and net income are not treated as equivalent."
    if target.income_basis is None:
        return _result(7, READY, checked, "Not applicable: target is not an income field.")
    if not m.source_fields:
        return _not_run(7, checked, "no source field proposed.")
    known = [ctx.dictionary[f] for f in m.source_fields if f in ctx.dictionary]
    if len(known) != len(m.source_fields):
        return _not_run(7, checked, "a source field is not in the dictionary.", BLOCKED)
    for field in known:
        basis = income_basis(field)
        if basis in ("gross", "net") and basis != target.income_basis:
            return _result(
                7,
                BLOCKED,
                checked,
                f"{field.field_name} is {basis} income (“{field.description}”); target requires {target.income_basis}.",
                "Use a gross income field. No approved transformation converts net to gross.",
            )
        if basis in (None, "ambiguous"):
            return _result(
                7,
                REVIEW,
                checked,
                f"{field.field_name}: “{field.description or 'no description'}” does not clearly state gross or net.",
                "Confirm with the lender whether this amount is before or after deductions.",
            )
    return _result(7, READY, checked, "; ".join(f"{f.field_name}: {income_basis(f)}" for f in known) + f"; target: {target.income_basis}")


def run_preview(m: Mapping, ctx: RuleContext) -> Preview:
    inputs = [(f, ctx.dictionary[f].sample_value if f in ctx.dictionary else "—") for f in m.source_fields]
    if not m.source_fields:
        return Preview(inputs=inputs, error="No source field, so there is nothing to preview.")
    if m.transformation_id not in REGISTRY:
        return Preview(inputs=inputs, error=f"'{m.transformation_id}' is not an approved transformation.")
    if any(f not in ctx.dictionary for f in m.source_fields):
        return Preview(inputs=inputs, error="A source field is not in the dictionary.")
    try:
        output = apply_transformation(m.transformation_id, [value for _, value in inputs])
    except TransformationError as exc:
        return Preview(inputs=inputs, error=str(exc))
    return Preview(inputs=inputs, output=format_value(output))


def check_sample(m: Mapping, ctx: RuleContext, preview: Preview) -> CheckResult:
    checked = "The transformation runs on the dictionary's sample values."
    if not m.source_fields:
        return _not_run(8, checked, "no source field proposed.")
    if m.transformation_id not in REGISTRY or m.transformation_id == "none":
        return _not_run(8, checked, "no approved transformation to run.", BLOCKED)
    if any(f not in ctx.dictionary for f in m.source_fields):
        return _not_run(8, checked, "a source field is not in the dictionary.", BLOCKED)
    blank = [f for f, value in preview.inputs if not value]
    if blank:
        return _result(8, REVIEW, checked, f"No sample value for {', '.join(blank)}.", "Ask the lender for a representative sample value.")
    shown = ", ".join(f"{f} = {value}" for f, value in preview.inputs)
    if preview.error:
        return _result(8, BLOCKED, checked, f"{shown} → error: {preview.error}", "Fix the source value format or choose a different transformation.")
    return _result(8, READY, checked, f"{shown} → {m.target_field} = {preview.output}")


def check_consent(m: Mapping, ctx: RuleContext) -> CheckResult:
    target = ctx.targets[m.target_field]
    checked = "Consent time is not filled from the application submission time."
    if not target.is_consent_time:
        return _result(9, READY, checked, "Not applicable: target is not a consent timestamp.")
    substitutes = [ctx.dictionary[f] for f in m.source_fields if f in ctx.dictionary and is_submission_time(ctx.dictionary[f])]
    if substitutes:
        field = substitutes[0]
        return _result(
            9,
            BLOCKED,
            checked,
            f"{field.field_name}: “{field.description}”",
            f"{field.field_name} records application submission, not consent. Remove it and ask the lender which field "
            "records the exact consent time and its timezone.",
        )
    if not m.source_fields:
        return _result(9, READY, checked, f"No substitute used. {m.target_field} is reported as Missing, not filled from submission time.")
    return _result(9, READY, checked, f"{', '.join(m.source_fields)} is not a submission-time field.")


def check_approval(m: Mapping, rule_status: str) -> CheckResult:
    checked = "A named reviewer has approved this required mapping."
    if m.decision == "Approved":
        when = m.decided_at.strftime("%Y-%m-%d %H:%M:%S UTC") if m.decided_at else "time not recorded"
        return _result(10, READY, checked, f"Approved by Demo reviewer, {when}.")
    if m.decision == "Rejected":
        return _result(10, BLOCKED, checked, "Rejected by reviewer.", "Correct the mapping; it then returns for review.")
    if rule_status in (BLOCKED, MISSING):
        return _result(10, REVIEW, checked, "Awaiting decision.", "Resolve the blocking findings, then approve.")
    return _result(10, REVIEW, checked, "Awaiting decision.", "Confirm the assumptions and approve, or correct the mapping.")


# --- Evaluation ------------------------------------------------------------------------


def evaluate_mapping(m: Mapping, ctx: RuleContext) -> MappingEvaluation:
    preview = run_preview(m, ctx)
    checks = [
        check_source_present(m, ctx),
        check_source_exists(m, ctx),
        check_types(m, ctx),
        check_registry(m, ctx),
        check_evidence(m, ctx),
        check_units(m, ctx),
        check_gross_net(m, ctx),
        check_sample(m, ctx, preview),
        check_consent(m, ctx),
    ]
    worst = max((c.status for c in checks), key=SEVERITY.__getitem__)
    reasons: list[str] = []

    if m.decision == "Rejected":
        status = BLOCKED
        reasons.append("Rejected by reviewer. Correct the mapping to return it for review.")
    elif worst in (BLOCKED, MISSING):
        status = worst
        reasons.extend(f"{c.name}: {c.remediation or c.evidence}" for c in checks if c.status == worst and not c.evidence.startswith("Not run"))
    else:
        status = worst
        reasons.extend(f"{c.name}: {c.remediation}" for c in checks if c.status == REVIEW)
        spec = REGISTRY.get(m.transformation_id)
        if spec and spec.requires_confirmation:
            status = REVIEW
            reasons.append(f"{spec.id} relies on assumptions that need human confirmation.")
        if m.assumptions:
            status = REVIEW
            reasons.append(f"The proposal states {len(m.assumptions)} assumption(s) to confirm.")
        # The AI can ask for review but cannot block, clear, or approve anything.
        if m.proposed_status and m.proposed_status != READY:
            status = REVIEW
            if not reasons:
                reasons.append("The AI proposal flagged this mapping for review.")
        if m.decision == "Approved":
            status = APPROVED
            reasons = ["Approved by Demo reviewer."]
        elif status == READY:
            reasons.append("All rule checks passed. Awaiting approval.")

    checks.append(check_approval(m, status))
    return MappingEvaluation(status=status, checks=checks, preview=preview, reasons=reasons)


def can_approve(evaluation: MappingEvaluation, mapping: Mapping) -> bool:
    return mapping.decision != "Approved" and evaluation.status in (READY, REVIEW)
