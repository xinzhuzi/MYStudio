"""Offline hash-guarded, idempotent i2i purpose-to-canvas wiring surgery."""
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
RESEARCH = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/round11-i2i-canvas'
BEFORE_SHA = (
    'd22741092574e7c32d430a8aa4ad8688e64b3ef072f9ddc2b9bcd8ab5e9fe118',
    '5da37dd14728bced4fd3c0f25a76d74999f6dbbfe0f7c7ec7dea4c21de196aaa',
)
GROUP_MOVE_BEFORE_SHA = (
    '04d916eb39601646d7d4ff2d3a171d037695b379b18cc32d333be8eead5a10b5',
    '4d9fab0a71650f3568f4ef329f555a2339d705c25e53b5009598cb6aa453458d',
)
OUTPUT_NAMES = ['prompt', '画幅W', '画幅H', 'negative', '型名', '组装用途']
CANVAS_NOTE = '画幅随[6]组装用途自动选择：新建资产/无底座出图使用类型宽高（手动宽高成对优先），局部编辑/画风转换保留参考图latent；[19]仅路由同一用途，无需另开画幅开关。'


def paths():
    return repair.paths()[:2]


def node(graph, identifier):
    return next(item for item in graph['nodes'] if item['id'] == identifier)


def transform(documents):
    result = copy.deepcopy(documents)
    source, blueprint = result
    prompt = repair.graph(source, repair.PROMPT_ID)
    if node(source, 19)['type'] == 'MyQi21PurposeCanvas':
        mark_historical_guidance(source)
        route_adjacent_conditioning(source)
        place_canvas_suggest(result)
        validate(result)
        return result
    assert node(source, 19)['type'] == 'PrimitiveBoolean'
    assert node(source, 19)['widgets_values'] == [False]
    assert [port['name'] for port in prompt['outputs']] == OUTPUT_NAMES[:-1]
    purpose_slot, = [index for index, port in enumerate(prompt['inputs']) if port['name'] == '组装用途']
    assert prompt['inputs'][purpose_slot]['type'] == 'COMBO'
    edge_id = max(edge['id'] for edge in prompt['links']) + 1
    prompt['links'].append({'id': edge_id, 'origin_id': -10, 'origin_slot': purpose_slot,
                            'target_id': -20, 'target_slot': 5, 'type': 'COMBO'})
    prompt['inputs'][purpose_slot]['linkIds'].append(edge_id)
    prompt['outputs'].append({'id': 'e437134d-7d29-4b84-a86e-71b134c4fe66',
                              'name': '组装用途', 'type': 'COMBO', 'linkIds': [edge_id],
                              'pos': [8100, 2480]})
    prompt['state']['lastLinkId'] = max(prompt['state']['lastLinkId'], edge_id)
    host = repair.host(source, repair.PROMPT_ID)
    link_id = max(source['last_link_id'], *(edge[0] for edge in source['links'])) + 1
    host['outputs'].append({'name': '组装用途', 'type': 'COMBO', 'links': [link_id]})
    source['links'].append([link_id, host['id'], 5, 19, 0, 'COMBO'])
    source['last_link_id'] = link_id
    router = node(source, 19)
    router.update({'type': 'MyQi21PurposeCanvas', 'pos': [4810, 2600],
                   'title': '[19] 用途画幅路由·自动',
                   'inputs': [{'name': '组装用途', 'type': 'COMBO', 'link': link_id}],
                   'widgets_values': [], 'widgets_values_named': {},
                   'properties': {'Node name for S&R': 'MyQi21PurposeCanvas'}})
    router['outputs'][0]['name'] = '使用类型画幅'
    note = node(source, 402)
    assert CANVAS_NOTE not in note['widgets_values'][0]
    note['widgets_values'][0] += '\n' + CANVAS_NOTE
    if 'widgets_values_named' in note:
        historical_heading = '### 输出画幅双路([19] 开关,默认 false=跟随输入图;1015 升级=按型画幅)'
        assert note['widgets_values_named']['text'].count(historical_heading) == 1
        note['widgets_values_named']['text'] = note['widgets_values_named']['text'].replace(
            historical_heading, '### 输出画幅双路（1015历史手动说明；2026-10-21现规则见末尾）', 1)
        note['widgets_values_named']['text'] += '\n' + CANVAS_NOTE
    blueprint_prompt = repair.graph(blueprint, repair.PROMPT_ID)
    assert all(blueprint_prompt[key] == value for key, value in
               repair.graph(documents[0], repair.PROMPT_ID).items())
    blueprint_prompt.update(copy.deepcopy(prompt))
    repair.host(blueprint, repair.PROMPT_ID)['outputs'].append(
        {'name': '组装用途', 'type': 'COMBO', 'links': []})
    mark_historical_guidance(source)
    route_adjacent_conditioning(source)
    place_canvas_suggest(result)
    validate(result)
    return result


def place_canvas_suggest(documents):
    """Move only the canvas adviser into the assembly stage in both copies."""
    for document in documents:
        prompt = repair.graph(document, repair.PROMPT_ID)
        adviser = node(prompt, 4018)
        assert adviser['type'] == 'MyQi21WhSuggest'
        assert adviser['pos'] in ([4760, 860], [4140, 2100])
        pe_group, = [group for group in prompt['groups'] if group['id'] == 7]
        assert pe_group['title'] in ('PE改写链+画幅建议(带0/1)', 'PE改写链(带0/1)')
        adviser['pos'] = [4140, 2100]
        pe_group['title'] = 'PE改写链(带0/1)'


def route_adjacent_conditioning(source):
    """Keep the added purpose wire within the original crossing/occlusion budget."""
    if any(item['id'] == 7403 for item in source['nodes']):
        assert node(source, 7403)['type'] == 'Reroute'
        return
    assert source['last_node_id'] == 7402 and source['last_link_id'] == 7468
    edge, = [edge for edge in source['links'] if edge[0] == 282]
    assert edge == [282, 171, 0, 7, 3, 'CONDITIONING']
    assert node(source, 171)['outputs'][0]['links'] == [282]
    reroute = copy.deepcopy(node(source, 42))
    reroute.update({'id': 7403, 'pos': [6300, 3000],
                    'title': '[7403] 单图条件走线',
                    'order': max(item['order'] for item in source['nodes']) + 1})
    reroute['inputs'][0].update({'type': 'CONDITIONING', 'link': 7469})
    reroute['outputs'][0].update({'type': 'CONDITIONING', 'links': [282]})
    source['nodes'].append(reroute)
    edge[1:3] = [7403, 0]
    node(source, 171)['outputs'][0]['links'] = [7469]
    source['links'].append([7469, 171, 0, 7403, 0, 'CONDITIONING'])
    source['last_node_id'], source['last_link_id'] = 7403, 7469


def mark_historical_guidance(source):
    note = node(source, 402)
    heading = '## 现行画幅规则（2026-10-21）\n'
    text = note['widgets_values_named']['text']
    if not text.startswith(heading):
        note['widgets_values_named']['text'] = (
            heading + CANVAS_NOTE + '\n\n'
            '以下保留历史说明；其中手动开启[19]、画幅不随型、加速档画幅恒1.0等旧指引不再适用。'
            '现行用途路由与t2i同型/成对手动尺寸策略优先，参考图预缩策略未变。\n\n' + text)


def validate(documents):
    source, blueprint = documents
    prompt = repair.graph(source, repair.PROMPT_ID)
    assert all(repair.graph(blueprint, repair.PROMPT_ID)[key] == value
               for key, value in prompt.items())
    adviser = node(prompt, 4018)
    assembly, = [group for group in prompt['groups'] if group['id'] == 8]
    assert assembly['title'] == '装配主链(带2)'
    assert adviser['pos'] == [4140, 2100]
    x, y = adviser['pos']
    width, height = adviser['size']
    gx, gy, gw, gh = assembly['bounding']
    assert gx <= x and gy <= y - 50 and x + width <= gx + gw and y + height <= gy + gh
    assert next(group for group in prompt['groups'] if group['id'] == 7)['title'] == 'PE改写链(带0/1)'
    assert [port['name'] for port in prompt['outputs']] == OUTPUT_NAMES
    for document in documents:
        host = repair.host(document, repair.PROMPT_ID)
        assert [(port['name'], port['type']) for port in host['outputs']] == [
            (port['name'], port['type']) for port in prompt['outputs']]
        negative.reciprocal(document, root=True)
        for graph in document['definitions']['subgraphs']:
            negative.reciprocal(graph)
    source_host = repair.host(source, repair.PROMPT_ID)
    blueprint_host = repair.host(blueprint, repair.PROMPT_ID)
    assert source_host['widgets_values'] == blueprint_host['widgets_values']
    assert source_host['widgets_values_named'] == blueprint_host['widgets_values_named']
    assert source_host['widgets_values_named']['组装用途'] == '局部编辑'
    purpose_slot, = [index for index, port in enumerate(prompt['inputs']) if port['name'] == '组装用途']
    purpose_edges = [edge for edge in prompt['links'] if edge['origin_id'] == -10 and edge['origin_slot'] == purpose_slot]
    assert {(edge['target_id'], edge['target_slot']) for edge in purpose_edges} == {(4011, 2), (-20, 5)}
    assert all(edge['type'] == 'COMBO' for edge in purpose_edges)
    router = node(source, 19)
    assert router['type'] == 'MyQi21PurposeCanvas'
    assert router['widgets_values'] == [] and router['widgets_values_named'] == {}
    route_edge, = [edge for edge in source['links'] if edge[0] == router['inputs'][0]['link']]
    assert route_edge[1:] == [source_host['id'], 5, 19, 0, 'COMBO']
    switch = node(source, 20)
    switch_edge, = [edge for edge in source['links'] if edge[0] == switch['inputs'][2]['link']]
    assert switch_edge[1:] == [19, 0, 20, 2, 'BOOLEAN']
    assert node(source, 7403)['type'] == 'Reroute'
    assert node(source, 171)['outputs'][0]['links'] == [7469]
    assert [7469, 171, 0, 7403, 0, 'CONDITIONING'] in source['links']
    assert [282, 7403, 0, 7, 3, 'CONDITIONING'] in source['links']
    assert CANVAS_NOTE in node(source, 402)['widgets_values'][0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='read-only validate; no live engine')
    mode.add_argument('--apply', action='store_true', help='hash-guarded sequential source writes with backups')
    args = parser.parse_args()
    targets = paths()
    originals = [path.read_bytes() for path in targets]
    before = [json.loads(raw) for raw in originals]
    if args.check:
        validate(before)
        print(json.dumps({'read_only': True, 'valid': True, 'sha256': [hashlib.sha256(raw).hexdigest() for raw in originals]}))
        return
    after = transform(before)
    rendered = [repair.render(raw, old, new) for raw, old, new in zip(originals, before, after)]
    changes = []
    for index, (path, raw, (updated, spans)) in enumerate(zip(targets, originals, rendered)):
        if updated == raw:
            continue
        digest = hashlib.sha256(raw).hexdigest()
        assert digest in (BEFORE_SHA[index], GROUP_MOVE_BEFORE_SHA[index]), f'input drift: {path}'
        changes.append((path, raw, updated, digest, spans))
    assert all(path.read_bytes() == raw for path, raw in zip(targets, originals)), 'concurrent drift before write'
    receipts = []
    for path, raw, updated, digest, spans in changes:
        backup = RESEARCH / 'backups' / (path.name + '.' + digest + '.bak')
        if not backup.exists():
            shutil.copy2(path, backup)
        assert backup.read_bytes() == raw
        assert path.read_bytes() == raw, f'concurrent drift: {path}'
        path.write_bytes(updated)
        receipts.append({'path': str(path.relative_to(ROOT)), 'backup': str(backup.relative_to(ROOT)),
                         'before_sha256': digest, 'after_sha256': hashlib.sha256(updated).hexdigest(), **spans})
    if receipts:
        (RESEARCH / 'surgery-receipt.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'changed': len(receipts), 'sequential_not_transactional': True}))


if __name__ == '__main__':
    main()
