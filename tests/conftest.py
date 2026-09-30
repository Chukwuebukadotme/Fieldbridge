from pathlib import Path

import pytest

from inputs import parse_dictionary, parse_requirements
from mapping_engine import generate_mappings
from models import TARGET_FIELDS
from review import build_workspace

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def sample_files():
    req = parse_requirements("sample_requirements.txt", (ROOT / "sample_requirements.txt").read_bytes(), "sample")
    dictionary = parse_dictionary("sample_data_dictionary.csv", (ROOT / "sample_data_dictionary.csv").read_bytes(), "sample")
    return req, dictionary


@pytest.fixture
def workspace(sample_files, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    req, dictionary = sample_files
    result = generate_mappings(False, req.text, dictionary.fields, TARGET_FIELDS)
    return build_workspace(req, dictionary, TARGET_FIELDS, result)
