from types import SimpleNamespace

import mapping_engine
from mapping_engine import generate_mappings, load_demo_mappings, validate_batch
from models import TARGET_FIELDS, MappingBatch


def test_demo_response_is_valid_and_covers_every_target():
    batch = load_demo_mappings()
    assert validate_batch(batch, TARGET_FIELDS) == []
    assert all(p.status != "Approved" for p in batch.mappings)


def test_live_mode_without_key_falls_back_to_demo(sample_files, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    req, dictionary = sample_files
    result = generate_mappings(True, req.text, dictionary.fields, TARGET_FIELDS)
    assert result.origin == "demo"
    assert "OPENAI_API_KEY" in result.notice


def _fake_openai(monkeypatch, parsed, captured):
    import openai

    class FakeResponses:
        def parse(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_parsed=parsed)

    class FakeClient:
        def __init__(self, **_):
            self.responses = FakeResponses()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(openai, "OpenAI", FakeClient)


def test_malformed_live_output_is_rejected_and_falls_back(sample_files, monkeypatch):
    req, dictionary = sample_files
    # Schema-valid, but omits two targets and invents a third.
    bad = MappingBatch.model_validate({
        "mappings": [{
            "requirement_id": "R9", "target_field": "credit_score", "source_fields": [], "transformation_id": "none",
            "evidence_quote": "", "reasoning": "", "assumptions": [], "status": "Missing",
        }],
        "open_questions": [],
    })
    _fake_openai(monkeypatch, bad, {})
    result = generate_mappings(True, req.text, dictionary.fields, TARGET_FIELDS)
    assert result.origin == "demo"
    assert "Unknown target field 'credit_score'" in result.notice


def test_valid_live_output_is_used_and_samples_are_withheld(sample_files, monkeypatch):
    req, dictionary = sample_files
    captured = {}
    _fake_openai(monkeypatch, load_demo_mappings(), captured)
    result = generate_mappings(True, req.text, dictionary.fields, TARGET_FIELDS)
    assert result.origin == "live_ai" and result.notice is None
    assert captured["text_format"] is MappingBatch
    assert "48000" not in captured["input"] and "annual_gross_income_gbp" in captured["input"]


def test_prompt_states_the_guardrails():
    prompt = mapping_engine.SYSTEM_PROMPT
    for phrase in ["Do not invent source fields", "exactly", "Do not infer consent time from submission time",
                   "gross and net", "different currencies", "Never mark a proposal Approved"]:
        assert phrase in prompt
