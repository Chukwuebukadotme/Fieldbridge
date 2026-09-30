import pytest
from pydantic import ValidationError

from models import MappingProposal
from transformations import (
    TransformationError,
    UnknownTransformationError,
    annual_to_monthly,
    apply_transformation,
    calculate_age_at_submission,
)


def test_annual_to_monthly_divides_by_twelve():
    assert annual_to_monthly(48000) == 4000
    assert annual_to_monthly("48000") == 4000
    assert annual_to_monthly("1000") == pytest.approx(83.3333, rel=1e-4)


@pytest.mark.parametrize("bad", ["", "unknown", None, True, "nan"])
def test_annual_to_monthly_never_coerces_bad_values_to_zero(bad):
    with pytest.raises(TransformationError):
        annual_to_monthly(bad)


def test_sample_age_is_34():
    assert calculate_age_at_submission("1992-04-17", "2026-09-01T10:30:00Z") == 34


@pytest.mark.parametrize(
    "dob, submitted, expected",
    [
        ("2008-09-02", "2026-09-01T10:30:00Z", 17),  # birthday is tomorrow
        ("2008-09-01", "2026-09-01T10:30:00Z", 18),  # birthday is today
        ("2008-08-31", "2026-09-01T10:30:00Z", 18),  # birthday was yesterday
        ("2008-02-29", "2026-02-28T12:00:00Z", 17),  # leap-day birthday not reached in a non-leap year
        ("2008-02-29", "2026-03-01T12:00:00Z", 18),
    ],
)
def test_age_birthday_boundary(dob, submitted, expected):
    assert calculate_age_at_submission(dob, submitted) == expected


def test_age_uses_utc_submission_date():
    # 00:30 on 1 Sep in UTC+1 is still 31 Aug in UTC, so the birthday has not been reached.
    assert calculate_age_at_submission("2008-09-01", "2026-09-01T00:30:00+01:00") == 17


def test_age_rejects_ambiguous_or_impossible_inputs():
    with pytest.raises(TransformationError):
        calculate_age_at_submission("1992-04-17", "2026-09-01T10:30:00")  # no timezone
    with pytest.raises(TransformationError):
        calculate_age_at_submission("2027-01-01", "2026-09-01T10:30:00Z")


def test_unknown_transformation_is_rejected_by_registry_and_contract():
    with pytest.raises(UnknownTransformationError):
        apply_transformation("eval_formula", ["48000"])
    with pytest.raises(ValidationError):
        MappingProposal(
            requirement_id="R1",
            target_field="monthly_gross_income_gbp",
            source_fields=["annual_gross_income_gbp"],
            transformation_id="x / 12",
            evidence_quote="Decisioning requires monthly gross income in GBP.",
            reasoning="",
            assumptions=[],
            status="Ready",
        )
