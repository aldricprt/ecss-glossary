#!/usr/bin/env python3
"""Parse le fichier `ecss_glossaire.txt` (CSV) et produit `data/glossary.json`.

Usage:
  python tools/parse_glossary.py [path/to/ecss_glossaire.txt] [output/path]
"""
import csv
import json
import os
import sys


def main(input_path=None, output_path=None):
    if input_path is None:
        # default: repository root / ecss_glossaire.txt
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        input_path = os.path.join(repo_root, 'ecss_glossaire.txt')

    if output_path is None:
        output_path = os.path.join(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')), 'data', 'glossary.json')

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    items = []
    with open(input_path, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            # Normalize keys
            typ = row.get('Type') or row.get('type') or ''
            ident = row.get('Identifiant') or row.get('identifiant') or ''
            term = row.get('Terme/Abréviation') or row.get('Terme') or row.get('terme') or ''
            definition = row.get('Définition/Signification') or row.get('Définition') or row.get('definition') or ''

            item = {
                'type': typ.strip(),
                'id': ident.strip(),
                'term': term.strip(),
                'definition': definition.strip(),
            }
            items.append(item)

    # write JSON
    with open(output_path, 'w', encoding='utf-8') as out:
        json.dump(items, out, ensure_ascii=False, indent=2)

    # summary
    cnt_terms = sum(1 for it in items if it['type'].lower().startswith('ter'))
    cnt_abbr = sum(1 for it in items if it['type'].lower().startswith('abr'))
    print(f'Parsed {len(items)} entries ({cnt_terms} terms, {cnt_abbr} abbreviations).')
    print(f'Wrote {output_path}')


if __name__ == '__main__':
    inp = sys.argv[1] if len(sys.argv) > 1 else None
    outp = sys.argv[2] if len(sys.argv) > 2 else None
    main(inp, outp)
