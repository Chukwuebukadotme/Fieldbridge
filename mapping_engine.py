"""AI interpretation layer: an optional live OpenAI request, with a saved Demo-mode response as fallback.

The model only proposes. Its output is validated against a strict schema and
structural rules before it is stored; anything malformed is discarded.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from models import DictionaryField, MappingBatch, TargetField
from transformations import APPROVED_IDS

DEMO_MAPPINGS_PATH = Path(__file__).parent / "sample_mappings.json"
DEFAULT_MODEL = "gpt-5-mini"

SYSTEM_PROMPT = f"""You are assisting an integration analyst who is mapping a lender's source data to a \
credit-decisioning workflow's required target fields. You propose mappings; deterministic code checks them and a \
person approves them. You do not make lending or credit decisions.

Return exactly one mapping proposal for every target field supplied, plus any open questions.

Rules:
- Do not invent source fields. Use only field_name values supplied in the data dictionary.
- Quote evidence exactly, character for character, from the requirements text. Do not paraphrase, merge or \
reformat passages. Use the requirement identifier (for example R1) that contains the quote.
- Use only these transformation identifiers: {", ".join(APPROVED_IDS)}. Never write formulas or code.
- For calculate_age_at_submission, list source_fields in this order: date of birth field, submission timestamp field.
- Return a missing mapping (source_fields empty, transformation_id "none", status "Missing") when the evidence \
is insufficient.
- Do not infer consent time from submission time or any other timestamp that does not record consent.
- Do not treat gross and net income as equivalent.
- Do not treat different currencies as equivalent.
- Surface uncertainty as an assumption or an open question.
- status must be one of: Ready, Review required, Missing, Blocked. Never mark a proposal Approved; only a human \
reviewer can approve.
"""


class MappingEngineError(RuntimeError):
    pass


@dataclass
class GenerationResult:
    batch: MappingBatch
    source_label: str  # shown to the user and written into the brief
    origin: str  # "demo" | "live_ai"
    notice: str | None = None  # concise message when live mode fell back


def live_ai_status() -> tuple[bool, str]:
    """Return (available, explanation) without making a network call."""
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY is not set."
    try:
        import openai  # noqa: F401
    except ImportError:
        return False, "The openai package is not installed."
    return True, f"Model: {model_name()}"


def model_name() -> str:
    return os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL


def load_demo_mappings(path: Path = DEMO_MAPPINGS_PATH) -> MappingBatch:
    try:
        return MappingBatch.model_validate_json(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise MappingEngineError(f"Demo response {path.name} was not found.") from None
    except ValidationError as exc:
        raise MappingEngineError(f"Demo response {path.name} is invalid: {exc.error_count()} schema error(s).") from None


def validate_batch(batch: MappingBatch, targets: list[TargetField]) -> list[str]:
    """Structural checks the JSON schema cannot express. Returns a list of problems."""
    problems: list[str] = []
    known = {t.name for t in targets}
    seen: set[str] = set()
    for proposal in batch.mappings:
        if proposal.target_field not in known:
            problems.append(f"Unknown target field '{proposal.target_field}'.")
        elif proposal.target_field in seen:
            problems.append(f"Duplicate proposal for '{proposal.target_field}'.")
        seen.add(proposal.target_field)
    for name in sorted(known - seen):
        problems.append(f"No proposal for target field '{name}'.")
    return problems


def build_user_payload(requirements_text: str, dictionary: list[DictionaryField], targets: list[TargetField]) -> str:
    # Sample values are deliberately withheld: the model does not need record-level data
    # to propose a mapping, and deterministic code runs the samples locally.
    return json.dumps(
        {
            "requirements_text": requirements_text,
            "data_dictionary": [f.model_dump(exclude={"sample_value"}) for f in dictionary],
            "target_fields": [
                {"name": t.name, "data_type": t.data_type, "unit": t.unit, "required": t.required, "description": t.description}
                for t in targets
            ],
            "approved_transformations": list(APPROVED_IDS),
        },
        indent=2,
    )


def request_live_mappings(requirements_text: str, dictionary: list[DictionaryField], targets: list[TargetField]) -> MappingBatch:
    available, why = live_ai_status()
    if not available:
        raise MappingEngineError(why)
    from openai import OpenAI

    client = OpenAI(timeout=60, max_retries=1)  # reads OPENAI_API_KEY from the environment
    try:
        response = client.responses.parse(
            model=model_name(),
            instructions=SYSTEM_PROMPT,
            input=build_user_payload(requirements_text, dictionary, targets),
            text_format=MappingBatch,
        )
    except Exception as exc:  # network, auth, model or schema errors all fall back to Demo mode
        raise MappingEngineError(f"Live request failed ({type(exc).__name__}).") from exc

    parsed = response.output_parsed
    if parsed is None:
        raise MappingEngineError("The model returned no structured output.")
    # Re-validate independently of the SDK helper before anything is stored.
    try:
        batch = MappingBatch.model_validate(parsed.model_dump())
    except ValidationError as exc:
        raise MappingEngineError(f"Malformed response: {exc.error_count()} schema error(s).") from None
    problems = validate_batch(batch, targets)
    if problems:
        raise MappingEngineError("Malformed response: " + " ".join(problems))
    return batch


def generate_mappings(
    use_live_ai: bool,
    requirements_text: str,
    dictionary: list[DictionaryField],
    targets: list[TargetField],
    demo_path: Path = DEMO_MAPPINGS_PATH,
) -> GenerationResult:
    notice = None
    if use_live_ai:
        try:
            batch = request_live_mappings(requirements_text, dictionary, targets)
            return GenerationResult(batch=batch, source_label=f"Live AI ({model_name()})", origin="live_ai")
        except MappingEngineError as exc:
            notice = f"Live AI unavailable: {exc} Continuing in Demo mode."

    batch = load_demo_mappings(demo_path)
    # Keep only proposals for known targets; missing targets are filled with placeholders later.
    known = {t.name for t in targets}
    batch = MappingBatch(mappings=[p for p in batch.mappings if p.target_field in known], open_questions=batch.open_questions)
    return GenerationResult(batch=batch, source_label=f"Demo mode ({demo_path.name})", origin="demo", notice=notice)
