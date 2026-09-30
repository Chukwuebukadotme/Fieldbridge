"""Session workspace and reviewer actions. Every reviewer action appends an audit event."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from inputs import LoadedFile
from mapping_engine import GenerationResult
from models import (
    APPROVED,
    BLOCKED,
    DEMO_REVIEWER,
    MISSING,
    PROJECT,
    READY,
    REVIEW,
    RISK_ORDER,
    AuditEvent,
    DictionaryField,
    Mapping,
    MappingEvaluation,
    OpenQuestion,
    Requirement,
    TargetField,
    now_utc,
)
from rules import RuleContext, can_approve, evaluate_mapping, is_submission_time
from transformations import REGISTRY, apply_transformation, format_value


class InputFileSummary(BaseModel):
    name: str
    file_type: str
    origin: str
    count: int
    status: str


class Workspace(BaseModel):
    customer: str = PROJECT["customer"]
    objective: str = PROJECT["objective"]
    mapping_source: str
    created_at: datetime = Field(default_factory=now_utc)
    input_files: list[InputFileSummary]
    requirements_name: str
    dictionary_name: str
    requirements_text: str
    requirements: list[Requirement]
    dictionary: list[DictionaryField]
    targets: list[TargetField]
    mappings: list[Mapping]
    open_questions: list[OpenQuestion] = Field(default_factory=list)
    audit: list[AuditEvent] = Field(default_factory=list)

    # --- lookups -------------------------------------------------------------

    def context(self) -> RuleContext:
        return RuleContext(
            requirements_text=self.requirements_text,
            requirements={r.id: r for r in self.requirements},
            dictionary={f.field_name: f for f in self.dictionary},
            targets={t.name: t for t in self.targets},
            requirements_name=self.requirements_name,
            dictionary_name=self.dictionary_name,
        )

    def mapping(self, target: str) -> Mapping:
        return next(m for m in self.mappings if m.target_field == target)

    def evaluate(self) -> dict[str, MappingEvaluation]:
        ctx = self.context()
        return {m.target_field: evaluate_mapping(m, ctx) for m in self.mappings}

    def log(self, action: str, target: str | None = None, previous: str | None = None, new: str | None = None, actor: str = DEMO_REVIEWER) -> None:
        self.audit.append(
            AuditEvent(timestamp=now_utc(), actor=actor, action=action, target_field=target, previous_value=previous, new_value=new)
        )


def _summary(f: LoadedFile) -> InputFileSummary:
    return InputFileSummary(
        name=f.name,
        file_type=f.file_type,
        origin="Fictional sample" if f.origin == "sample" else "Uploaded",
        count=f.count,
        status="Parsed" if f.ok else f"Failed: {f.error}",
    )


def build_workspace(req: LoadedFile, dictionary: LoadedFile, targets: list[TargetField], result: GenerationResult) -> Workspace:
    by_target = {p.target_field: p for p in result.batch.mappings}
    mappings: list[Mapping] = []
    for t in targets:
        proposal = by_target.get(t.name)
        if proposal:
            mappings.append(Mapping.from_proposal(proposal, result.origin))
        else:
            # Guarantee one mapping per required target, even when the proposal set omits one.
            mappings.append(
                Mapping(
                    requirement_id="",
                    target_field=t.name,
                    reasoning="No proposal was returned for this target field.",
                    origin="placeholder",
                    proposed_status="Missing",
                )
            )
    ws = Workspace(
        mapping_source=result.source_label,
        input_files=[_summary(req), _summary(dictionary)],
        requirements_name=req.name,
        dictionary_name=dictionary.name,
        requirements_text=req.text,
        requirements=req.requirements,
        dictionary=dictionary.fields,
        targets=targets,
        mappings=mappings,
        open_questions=[
            OpenQuestion(id=i + 1, text=q, raised_by="AI proposal") for i, q in enumerate(result.batch.open_questions)
        ],
    )
    actor = "FieldBridge (Live AI)" if result.origin == "live_ai" else "FieldBridge (Demo mode)"
    ws.log("Generated mapping proposals", new=f"{len(mappings)} proposals from {result.source_label}", actor=actor)
    return ws


# --- Ordering and navigation ---------------------------------------------------------


def risk_sorted(ws: Workspace, evaluations: dict[str, MappingEvaluation]) -> list[Mapping]:
    position = {t.name: i for i, t in enumerate(ws.targets)}
    return sorted(ws.mappings, key=lambda m: (RISK_ORDER[evaluations[m.target_field].status], position[m.target_field]))


def unresolved(ws: Workspace, evaluations: dict[str, MappingEvaluation]) -> list[Mapping]:
    return [m for m in risk_sorted(ws, evaluations) if evaluations[m.target_field].status != APPROVED]


def next_issue(ws: Workspace, evaluations: dict[str, MappingEvaluation], current: str | None) -> str | None:
    queue = [m.target_field for m in unresolved(ws, evaluations)]
    if not queue:
        return None
    if current in queue:
        return queue[(queue.index(current) + 1) % len(queue)]
    return queue[0]


# --- Reviewer actions ------------------------------------------------------------------


def approve(ws: Workspace, target: str) -> None:
    mapping = ws.mapping(target)
    evaluation = evaluate_mapping(mapping, ws.context())
    if not can_approve(evaluation, mapping):
        raise ValueError(f"{target} cannot be approved while its status is {evaluation.status}.")
    previous = mapping.decision
    mapping.decision = "Approved"
    mapping.decided_at = now_utc()
    ws.log("Approved mapping", target, previous, "Approved")


def reject(ws: Workspace, target: str, reason: str = "") -> None:
    mapping = ws.mapping(target)
    previous = mapping.decision
    mapping.decision = "Rejected"
    mapping.decided_at = now_utc()
    ws.log("Rejected mapping", target, previous, f"Rejected: {reason.strip()}" if reason.strip() else "Rejected")


def correct(ws: Workspace, target: str, source_fields: list[str], transformation_id: str, requirement_id: str | None = None) -> bool:
    """Apply a reviewer correction. Returns True if anything changed."""
    mapping = ws.mapping(target)
    changed = False
    if list(source_fields) != mapping.source_fields:
        ws.log("Changed source fields", target, ", ".join(mapping.source_fields) or "(none)", ", ".join(source_fields) or "(none)")
        mapping.source_fields = list(source_fields)
        changed = True
    if transformation_id != mapping.transformation_id:
        ws.log("Changed transformation", target, mapping.transformation_id, transformation_id)
        mapping.transformation_id = transformation_id
        changed = True
    if requirement_id and requirement_id != mapping.requirement_id:
        requirement = next(r for r in ws.requirements if r.id == requirement_id)
        ws.log("Changed requirement evidence", target, f"{mapping.requirement_id}: {mapping.evidence_quote}", f"{requirement.id}: {requirement.text}")
        mapping.requirement_id = requirement.id
        mapping.evidence_quote = requirement.text  # exact passage from the parsed document
        changed = True
    if not changed:
        return False
    mapping.edited_by_reviewer = True
    mapping.proposed_status = None  # the AI's view no longer describes this mapping
    mapping.revision += 1
    if mapping.decision != "Pending":
        ws.log("Decision reset after edit", target, mapping.decision, "Pending")
        mapping.decision = "Pending"
        mapping.decided_at = None
    return True


def set_question_resolved(ws: Workspace, question_id: int, resolved: bool) -> None:
    question = next(q for q in ws.open_questions if q.id == question_id)
    if question.resolved == resolved:
        return
    question.resolved = resolved
    ws.log("Resolved open question" if resolved else "Reopened open question", previous=None, new=question.text)


def add_question(ws: Workspace, text: str) -> None:
    text = text.strip()
    if not text:
        return
    next_id = max((q.id for q in ws.open_questions), default=0) + 1
    ws.open_questions.append(OpenQuestion(id=next_id, text=text, raised_by=DEMO_REVIEWER))
    ws.log("Added open question", new=text)


# --- Derived content ---------------------------------------------------------------------


def rule_questions(ws: Workspace, evaluations: dict[str, MappingEvaluation]) -> list[str]:
    """Open questions raised by deterministic checks. They disappear when the finding is fixed."""
    questions = []
    for m in risk_sorted(ws, evaluations):
        ev = evaluations[m.target_field]
        if ev.status == MISSING:
            questions.append(f"{m.target_field}: no source field satisfies {m.requirement_id or 'this requirement'}. Which field should supply it?")
        elif ev.status == BLOCKED:
            questions.append(f"{m.target_field} is blocked. {ev.reasons[0] if ev.reasons else ''}".strip())
    return questions


def readiness(ws: Workspace, evaluations: dict[str, MappingEvaluation]) -> tuple[bool, str]:
    required = [m for m in ws.mappings if next(t for t in ws.targets if t.name == m.target_field).required]
    open_items = [m for m in required if evaluations[m.target_field].status != APPROVED]
    open_questions = [q for q in ws.open_questions if not q.resolved]
    if not open_items and not open_questions:
        return True, f"All {len(required)} required mappings are approved and no open questions remain."
    counts: dict[str, int] = {}
    for m in open_items:
        counts[evaluations[m.target_field].status] = counts.get(evaluations[m.target_field].status, 0) + 1
    parts = [f"{n} {status.lower()}" for status, n in sorted(counts.items(), key=lambda kv: RISK_ORDER[kv[0]])]
    if open_questions:
        parts.append(f"{len(open_questions)} open question{'s' if len(open_questions) != 1 else ''}")
    return False, f"{len(open_items)} of {len(required)} required mappings unresolved ({', '.join(parts)})."


def build_test_plan(ws: Workspace) -> list[dict[str, str]]:
    """Initial test cases from deterministic templates attached to each transformation."""
    ctx = ws.context()
    rows: list[dict[str, str]] = []
    for m in ws.mappings:
        spec = REGISTRY.get(m.transformation_id)
        if spec is None:
            rows.append({"Target": m.target_field, "Case": "Unregistered transformation", "Given": m.transformation_id, "Expect": "Blocked; no test generated"})
            continue
        values = {f"src{i}": name for i, name in enumerate(m.source_fields)}
        samples = [ctx.dictionary[f].sample_value if f in ctx.dictionary else "" for f in m.source_fields]
        values.update({f"sample{i}": v for i, v in enumerate(samples)})
        try:
            values["sample_out"] = format_value(apply_transformation(spec.id, samples)) if spec.func else "—"
        except Exception as exc:  # the sample failing is itself a finding worth recording
            values["sample_out"] = f"error ({exc})"
        values["target"] = m.target_field
        for template in spec.tests:
            try:
                given, expect = template.given.format(**values), template.expect.format(**values)
            except (KeyError, IndexError):
                continue  # template needs inputs this mapping does not have
            rows.append({"Target": m.target_field, "Case": template.case, "Given": given, "Expect": expect})
        target = ctx.targets[m.target_field]
        if target.is_consent_time:
            substitutes = [f.field_name for f in ws.dictionary if is_submission_time(f)]
            if substitutes:
                rows.append(
                    {
                        "Target": m.target_field,
                        "Case": "Submission time never used as consent",
                        "Given": f"{substitutes[0]} populated, consent field absent",
                        "Expect": f"{m.target_field} left empty and record flagged; never copied from {substitutes[0]}",
                    }
                )
        if target.income_basis:
            rows.append(
                {
                    "Target": m.target_field,
                    "Case": "Net income rejected",
                    "Given": "Source described as net / take-home income",
                    "Expect": "Mapping blocked; net is never accepted for a gross target",
                }
            )
    return rows


STATUS_ICONS = {READY: "✓", REVIEW: "!", MISSING: "○", BLOCKED: "✕", APPROVED: "✔"}
