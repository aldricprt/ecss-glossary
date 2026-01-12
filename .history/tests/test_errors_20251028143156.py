import json
import pathlib
import sys
import os

# Ensure repository root is on sys.path so `from tools import parse_glossary` works
repo = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo))

from tools import parse_glossary


def test_missing_input_raises(tmp_path):
    # point to a non-existing file
    missing = tmp_path / 'no_such_file.csv'
    outp = tmp_path / 'out.json'
    try:
        parse_glossary.main(str(missing), str(outp))
        # if no exception, that's unexpected
        assert False, 'Expected FileNotFoundError for missing input file'
    except FileNotFoundError:
        pass


def test_malformed_csv_is_tolerated(tmp_path):
    # create a CSV with headers that don't match expected columns
    inp = tmp_path / 'malformed.csv'
    inp.write_text('A,B,C\n1,2,3\n')
    outp = tmp_path / 'out.json'
    # should not raise
    parse_glossary.main(str(inp), str(outp))
    assert outp.exists()
    data = json.loads(outp.read_text(encoding='utf-8'))
    assert isinstance(data, list)
    # there should be one entry (the row), even if fields are empty
    assert len(data) == 1
    item = data[0]
    assert set(item.keys()) >= {'type', 'id', 'term', 'definition'}
