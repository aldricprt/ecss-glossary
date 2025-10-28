import json
import os
import pathlib

from tools import parse_glossary


def test_parse_creates_json_and_contains_known_entries(tmp_path):
    repo = pathlib.Path(__file__).resolve().parents[1]
    input_path = repo / 'ecss_glossaire.txt'
    assert input_path.exists(), f"Input file not found: {input_path}"

    out_file = tmp_path / 'glossary.json'
    # run parser
    parse_glossary.main(str(input_path), str(out_file))

    assert out_file.exists(), 'Output JSON was not created'
    data = json.loads(out_file.read_text(encoding='utf-8'))
    assert isinstance(data, list)
    assert len(data) > 0

    # Check for some expected entries
    has_ecss = any(it.get('term') == 'ECSS' and it.get('type', '').lower().startswith('abr') for it in data)
    has_spacecraft = any('spacecraft' in (it.get('term','').lower() + it.get('definition','').lower()) for it in data)

    assert has_ecss, 'Expected abbreviation "ECSS" not found in parsed data'
    assert has_spacecraft, 'Expected term/definition containing "spacecraft" not found'
