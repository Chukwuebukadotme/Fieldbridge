"""Approved transformation registry.

The AI may only *select* one of these identifiers. Trusted code below performs
the transformation. Nothing here evaluates model-generated text.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable

ANY_TYPE = frozenset({"number", "integer", "string", "date", "datetime", "boolean"})
NUMERIC = frozenset({"number", "integer"})


class TransformationError(ValueError):
    """The transformation could not run against the supplied value."""


class UnknownTransformationError(TransformationError):
    """The identifier is not in the approved registry."""


# --- Implementations -----------------------------------------------------------


def identity(value: Any) -> Any:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise TransformationError("Value is blank; identity will not substitute a default.")
    return value


def _to_number(value: Any) -> float:
    if isinstance(value, bool):
        raise TransformationError("Boolean is not a numeric amount.")
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip().replace(",", "")
        if not text:
            raise TransformationError("Value is blank; it will not be treated as zero.")
        try:
            number = float(text)
        except ValueError:
            raise TransformationError(f"'{value}' is not a number.") from None
    if math.isnan(number) or math.isinf(number):
        raise TransformationError(f"'{value}' is not a finite number.")
    return number


def annual_to_monthly(annual_value: Any) -> float:
    """Divide a numeric annual amount by 12. No rounding is applied."""
    return _to_number(annual_value) / 12


def _to_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        raise TransformationError(f"'{value}' is not an ISO date (YYYY-MM-DD).") from None


def _to_utc_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).strip())
        except ValueError:
            raise TransformationError(f"'{value}' is not an ISO 8601 date-time.") from None
    if dt.tzinfo is None:
        raise TransformationError(f"'{value}' has no timezone, so the submission date is ambiguous.")
    return dt.astimezone(timezone.utc)


def calculate_age_at_submission(date_of_birth: Any, submitted_at: Any) -> int:
    """Completed years between date of birth and the UTC calendar date of submission.

    The birthday counts once its month and day have been reached. A 29 February
    birthday is therefore reached on 1 March in non-leap years.
    """
    dob = _to_date(date_of_birth)
    submitted = _to_utc_datetime(submitted_at).date()
    if dob > submitted:
        raise TransformationError("Date of birth is after the submission date.")
    birthday_not_reached = (submitted.month, submitted.day) < (dob.month, dob.day)
    return submitted.year - dob.year - int(birthday_not_reached)


# --- Registry --------------------------------------------------------------------


@dataclass(frozen=True)
class TestTemplate:
    case: str
    given: str
    expect: str


@dataclass(frozen=True)
class TransformationSpec:
    id: str
    label: str
    formula: str
    input_roles: tuple[str, ...]
    input_types: tuple[frozenset[str], ...]
    output_type: str | None  # None: same type as the single input
    unit_rule: str  # "same" | "annual_to_monthly" | "years" | "none"
    requires_confirmation: bool
    func: Callable[..., Any] | None
    assumptions: tuple[str, ...] = ()
    tests: tuple[TestTemplate, ...] = field(default_factory=tuple)


REGISTRY: dict[str, TransformationSpec] = {
    "identity": TransformationSpec(
        id="identity",
        label="Identity (copy value)",
        formula="target = source",
        input_roles=("Source value",),
        input_types=(ANY_TYPE,),
        output_type=None,
        unit_rule="same",
        requires_confirmation=False,
        func=identity,
        tests=(
            TestTemplate("Sample record", "{src0} = {sample0}", "{target} = {sample_out}"),
            TestTemplate("Blank value", "{src0} is blank", "Record flagged; no default substituted"),
        ),
    ),
    "annual_to_monthly": TransformationSpec(
        id="annual_to_monthly",
        label="Annual to monthly (÷ 12)",
        formula="target = source ÷ 12",
        input_roles=("Annual amount",),
        input_types=(NUMERIC,),
        output_type="number",
        unit_rule="annual_to_monthly",
        requires_confirmation=True,
        func=annual_to_monthly,
        assumptions=("The source amount covers a full 12-month period.",),
        tests=(
            TestTemplate("Sample record", "{src0} = {sample0}", "{target} = {sample_out}"),
            TestTemplate("Zero income", "{src0} = 0", "{target} = 0"),
            TestTemplate("Not divisible by 12", "{src0} = 1000", "{target} = 83.333… (unrounded; confirm rounding rule)"),
            TestTemplate("Non-numeric value", "{src0} = 'unknown'", "Record rejected; never coerced to 0"),
            TestTemplate("Blank value", "{src0} is blank", "Record rejected; never treated as 0"),
        ),
    ),
    "calculate_age_at_submission": TransformationSpec(
        id="calculate_age_at_submission",
        label="Age at submission (completed years)",
        formula="target = completed years from date_of_birth to UTC date of submitted_at",
        input_roles=("Date of birth", "Submission timestamp"),
        input_types=(frozenset({"date"}), frozenset({"datetime"})),
        output_type="integer",
        unit_rule="years",
        requires_confirmation=True,
        func=calculate_age_at_submission,
        assumptions=(
            "The submission date is the UTC calendar date of the submission timestamp.",
            "A 29 February birthday is reached on 1 March in non-leap years.",
        ),
        tests=(
            TestTemplate("Sample record", "{src0} = {sample0}, {src1} = {sample1}", "{target} = {sample_out}"),
            TestTemplate("Birthday not yet reached", "{src0} = 2008-09-02, {src1} = 2026-09-01T10:30:00Z", "{target} = 17"),
            TestTemplate("Birthday on submission date", "{src0} = 2008-09-01, {src1} = 2026-09-01T10:30:00Z", "{target} = 18"),
            TestTemplate("Leap-day birthday, non-leap year", "{src0} = 2008-02-29, {src1} = 2026-02-28T12:00:00Z", "{target} = 17"),
            TestTemplate("Offset timestamp near midnight", "{src0} = 2008-09-01, {src1} = 2026-09-01T00:30:00+01:00", "{target} = 17 (UTC date is 31 Aug)"),
            TestTemplate("Date of birth after submission", "{src0} = 2027-01-01, {src1} = 2026-09-01T10:30:00Z", "Record rejected"),
        ),
    ),
    "none": TransformationSpec(
        id="none",
        label="None (no valid transformation)",
        formula="No transformation available; target cannot be populated.",
        input_roles=(),
        input_types=(),
        output_type=None,
        unit_rule="none",
        requires_confirmation=False,
        func=None,
        tests=(
            TestTemplate("Source not identified", "No source field", "Blocked; no test can run until a source field is confirmed"),
        ),
    ),
}

APPROVED_IDS: tuple[str, ...] = tuple(REGISTRY)


def get_spec(transformation_id: str) -> TransformationSpec:
    try:
        return REGISTRY[transformation_id]
    except KeyError:
        raise UnknownTransformationError(
            f"'{transformation_id}' is not an approved transformation. Approved: {', '.join(APPROVED_IDS)}."
        ) from None


def apply_transformation(transformation_id: str, values: list[Any]) -> Any:
    spec = get_spec(transformation_id)
    if spec.func is None:
        raise TransformationError("'none' means no valid transformation is available.")
    if len(values) != len(spec.input_roles):
        raise TransformationError(
            f"'{spec.id}' expects {len(spec.input_roles)} input(s) "
            f"({', '.join(spec.input_roles)}); {len(values)} supplied."
        )
    return spec.func(*values)


def format_value(value: Any) -> str:
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)
