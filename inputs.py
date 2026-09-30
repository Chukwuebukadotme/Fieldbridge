"""Parsing of the two supported inputs: a plain-text requirements document and a CSV data dictionary."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

import pandas as pd

from models import DictionaryField, Requirement

REQUIRED_COLUMNS = ("field_name", "data_type")
OPTIONAL_COLUMNS = ("description", "unit", "sample_value")
REQUIREMENT_LINE = re.compile(r"^\s*([A-Z]{1,4}-?\d+)\s*[:.)\-–]\s*(\S.*?)\s*$")


@dataclass
class LoadedFile:
    name: str
    kind: str  # "requirements" | "dictionary"
    file_type: str
    origin: str  # "sample" | "upload"
    ok: bool
    count: int = 0
    error: str | None = None
    warnings: list[str] = field(default_factory=list)
    text: str = ""
    requirements: list[Requirement] = field(default_factory=list)
    fields: list[DictionaryField] = field(default_factory=list)


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")


def parse_requirements(name: str, raw: bytes, origin: str = "upload") -> LoadedFile:
    result = LoadedFile(name=name, kind="requirements", file_type="Plain text (.txt)", origin=origin, ok=False)
    try:
        text = _decode(raw)
    except UnicodeDecodeError:
        result.error = "The file is not valid UTF-8 text."
        return result
    if not text.strip():
        result.error = "The file is empty."
        return result

    result.text = text
    requirements: list[Requirement] = []
    seen: set[str] = set()
    for line_no, line in enumerate(text.split("\n"), start=1):
        match = REQUIREMENT_LINE.match(line)
        if not match:
            continue
        req_id, body = match.groups()
        if req_id in seen:
            result.warnings.append(f"Duplicate requirement identifier {req_id} on line {line_no}; first kept.")
            continue
        seen.add(req_id)
        requirements.append(Requirement(id=req_id, text=body, line=line_no))

    if not requirements:
        # Fall back to one requirement per non-empty line so evidence can still be quoted.
        for line_no, line in enumerate(text.split("\n"), start=1):
            if line.strip():
                requirements.append(Requirement(id=f"P{len(requirements) + 1}", text=line.strip(), line=line_no))
        result.warnings.append("No 'R1:'-style identifiers found; each non-empty line was treated as a requirement (P1, P2, …).")

    result.requirements = requirements
    result.count = len(requirements)
    result.ok = True
    return result


def parse_dictionary(name: str, raw: bytes, origin: str = "upload") -> LoadedFile:
    result = LoadedFile(name=name, kind="dictionary", file_type="CSV (.csv)", origin=origin, ok=False)
    try:
        text = _decode(raw)
    except UnicodeDecodeError:
        result.error = "The file is not valid UTF-8 text."
        return result
    if not text.strip():
        result.error = "The file is empty."
        return result
    try:
        frame = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, skipinitialspace=True)
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
        result.error = f"The CSV could not be parsed: {str(exc).splitlines()[0]}"
        return result

    frame.columns = [str(c).strip().lower() for c in frame.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        result.error = (
            f"Missing required column(s): {', '.join(missing)}. "
            f"Expected: {', '.join(REQUIRED_COLUMNS + OPTIONAL_COLUMNS)}."
        )
        return result
    for column in OPTIONAL_COLUMNS:
        if column not in frame.columns:
            frame[column] = ""
            result.warnings.append(f"Column '{column}' not found; treated as blank.")

    fields: list[DictionaryField] = []
    seen: set[str] = set()
    for row_no, row in enumerate(frame.to_dict("records"), start=2):
        field_name = str(row["field_name"]).strip()
        if not field_name:
            result.warnings.append(f"Row {row_no} has no field_name and was skipped.")
            continue
        if field_name in seen:
            result.warnings.append(f"Duplicate field '{field_name}' on row {row_no}; first kept.")
            continue
        seen.add(field_name)
        fields.append(
            DictionaryField(
                field_name=field_name,
                data_type=str(row["data_type"]).strip().lower(),
                description=str(row["description"]).strip(),
                unit=str(row["unit"]).strip(),
                sample_value=str(row["sample_value"]).strip(),
            )
        )

    if not fields:
        result.error = "The dictionary contains no field records."
        return result
    result.fields = fields
    result.count = len(fields)
    result.ok = True
    return result
