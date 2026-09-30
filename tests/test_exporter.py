from exporter import build_brief
from review import add_question, approve


def test_brief_retains_open_questions_audit_and_not_ready_state(workspace):
    approve(workspace, "monthly_gross_income_gbp")
    add_question(workspace, "Is income verified or self-declared?")
    brief = build_brief(workspace)

    assert "NOT READY FOR BUILD" in brief
    assert "Which source field records the exact consent time, and in which timezone?" in brief
    assert "Is income verified or self-declared?" in brief
    assert "consent_timestamp: no source field satisfies R3" in brief
    # Audit history section includes the approval event.
    audit = brief.split("## 11. Audit history")[1]
    assert "Approved mapping" in audit and "Demo reviewer" in audit and "monthly_gross_income_gbp" in audit
    # Approved and unapproved mappings are separated.
    approved_section = brief.split("## 3. Approved mappings")[1].split("## 4.")[0]
    assert "monthly_gross_income_gbp" in approved_section
    assert "consent_timestamp" not in approved_section
    for heading in ["Transformation formulas", "Requirement evidence", "Assumptions", "Readiness-check results",
                    "Initial test plan", "Prototype limitations"]:
        assert heading in brief
