"""Preserve new acceleration branches while clearing their wire occlusions."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
import layout_check as lc
from qi21_wire_layout import semantic_content

GRAPH_ID = 'e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e'
POSITIONS = {7011: [2200, 1800], 7019: [2750, 1800], 7020: [2200, 2050],
             7021: [2750, 2300], 7026: [2200, 3300]}


def repair(workflow):
    updated = copy.deepcopy(workflow)
    graph = next(g for g in updated['definitions']['subgraphs'] if g['id'] == GRAPH_ID)
    nodes = {n['id']: n for n in graph['nodes']}
    assert {7040, 7041, 7042, 7043} <= set(nodes), 'Expected new acceleration branch missing'
    for node_id, position in POSITIONS.items():
        nodes[node_id]['pos'] = list(position)
    assert semantic_content(workflow) == semantic_content(updated), 'Execution content changed'
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    source = Path(subprocess.check_output(['fd', '-a', '^qi21-道劫-t2i.json$',
        str(ROOT / 'apps/backend/engines/comfyui/workflows')], text=True).strip())
    paths = [source]
    for path in (ROOT / 'apps/backend/engines/comfyui/my_nodes/subgraphs').glob('*.json'):
        data = json.loads(path.read_bytes())
        if any(g['id'] == GRAPH_ID for g in data.get('definitions', {}).get('subgraphs', [])):
            paths.append(path)
    assert len(paths) == 2, 'Expected exactly one production workflow and one blueprint'
    pending = []
    reports = []
    for path in paths:
        original = path.read_bytes()
        workflow = json.loads(original)
        updated = repair(workflow)
        assert repair(updated) == updated, 'Not idempotent'
        before = lc.check_workflow(workflow)
        after = lc.check_workflow(updated)
        for old, new in zip(before, after):
            assert old['name'] == new['name']
            for key in lc.CHECK_KEYS:
                assert new['counts'][key] <= old['counts'][key], (path, new['name'], key)
                if key != 'crossings' and new['name'] != 'main':
                    assert new['counts'][key] == 0, (path, new['name'], key)
        pending.append((path, original, updated))
        reports.append({'path': str(path), 'before': before, 'after': after,
                        'before_sha256': hashlib.sha256(original).hexdigest()})
    assert all(path.read_bytes() == original for path, original, _ in pending), 'Concurrent edit'
    if options.apply:
        backup = ROOT / 'apps/output/bak/qi21-accel-layout'
        backup.mkdir(parents=True, exist_ok=True)
        for path, original, updated in pending:
            if json.loads(original) == updated:
                continue
            target = backup / (path.stem + '-' + hashlib.sha256(original).hexdigest()[:12] + '.json')
            if not target.exists():
                shutil.copy2(path, target)
            assert path.read_bytes() == original, 'Concurrent edit: ' + str(path)
            path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n')
            assert json.loads(path.read_bytes()) == updated
    output = ROOT / 'apps/output/automation/qi21-accel-layout.json'
    output.write_text(json.dumps({'applied': options.apply, 'execution_content_unchanged': True,
        'positions': POSITIONS, 'files': reports}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'applied': options.apply, 'report': str(output),
        'counts': [s['counts'] for s in reports[0]['after']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
