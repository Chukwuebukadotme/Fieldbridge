"""Typed objects shared by the mapping engine, rule checks, review actions and exporter."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# --- Statuses ---------------------------------------------------------------

READY = "Ready"
REVIEW = "Review required"
MISSING = "Missing"
BLOCKED = "Blocked"
APPROVED = "Approved"

MAPPING_STATUSES = (READY, REVIEW, MISSING, BLOCKED, APPROVED)

# Statuses the AI (and a single rule check) may use. "Approved" is reserved for a person.
ProposalStatus = Literal["Ready", "Review required", "Missing", "Blocked"]
CheckStatus = ProposalStatus

# Risk-first ordering: most severe first. Approved sorts last.
RISK_ORDER = {BLOCKED: 0, MISSING: 1, REVIEW: 2, READY: 3, APPROVED: 4}
SEVERITY = {READY: 0, REVIEW: 1, MISSING: 2, BLOCKED: 3}

Decision = Literal["Pending", "Approved", "Rejected"]

TransformationId = Literal["identity", "annual_to_monthly", "calculate_age_at_submission", "none"]

DEMO_REVIEWER = "Demo reviewer"


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


# --- Inputs -------------------------------------------------------------------


class Requirement(BaseModel):
    id: str
    text: str
    line: int


class DictionaryField(BaseModel):
    field_name: str
    data_type: str
    description: str = ""
    unit: str = ""
    sample_value: str = ""


class TargetField(BaseModel):
    name: str
    data_type: str
    unit: str
    required: bool = True
    description: str
    # Semantic tags used by deterministic checks (not by the AI).
    income_basis: Literal["gross", "net"] | None = None
    is_consent_time: bool = False


# Destination workflow definition for the fictional Northstar Lending integration.
TARGET_FIELDS: list[TargetField] = [
    TargetField(
        name="monthly_gross_income_gbp",
        data_type="number",
        unit="GBP/month",
        description="Applicant's gross (pre-deduction) income per month, in pounds sterling.",
        income_basis="gross",
    ),
    TargetField(
        name="applicant_age_years",
        data_type="integer",
        unit="years",
        description="Applicant's age in completed years on the application submission date.",
    ),
    TargetField(
        name="consent_timestamp",
        data_type="datetime",
        unit="UTC",
        description="Exact date and time at which the applicant gave consent.",
        is_consent_time=True,
    ),
]

PROJECT = {
    "customer": "Northstar Lending (fictional)",
    "objective": "Connect an affordability data feed to a credit-decisioning workflow.",
}


# --- AI mapping contract ------------------------------------------------------
# The live model must return exactly this shape. Unknown keys, unknown
# transformations and the "Approved" status are rejected by validation.


class MappingProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirement_id: str
    target_field: str
    source_fields: list[str]
    transformation_id: TransformationId
    evidence_quote: str
    reasoning: str
    assumptions: list[str]
    status: ProposalStatus


class MappingBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mappings: list[MappingProposal]
    open_questions: list[str]


# --- Working state --------------------------------------------------------------


class Mapping(BaseModel):
    """A mapping under review. Deliberately looser than MappingProposal so that
    rule checks, not the type system, report problems such as an unknown
    transformation identifier."""

    requirement_id: str
    target_field: str
    source_fields: list[str] = Field(default_factory=list)
    transformation_id: str = "none"
    evidence_quote: str = ""
    reasoning: str = ""
    assumptions: list[str] = Field(default_factory=list)
    proposed_status: ProposalStatus | None = None  # the AI's own view; cleared once a reviewer edits
    decision: Decision = "Pending"
    decided_at: datetime | None = None
    origin: Literal["demo", "live_ai", "placeholder"] = "demo"
    edited_by_reviewer: bool = False
    revision: int = 0

    @classmethod
    def from_proposal(cls, p: MappingProposal, origin: str) -> "Mapping":
        return cls(
            requirement_id=p.requirement_id,
            target_field=p.target_field,
            source_fields=list(p.source_fields),
            transformation_id=p.transformation_id,
            evidence_quote=p.evidence_quote,
            reasoning=p.reasoning,
            assumptions=list(p.assumptions),
            proposed_status=p.status,
            origin=origin,
        )


class CheckResult(BaseModel):
    number: int
    name: str
    status: CheckStatus
    checked: str  # plain-language description of what was checked
    evidence: str  # the evidence or sample value used
    remediation: str | None = None


class Preview(BaseModel):
    inputs: list[tuple[str, str]] = Field(default_factory=list)  # (field, sample value)
    output: str | None = None
    error: str | None = None


class MappingEvaluation(BaseModel):
    status: str  # one of MAPPING_STATUSES
    checks: list[CheckResult]
    preview: Preview
    reasons: list[str]  # short explanation of why the status is what it is


class AuditEvent(BaseModel):
    timestamp: datetime
    actor: str
    action: str
    target_field: str | None = None
    previous_value: str | None = None
    new_value: str | None = None


class OpenQuestion(BaseModel):
    id: int
    text: str
    raised_by: str
    resolved: bool = False
