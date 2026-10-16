"""Inspect color semantics without changing any production prompt or document."""
from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/qi21-style-type-separation-1016'
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
parser = argparse.ArgumentParser()
parser.add_argument('--reference-part', type=int)
args = parser.parse_args()
reference = next(p for p in (ROOT / 'docs/prompts').iterdir() if p.name == '三国望神州.md')
if args.reference_part is not None:
    lines = reference.read_text().splitlines(keepends=True)
    chunks, chunk, size = [], [], 0
    for i, line in enumerate(lines, 1):
        if size + len(line) > 6500 and chunk:
            chunks.append(chunk)
            chunk, size = [], 0
        chunk.append((i, line.rstrip('\n')))
        size += len(line)
    if chunk:
        chunks.append(chunk)
    print(f'Part {args.reference_part}/{len(chunks)}: {reference}')
    for i, line in chunks[args.reference_part - 1]:
        print(f'{i}: {line}')
    raise SystemExit(0)


def strings(value, path=''):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from strings(child, path + '/' + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from strings(child, path + '/' + str(index))
    elif isinstance(value, str):
        yield path, value


terms = ('水墨', '淡墨', '淡彩', '低饱和', '低对比', '2-3', '泼墨',
         '灰白', '多色相', '矿物色', '墨色', '饱满', '色彩丰富')
rows = []
for path in [MANUAL / 'json/qi21_bases.json', MANUAL / 'ma_sync/runtime-contract.json']:
    for field, text in strings(json.loads(path.read_text())):
        hits = {term: text.count(term) for term in terms if term in text}
        if hits:
            excerpts = [s.strip() for s in re.split(r'[。；\n]', text)
                        if any(term in s for term in ('淡墨', '淡彩', '低饱和', '低对比', '泼墨', '2-3'))]
            rows.append({'path': str(path), 'field': field, 'terms': hits, 'excerpts': excerpts})
for path in [MANUAL / 'prefix.md', MANUAL / 'README.md']:
    for i, line in enumerate(path.read_text().splitlines(), 1):
        hits = {term: line.count(term) for term in terms if term in line}
        if hits:
            rows.append({'path': str(path), 'line': i, 'terms': hits, 'text': line})
(OUT / 'style-color-audit.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
for row in rows:
    if row.get('field', '').startswith(('/types/', '/expand_instruction/')):
        if row.get('excerpts'):
            print(row['field'], json.dumps(row['excerpts'], ensure_ascii=False)[:900])
print('Saved', len(rows), 'field/line records to', OUT / 'style-color-audit.json')
