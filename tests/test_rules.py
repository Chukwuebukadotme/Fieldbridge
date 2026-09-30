import pytest

from models import APPROVED, BLOCKED, MISSING, REVIEW, DictionaryField
from review import approve, correct, reject, risk_sorted
from rules import evaluate_mapping


def check(evaluation, number):
    return next(c for c in evaluation.checks if c.number == number)


def test_sample_produces_expected_outcomes_in_risk_order(workspace):
    evaluations = workspace.evaluate()
    ordered = [m.target_field for m in risk_sorted(workspace, evaluations)]
    assert ordered[0] == "consent_timestamp"
    assert evaluations["consent_timestamp"].status == MISSING
    assert evaluations["monthly_gross_income_gbp"].status == REVIEW
    assert evaluations["monthly_gross_income_gbp"].preview.output == "4000"
    assert evaluations["applicant_age_years"].status == REVIEW
    assert evaluations["applicant_age_years"].preview.output == "34"


def test_missing_source_field_is_reported_missing(workspace):
    evaluation = workspace.evaluate()["consent_timestamp"]
    assert check(evaluation, 1).status == MISSING


def test_source_field_not_in_dictionary_is_blocked(workspace):
    correct(workspace, "monthly_gross_income_gbp", ["annual_income_invented"], "annual_to_monthly")
    evaluation = workspace.evaluate()["monthly_gross_income_gbp"]
    assert check(evaluation, 2).status == BLOCKED
    assert evaluation.status == BLOCKED


def test_unverifiable_evidence_quote_is_blocked(workspace):
    mapping = workspace.mapping("monthly_gross_income_gbp")
    mapping.evidence_quote = "Decisioning requires monthly net income in GBP."  # paraphrased, not in the document
    evaluation = evaluate_mapping(mapping, workspace.context())
    assert check(evaluation, 5).status == BLOCKED
    assert evaluation.status == BLOCKED


def test_unknown_transformation_blocks_mapping(workspace):
    mapping = workspace.mapping("monthly_gross_income_gbp")
    mapping.transformation_id = "divide_by_12_generated"
    evaluation = evaluate_mapping(mapping, workspace.context())
    assert check(evaluation, 4).status == BLOCKED
    assert evaluation.preview.output is None


def test_submitted_at_is_never_accepted_as_consent_timestamp(workspace):
    correct(workspace, "consent_timestamp", ["submitted_at"], "identity")
    evaluation = workspace.evaluate()["consent_timestamp"]
    assert check(evaluation, 9).status == BLOCKED
    assert evaluation.status == BLOCKED
    with pytest.raises(ValueError):
        approve(workspace, "consent_timestamp")


def test_net_income_is_not_accepted_for_gross_target(workspace):
    workspace.dictionary.append(
        DictionaryField(field_name="annual_net_income_gbp", data_type="number",
                        description="Annual take-home pay after tax", unit="GBP/year", sample_value="36000")
    )
    correct(workspace, "monthly_gross_income_gbp", ["annual_net_income_gbp"], "annual_to_monthly")
    evaluation = workspace.evaluate()["monthly_gross_income_gbp"]
    assert check(evaluation, 7).status == BLOCKED


def test_different_currency_is_blocked(workspace):
    workspace.dictionary.append(
        DictionaryField(field_name="annual_gross_income_eur", data_type="number",
                        description="Annual gross income before deductions", unit="EUR/year", sample_value="56000")
    )
    correct(workspace, "monthly_gross_income_gbp", ["annual_gross_income_eur"], "annual_to_monthly")
    assert check(workspace.evaluate()["monthly_gross_income_gbp"], 6).status == BLOCKED


def test_approval_edit_and_rejection_are_audited(workspace):
    approve(workspace, "monthly_gross_income_gbp")
    assert workspace.evaluate()["monthly_gross_income_gbp"].status == APPROVED

    # Editing an approved mapping resets it to Pending, and checks re-run.
    correct(workspace, "monthly_gross_income_gbp", ["annual_gross_income_gbp"], "identity")
    evaluation = workspace.evaluate()["monthly_gross_income_gbp"]
    assert workspace.mapping("monthly_gross_income_gbp").decision == "Pending"
    assert check(evaluation, 6).status == BLOCKED  # annual value would land in a monthly field

    reject(workspace, "applicant_age_years", "Confirm timezone first")
    assert workspace.evaluate()["applicant_age_years"].status == BLOCKED

    actions = [e.action for e in workspace.audit]
    assert actions == [
        "Generated mapping proposals",
        "Approved mapping",
        "Changed transformation",
        "Decision reset after edit",
        "Rejected mapping",
    ]
    change = workspace.audit[2]
    assert (change.previous_value, change.new_value, change.actor) == ("annual_to_monthly", "identity", "Demo reviewer")
