"""Move purpose routing inside the i2i subgraph; never submit generation."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
repair = importlib.import_module('qi21_i2i_repair_1016')
negative = importlib.import_module('qi21_i2i_negative_1016')
ROOT = repair.ROOT
RESEARCH = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/round15-i2i-output-error'
OLD_NOTE = '画幅随[6]组装用途自动选择：新建资产/无底座出图使用类型宽高（手动宽高成对优先），局部编辑/画风转换保留参考图latent；[19]仅路由同一用途，无需另开画幅开关。'
NEW_NOTE = '画幅随[6]组装用途自动选择：新建资产/无底座出图使用类型宽高（手动宽高成对优先），局部编辑/画风转换保留参考图latent；子图内[4022]路由同一用途，经真实BOOLEAN输出控制[20]，无需另开画幅开关。'
OUTPUT_NAMES = ['prompt', '画幅W', '画幅H', 'negative', '型名', '使用类型画幅']


def paths():
    return repair.paths()[:2]


def node(graph, identifier):
    return next(item for item in graph['nodes'] if item['id'] == identifier)


def validate(documents):
    source, blueprint = documents
    prompt = repair.graph(source, repair.PROMPT_ID)
    assert all(repair.graph(blueprint, repair.PROMPT_ID)[k] == v for k, v in prompt.items()), 'blueprint definition drift'
    assert node(source, 19)['type'] == 'Reroute', 'root19 only preserves wire geometry'
    assert [port['name'] for port in prompt['outputs']] == OUTPUT_NAMES
    router = node(prompt, 4022)
    assert router['type'] == 'MyQi21PurposeCanvas'
    assert router['widgets_values'] == [] and router['widgets_values_named'] == {}
    assert router['inputs'][0]['link'] == 287
    assert router['outputs'][0]['links'] == [288]
    edges = {edge['id']: edge for edge in prompt['links']}
    assert edges[287] == {'id': 287, 'origin_id': -10, 'origin_slot': 7, 'target_id': 4022, 'target_slot': 0, 'type': 'COMBO'}
    assert edges[288] == {'id': 288, 'origin_id': 4022, 'origin_slot': 0, 'target_id': -20, 'target_slot': 5, 'type': 'BOOLEAN'}
    assert {(e['target_id'], e['target_slot']) for e in prompt['links']
            if e['origin_id'] == -10 and e['origin_slot'] == 7} == {(4011, 2), (4022, 0)}
    assert prompt['outputs'][5]['linkIds'] == [288]
    assert prompt['outputs'][5]['type'] == 'BOOLEAN'
    assert prompt['state']['lastNodeId'] >= max(n['id'] for n in prompt['nodes'])
    assert prompt['state']['lastLinkId'] >= max(edges)
    assembly, = [g for g in prompt['groups'] if g['id'] == 8]
    assert assembly['title'] == '装配主链(带2)'
    gx, gy, gw, gh = assembly['bounding']
    for identifier in (4018, 4022):
        item = node(prompt, identifier)
        x, y = item['pos']; w, h = item['size']
        assert gx <= x and gy <= y - 40 and x + w <= gx + gw and y + h <= gy + gh
    for document in documents:
        host = repair.host(document, repair.PROMPT_ID)
        assert [(p['name'], p['type']) for p in host['outputs']] == [(p['name'], p['type']) for p in prompt['outputs']]
        negative.reciprocal(document, root=True)
        for graph in document['definitions']['subgraphs']:
            negative.reciprocal(graph)
            assert not any(e['origin_id'] == -10 and e['target_id'] == -20 for e in graph['links']), 'virtual input-to-output passthrough cannot be exported by frontend'
    root_edges = {e[0]: e for e in source['links']}
    assert root_edges[7468] == [7468, 6, 5, 19, 0, 'BOOLEAN']
    assert root_edges[32] == [32, 19, 0, 20, 2, 'BOOLEAN']
    assert node(source, 19)['inputs'][0]['link'] == 7468
    assert node(source, 19)['outputs'][0]['links'] == [32]
    assert node(source, 20)['inputs'][2]['link'] == 32
    assert repair.host(source, repair.PROMPT_ID)['outputs'][5]['links'] == [7468]
    assert repair.host(blueprint, repair.PROMPT_ID)['outputs'][5]['links'] == []
    assert repair.host(source, repair.PROMPT_ID)['widgets_values_named'] == repair.host(blueprint, repair.PROMPT_ID)['widgets_values_named']
    assert repair.host(source, repair.PROMPT_ID)['widgets_values_named']['组装用途'] == '局部编辑'
    assert NEW_NOTE in node(source, 402)['widgets_values'][0]
    assert NEW_NOTE in node(source, 402)['widgets_values_named']['text']


def preserve_root_wire(source):
    reroute = copy.deepcopy(node(source, 7403))
    reroute.update(id=19, title='[19] 画幅信号转接', pos=[4810, 2600], order=5)
    reroute['inputs'] = [{'name': '', 'type': 'BOOLEAN', 'link': 7468}]
    reroute['outputs'] = [{'name': '', 'type': 'BOOLEAN', 'links': [32]}]
    source['nodes'].append(reroute)
    source['links'].append([7468, 6, 5, 19, 0, 'BOOLEAN'])
    switch_edge, = [e for e in source['links'] if e[0] == 32]
    assert switch_edge == [32, 6, 5, 20, 2, 'BOOLEAN']
    switch_edge[1:3] = [19, 0]
    repair.host(source, repair.PROMPT_ID)['outputs'][5]['links'] = [7468]


def transform(documents):
    result = copy.deepcopy(documents)
    source, blueprint = result
    if any(item['id'] == 19 and item['type'] == 'Reroute' for item in source['nodes']):
        validate(result)
        return result
    if not any(item['id'] == 19 for item in source['nodes']):
        preserve_root_wire(source)
        validate(result)
        return result
    prompt = repair.graph(source, repair.PROMPT_ID)
    assert not any(item['id'] == 4022 for item in prompt['nodes'])
    router = node(source, 19)
    assert router['type'] == 'MyQi21PurposeCanvas'
    assert router['inputs'][0]['link'] == 7468 and router['outputs'][0]['links'] == [32]
    source['nodes'].remove(router)
    router.update(id=4022, title='[4022] 用途画幅路由·自动', pos=[5800, 1620])
    router['inputs'][0]['link'] = 287
    router['outputs'][0]['links'] = [288]
    prompt['nodes'].append(router)
    edge, = [e for e in prompt['links'] if e['id'] == 287]
    assert edge == {'id': 287, 'origin_id': -10, 'origin_slot': 7, 'target_id': -20, 'target_slot': 5, 'type': 'COMBO'}
    edge.update(target_id=4022, target_slot=0)
    assert not any(e['id'] == 288 for e in prompt['links'])
    prompt['links'].append({'id': 288, 'origin_id': 4022, 'origin_slot': 0, 'target_id': -20, 'target_slot': 5, 'type': 'BOOLEAN'})
    prompt['outputs'][5].update(name='使用类型画幅', type='BOOLEAN', linkIds=[288])
    prompt['state']['lastNodeId'] = max(prompt['state']['lastNodeId'], 4022)
    prompt['state']['lastLinkId'] = max(prompt['state']['lastLinkId'], 288)
    main_host = repair.host(source, repair.PROMPT_ID)
    main_host['outputs'][5].update(name='使用类型画幅', type='BOOLEAN', links=[32])
    old_root_edge, = [e for e in source['links'] if e[0] == 7468]
    assert old_root_edge == [7468, 6, 5, 19, 0, 'COMBO']
    source['links'].remove(old_root_edge)
    switch_edge, = [e for e in source['links'] if e[0] == 32]
    assert switch_edge == [32, 19, 0, 20, 2, 'BOOLEAN']
    switch_edge[1:3] = [6, 5]
    note = node(source, 402)
    assert note['widgets_values'][0].count(OLD_NOTE) == 1
    assert note['widgets_values_named']['text'].count(OLD_NOTE) == 2
    note['widgets_values'][0] = note['widgets_values'][0].replace(OLD_NOTE, NEW_NOTE, 1)
    note['widgets_values_named']['text'] = note['widgets_values_named']['text'].replace(OLD_NOTE, NEW_NOTE)
    blueprint_prompt = repair.graph(blueprint, repair.PROMPT_ID)
    blueprint_prompt.update(copy.deepcopy(prompt))
    repair.host(blueprint, repair.PROMPT_ID)['outputs'][5].update(name='使用类型画幅', type='BOOLEAN', links=[])
    preserve_root_wire(source)
    validate(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    targets = paths()
    originals = [p.read_bytes() for p in targets]
    documents = [json.loads(b) for b in originals]
    if args.check:
        validate(documents)
        assert transform(documents) == documents
        print('boundary and blueprint valid; transform idempotent')
        return
    updated = transform(documents)
    if updated == documents:
        print('already repaired; original backup manifest retained')
        return
    prepared = [repair.render(raw, old, new) for raw, old, new in zip(originals, documents, updated)]
    backup = RESEARCH / 'backups'
    backup.mkdir(parents=True, exist_ok=True)
    api, = (ROOT / 'apps/backend/comfyui').rglob('qwen21-道劫-i2i-api.json')
    all_targets = [*targets, api, ROOT / 'apps/backend/comfyui/tests/test_qwen21_workflow_contract.py', ROOT / 'apps/build/scripts/test_qi21_i2i_canvas_1021.py']
    receipts = []
    for p in all_targets:
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        destination = backup / (digest + p.suffix)
        if not destination.exists():
            shutil.copy2(p, destination)
        assert destination.read_bytes() == p.read_bytes()
        receipts.append({'path': str(p.relative_to(ROOT)), 'before_sha256': digest, 'backup': str(destination.relative_to(ROOT))})
    for p, raw, (new, _) in zip(targets, originals, prepared):
        assert p.read_bytes() == raw, 'concurrent edit'
        if new != raw:
            p.write_bytes(new)
    for row in receipts:
        row['after_sha256'] = hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest()
    (RESEARCH / 'main-source-manifest.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'applied': True, 'files': len(targets)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
