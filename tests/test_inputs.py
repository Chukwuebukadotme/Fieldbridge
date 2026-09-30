import pytest

from inputs import parse_dictionary, parse_requirements


@pytest.mark.parametrize(
    "raw, message",
    [
        (b"", "empty"),
        (b"\xff\xfe\x00bad", "UTF-8"),
        (b"name,type\nincome,number\n", "Missing required column"),
        (b'field_name,data_type\n"unterminated,number\n', "could not be parsed"),
    ],
)
def test_malformed_dictionary_fails_with_a_message_instead_of_crashing(raw, message):
    result = parse_dictionary("bad.csv", raw)
    assert not result.ok and message in result.error


def test_requirements_without_identifiers_fall_back_to_line_ids():
    result = parse_requirements("notes.txt", b"Income must be monthly.\n\nAge is needed.\n")
    assert result.ok and [r.id for r in result.requirements] == ["P1", "P2"]
    assert result.warnings
