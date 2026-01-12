import json
import pathlib
import sys

import pytest

# ensure repo import works
repo = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo))

from tools import parse_glossary


def test_generated_json_schema(tmp_path):
    """Run the parser and validate the generated JSON has expected keys/types."""
    repo_root = pathlib.Path(__file__).resolve().parents[1]
    input_file = repo_root / 'ecss_glossaire.txt'
    assert input_file.exists(), 'Source glossary file is missing'

    out_file = tmp_path / 'glossary.json'
    # run parser
    parse_glossary.main(str(input_file), str(out_file))

    assert out_file.exists()
    data = json.loads(out_file.read_text(encoding='utf-8'))
    assert isinstance(data, list)
    assert len(data) > 0

    # Validate entries
    for entry in data:
        assert isinstance(entry, dict)
        # required keys
        for k in ('type', 'id', 'term', 'definition'):
            assert k in entry
        assert isinstance(entry['type'], str)
        assert isinstance(entry['id'], str)
        assert isinstance(entry['term'], str)
        assert isinstance(entry['definition'], str)

    # quick sanity: some known words present
    joined = ' '.join(e.get('term','') + ' ' + e.get('definition','') for e in data).lower()
    assert 'ecss' in joined or 'spacecraft' in joined
