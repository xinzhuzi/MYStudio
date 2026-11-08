"""Guarded i2i main-canvas routing repair; defaults to dry-run.

Keep all executable inputs intact, add one VAE display reroute, and arrange
main nodes in functional columns. Only --apply writes workflow and baseline.
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
import qwen21_bridge_template_build

PLAN = {
    1: [740, 80], 2: [966.9, 640], 3: [1529.7, 1630],
    10: [2100, 2740], 16: [2800, 2000], 11: [2100, 4510],
    17: [2800, 2910], 6: [3750, 3860], 401: [4880, 3310],
    9: [2400, 480], 7: [6900, 770], 4: [5500, 4150],
    20: [6290, 4480], 400: [2840, 3400], 402: [1064.3, 2850],
    12: [2870, 2300], 18: [3500, 2860], 505: [2900, 4480],
    4015: [5200, 1340], 171: [5350, 1810],
}
LOCKED = {5: [7775.3, 1708.7], 8: [8790, 2446.1],
          7500: [8320, 1800], 503: [11800, 1900], 504: [12400, 1900]}
MEMBERS = {
    1: [1, 2, 3],
    2: [10, 16, 11, 17, 6, 401, 9, 4, 400, 12, 18, 505, 4015, 171],
    4: [20, 7],
}
ROUTE_ID = 7701
FEED_ID = 7801


def locate(name: str) -> Path:
    paths = subprocess.check_output(
        ['fd', '-a', '--fixed-strings', name,
         str(ROOT / 'apps/backend/comfyui/workflows')], text=True
    ).splitlines()
    paths = [Path(p) for p in paths if Path(p).name == name]
    assert len(paths) == 1, paths
    return paths[0]


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def without_plan(doc: dict) -> dict:
    """Undo only this script's reroute and strip mutable main geometry."""
    result = copy.deepcopy(doc)
    nodes = {n['id']: n for n in result['nodes']}
    links = {link[0]: link for link in result['links']}
    if ROUTE_ID in nodes:
        assert links[37][1:3] == [ROUTE_ID, 0]
        assert links[FEED_ID] == [FEED_ID, 3, 0, ROUTE_ID, 0, 'VAE']
        links[37][1:3] = [3, 0]
        outgoing = nodes[3]['outputs'][0]['links']
        outgoing[outgoing.index(FEED_ID)] = 37
        result['nodes'] = [n for n in result['nodes'] if n['id'] != ROUTE_ID]
        result['links'] = [link for link in result['links'] if link[0] != FEED_ID]
    for node in result['nodes']:
        node.pop('pos', None)
    for group in result['groups']:
        if group['id'] in MEMBERS:
            group.pop('bounding', None)
    result.pop('last_node_id', None)
    result.pop('last_link_id', None)
    return result


def repair(doc: dict) -> dict:
    result = copy.deepcopy(doc)
    nodes = {n['id']: n for n in result['nodes']}
    links = {link[0]: link for link in result['links']}
    groups = {g['id']: g for g in result['groups']}
    assert set(nodes) == set(PLAN) | set(LOCKED) | ({ROUTE_ID} if ROUTE_ID in nodes else set()), 'Main topology changed'
    assert nodes[3]['type'] == 'VAELoaderKJ'
    assert nodes[4015]['type'] == 'MyQi21FastEncode'
    assert nodes[171]['type'] == 'MyQi21FastEncode'
    assert groups[5]['bounding'][2] == 1587.3, 'Preserve requested narrow output group'
    for nid, pos in LOCKED.items():
        assert nodes[nid]['pos'] == pos, ('Protected geometry changed', nid)
    if ROUTE_ID not in nodes:
        all_nodes = list(result['nodes']) + [n for sg in result['definitions']['subgraphs'] for n in sg['nodes']]
        all_links = list(result['links']) + [link for sg in result['definitions']['subgraphs'] for link in sg['links']]
        assert ROUTE_ID not in {n['id'] for n in all_nodes}
        assert FEED_ID not in {link[0] if isinstance(link, list) else link['id'] for link in all_links}
        assert links[37] == [37, 3, 0, 5, 1, 'VAE']
        outgoing = nodes[3]['outputs'][0]['links']
        outgoing[outgoing.index(37)] = FEED_ID
        links[37][1:3] = [ROUTE_ID, 0]
        route = {
            'id': ROUTE_ID, 'type': 'Reroute', 'pos': [7500, 80],
            'size': [75, 26], 'flags': {}, 'order': 0, 'mode': 0,
            'inputs': [{'name': '', 'type': '*', 'link': FEED_ID}],
            'outputs': [{'name': '', 'type': 'VAE', 'links': [37]}],
            'properties': {'showOutputText': False, 'horizontal': False},
            'title': '[7701] VAE 顶部过线',
        }
        result['nodes'].append(route)
        result['links'].append([FEED_ID, 3, 0, ROUTE_ID, 0, 'VAE'])
        nodes[ROUTE_ID] = route
    else:
        assert nodes[ROUTE_ID]['type'] == 'Reroute'
        assert links[37] == [37, ROUTE_ID, 0, 5, 1, 'VAE']
        assert links[FEED_ID] == [FEED_ID, 3, 0, ROUTE_ID, 0, 'VAE']
    nodes[ROUTE_ID]['pos'] = [7500, 80]
    for nid, pos in PLAN.items():
        nodes[nid]['pos'] = pos.copy()
    for gid, members in MEMBERS.items():
        left = min(nodes[n]['pos'][0] for n in members)
        top = min(nodes[n]['pos'][1] for n in members)
        right = max(nodes[n]['pos'][0] + est_size(nodes[n])[0] for n in members)
        bottom = max(nodes[n]['pos'][1] + est_size(nodes[n])[1] for n in members)
        groups[gid]['bounding'] = [left - 30, max(0, top - 50),
                                   right - left + 60, bottom - top + 80]
    result['last_node_id'] = max(result.get('last_node_id', 0), ROUTE_ID)
    result['last_link_id'] = max(result.get('last_link_id', 0), FEED_ID)
    assert without_plan(result) == without_plan(doc), 'Non-layout content changed'
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    workflow = locate('qi21-道劫-i2i.json')
    baseline = ROOT / 'apps/build/scripts/workflow_layout_baseline.json'
    output = ROOT / 'apps/output/automation/qi21-main-routes-1027'
    output.mkdir(parents=True, exist_ok=True)
    original = workflow.read_bytes()
    old = json.loads(original)
    new = repair(old)
    assert repair(new) == new, 'Repair is not idempotent'
    before = layout_check.check_workflow(old)
    after = layout_check.check_workflow(new)
    assert [s['name'] for s in before] == [s['name'] for s in after]
    for a, b in zip(before, after):
        assert all(b['counts'][k] <= a['counts'][k] for k in layout_check.CHECK_KEYS), b
    assert after[0]['counts']['crossings'] <= 43
    assert all(after[0]['counts'][k] == 0 for k in layout_check.CHECK_KEYS if k != 'crossings'), after[0]
    fixture = json.loads((ROOT / 'apps/backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json').read_bytes())
    exported_before = qwen21_bridge_template_build.build_graph(fixture, old, force_upscale=False)
    exported_after = qwen21_bridge_template_build.build_graph(fixture, new, force_upscale=False)
    assert exported_before == exported_after, 'Executable export changed'
    encoded = original if old == new else (json.dumps(new, ensure_ascii=False, indent=2) + '\n').encode()
    pending = [(workflow, original, encoded)]
    raw_baseline = baseline.read_bytes()
    base = json.loads(raw_baseline)
    updated = copy.deepcopy(base)
    record = updated['files'][str(workflow.relative_to(ROOT))]['scopes']['main']
    for key in ('crossings', 'occlusion'):
        actual = after[0]['counts'][key]
        assert actual <= record[key], 'Baseline would increase'
        record[key] = actual
    encoded_baseline = raw_baseline if updated == base else (json.dumps(updated, ensure_ascii=False, indent=2) + '\n').encode()
    pending.append((baseline, raw_baseline, encoded_baseline))
    (output / 'proposed-qi21-i2i.json').write_bytes(encoded)
    report = {
        'applied': args.apply, 'before': before, 'after': after,
        'semantic_export_equal': True, 'exported_node_count': len(exported_after[0]),
        'idempotent': True, 'files': [
            {'path': str(p), 'changed': a != b, 'before_sha256': digest(a), 'after_sha256': digest(b)}
            for p, a, b in pending],
    }
    if args.apply:
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
    print(json.dumps({'applied': args.apply, 'main': after[0]['counts'],
                      'exported_node_count': len(exported_after[0]),
                      'receipt': str(output / 'receipt.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
