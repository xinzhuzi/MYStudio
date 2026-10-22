"""Synchronize geometry of the two shared definitions after t2i layout repair."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps/build/scripts'))
from qi21_wire_layout import semantic_content
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
import layout_check as lc

def locate(pattern):
    paths = subprocess.check_output(['fd', '-a', pattern,
        str(ROOT / 'apps/backend/engines/comfyui/workflows')], text=True).splitlines()
    assert len(paths) == 1, paths
    return Path(paths[0])

source = json.loads(locate('^qi21-道劫-t2i.json$').read_bytes())
path = locate('^qi21-道劫-i2i.json$')
raw = path.read_bytes()
original = json.loads(raw)
updated = copy.deepcopy(original)
ids = ('f0a844a8-9bf5-4c71-8af5-f1c9f17c0324', 'b7da105a-0610-4b8e-9a2c-3d4f5e6a7b81')
for sid in ids:
    reference = next(s for s in source['definitions']['subgraphs'] if s['id'] == sid)
    target = next(s for s in updated['definitions']['subgraphs'] if s['id'] == sid)
    assert semantic_content(reference) == semantic_content(target), sid
    byid = {n['id']: n for n in reference['nodes']}
    for n in target['nodes']:
        n['pos'] = copy.deepcopy(byid[n['id']]['pos'])
    assert target == reference, sid
assert semantic_content(original) == semantic_content(updated)
before, after = lc.check_workflow(original), lc.check_workflow(updated)
for old, new in zip(before, after):
    assert old['name'] == new['name']
    for key in lc.CHECK_KEYS:
        assert new['counts'][key] <= old['counts'][key], (old['name'], key)
if updated != original:
    backup = ROOT / 'apps/output/bak/qi21-wire-layout-1022'
    backup.mkdir(parents=True, exist_ok=True)
    destination = backup / (path.stem + '-' + hashlib.sha256(raw).hexdigest()[:12] + '.json')
    if not destination.exists():
        shutil.copy2(path, destination)
    assert path.read_bytes() == raw, 'Concurrent edit detected'
    path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n')
assert json.loads(path.read_bytes()) == updated
report = ROOT / 'apps/output/automation/qi21-shared-layout-sync-1022.json'
report.write_text(json.dumps({'source': str(path), 'shared_ids': ids,
    'execution_content_unchanged': True, 'before': before, 'after': after}, ensure_ascii=False, indent=2) + '\n')
print('Shared SeedVR2 and cleanup definitions match t2i; execution content unchanged.')
