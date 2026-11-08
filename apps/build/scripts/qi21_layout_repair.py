"""Repair current i2i acceleration geometry only; default is a guarded dry run.

The coordinate plan is derived from the current t2i branch arrangement, with a
separate full-size explanation card. Production files are written only with
--apply, after content, layout, idempotency, backup, and concurrent-write gates.
This does not modify the i2i main scope: its remaining wire issues are reported.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
import layout_check
from workflow_layout import est_size

SCOPE_NAME = '道劫·加速子图'
PLAN = {
    7011: [1740, 3060], 7012: [3940, 3160], 7010: [2180, 4160],
    7014: [300, 3620], 7015: [6160, 3040], 7017: [310, 1060],
    7018: [550, 1520], 7019: [3280, 3020], 7020: [3060, 3390],
    7021: [3660, 3450], 7022: [2530, 2700], 7023: [4150, 2640],
    7024: [4880, 3140], 7028: [1700, 1480], 7029: [4080, 1300],
    7030: [4960, 1590], 7031: [5700, 1060], 7016: [2720, 80],
    7034: [570, 2520], 7040: [3340, 1950], 7041: [3340, 2250],
    7042: [3980, 1910], 7043: [4900, 1890], 7044: [2860, 1950],
}
GROUP_MEMBERS = {
    11: [7014, 7017, 7018, 7034],
    12: [7016, 7028, 7029, 7030, 7031],
    13: [7011, 7012, 7019, 7020, 7021, 7022, 7023, 7024],
    14: [7015], 15: [7010], 16: [7040, 7041, 7042, 7043, 7044],
}


def locate(name: str, folder: str) -> Path:
    paths = subprocess.check_output(
        ['fd', '-a', '--fixed-strings', name, str(ROOT / folder)], text=True
    ).splitlines()
    paths = [Path(p) for p in paths if Path(p).name == name]
    assert len(paths) == 1, (name, paths)
    return paths[0]


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def subgraph(doc: dict) -> dict:
    found = [s for s in doc['definitions']['subgraphs'] if s['name'] == SCOPE_NAME]
    assert len(found) == 1
    return found[0]


def without_geometry(doc: dict) -> dict:
    result = copy.deepcopy(doc)
    for sg in result['definitions']['subgraphs']:
        if sg['name'] != SCOPE_NAME:
            continue
        for node in sg['nodes']:
            node.pop('pos', None)
        for group in sg['groups']:
            group.pop('bounding', None)
    return result


def repair(doc: dict) -> dict:
    result = copy.deepcopy(doc)
    sg = subgraph(result)
    nodes = {n['id']: n for n in sg['nodes']}
    groups = {g['id']: g for g in sg['groups']}
    assert set(nodes) == set(PLAN), 'Acceleration topology changed; re-review plan'
    assert set(groups) == set(GROUP_MEMBERS), 'Acceleration grouping changed'
    assert nodes[7040]['type'] == 'LazyCache'
    assert nodes[7041]['type'] == 'BasicScheduler'
    assert nodes[7044]['type'] == 'LoraLoaderModelOnly'
    assert nodes[7016]['size'] == [1400, 500], 'Preserve full-size explanation'
    assert nodes[7015]['pos'][0] > max(PLAN[n][0] for n in PLAN if n != 7015)
    for nid, pos in PLAN.items():
        nodes[nid]['pos'] = pos.copy()
    for gid, members in GROUP_MEMBERS.items():
        left = min(nodes[n]['pos'][0] for n in members)
        top = min(nodes[n]['pos'][1] for n in members)
        right = max(nodes[n]['pos'][0] + est_size(nodes[n])[0] for n in members)
        bottom = max(nodes[n]['pos'][1] + est_size(nodes[n])[1] for n in members)
        groups[gid]['bounding'] = [left - 30, top - 50,
                                   right - left + 60, bottom - top + 80]
    assert without_geometry(result) == without_geometry(doc), 'Content changed'
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    workflow = locate('qi21-道劫-i2i.json', 'apps/backend/comfyui/workflows')
    blueprint = locate('qi21-道劫-加速子图-i2i.json', 'apps/backend/comfyui/my_nodes/subgraphs')
    baseline = ROOT / 'apps/build/scripts/workflow_layout_baseline.json'
    output = ROOT / 'apps/output/automation/qi21-layout-repair-1026'
    output.mkdir(parents=True, exist_ok=True)
    pending = []
    documents = {}
    report = {'applied': args.apply, 'files': [], 'scope': SCOPE_NAME}
    for path in [workflow, blueprint]:
        raw = path.read_bytes()
        old = json.loads(raw)
        new = repair(old)
        assert repair(new) == new, 'Non-idempotent repair'
        documents[path] = (old, new)
        encoded = raw if old == new else (json.dumps(new, ensure_ascii=False, indent=2) + '\n').encode()
        pending.append((path, raw, encoded))
        report['files'].append({'path': str(path), 'changed': raw != encoded,
                                'before_sha256': digest(raw), 'after_sha256': digest(encoded)})
        (output / ('proposed-' + path.name)).write_bytes(encoded)
    old, new = documents[workflow]
    before = layout_check.check_workflow(old)
    after = layout_check.check_workflow(new)
    assert len(before) == len(after)
    for a, b in zip(before, after):
        assert a['name'] == b['name']
        assert all(b['counts'][k] <= a['counts'][k] for k in layout_check.CHECK_KEYS), b
        if b['name'] == 'sub:' + SCOPE_NAME:
            assert b['counts']['crossings'] <= 18, b
            assert all(b['counts'][k] == 0 for k in layout_check.CHECK_KEYS if k != 'crossings'), b
    # The existing narrow output group, widget values, new hybrid branch, and
    # every main-scope node/link are covered by the exact content comparison.
    assert old['nodes'] == new['nodes'] and old['groups'] == new['groups']
    a, b = copy.deepcopy(subgraph(documents[workflow][1])), copy.deepcopy(subgraph(documents[blueprint][1]))
    a.pop('category', None)
    b.pop('category', None)
    assert a == b, 'Blueprint differs from workflow beyond category metadata'
    raw = baseline.read_bytes()
    base = json.loads(raw)
    updated = copy.deepcopy(base)
    record = updated['files'][str(workflow.relative_to(ROOT))]['scopes']['sub:' + SCOPE_NAME]
    actual = next(s for s in after if s['name'] == 'sub:' + SCOPE_NAME)['counts']
    for key in ('crossings', 'occlusion'):
        assert actual[key] <= record[key], 'Baseline ratchet would increase'
        record[key] = actual[key]
    encoded = raw if updated == base else (json.dumps(updated, ensure_ascii=False, indent=2) + '\n').encode()
    pending.append((baseline, raw, encoded))
    report['files'].append({'path': str(baseline), 'changed': raw != encoded,
                            'before_sha256': digest(raw), 'after_sha256': digest(encoded)})
    report['before'] = before
    report['after'] = after
    report['structural_noop'] = True
    report['remaining_main'] = after[0]['counts']
    if args.apply:
        # Check all inputs before the first production write, then recheck each
        # input immediately before writing. Backups are content-addressed.
        for path, previous, wanted in pending:
            assert path.read_bytes() == previous, 'Concurrent change: ' + str(path)
        backups = output / 'backups'
        backups.mkdir(exist_ok=True)
        for path, previous, wanted in pending:
            if previous == wanted:
                continue
            backup = backups / (path.name + '.' + digest(previous)[:16] + '.bak')
            if backup.exists():
                assert backup.read_bytes() == previous
            else:
                backup.write_bytes(previous)
            assert path.read_bytes() == previous, 'Concurrent change: ' + str(path)
            path.write_bytes(wanted)
            assert path.read_bytes() == wanted
    (output / 'receipt.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'applied': args.apply, 'changed_files': sum(a != b for _, a, b in pending),
                      'counts': {s['name']: s['counts'] for s in after},
                      'receipt': str(output / 'receipt.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
