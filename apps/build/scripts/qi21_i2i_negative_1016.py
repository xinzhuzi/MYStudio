"""Offline, byte-preserving i2i negative-route surgery; never contacts an engine."""
from __future__ import annotations

import argparse
import copy
import importlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
r = importlib.import_module('qi21_i2i_repair_1016')
NEGATIVE_ID = 'f93453c2-4561-4bbb-a99a-159a77257124'


def node(graph: dict[str, Any], identifier: int) -> dict[str, Any]:
    return next(item for item in graph['nodes'] if item['id'] == identifier)


def append_input(target: dict[str, Any], name: str) -> int:
    existing = [index for index, item in enumerate(target['inputs']) if item['name'] == name]
    if existing:
        assert len(existing) == 1
        return existing[0]
    target['inputs'].append({'name': name, 'type': 'STRING', 'widget': {'name': name}, 'link': None})
    return len(target['inputs']) - 1


def connect(graph: dict[str, Any], origin: int, output: int, target: int, slot: int) -> None:
    matches = [edge for edge in graph['links'] if
               (edge['origin_id'], edge['origin_slot'], edge['target_id'], edge['target_slot']) ==
               (origin, output, target, slot)]
    if matches:
        assert len(matches) == 1
        return
    identifier = max([edge['id'] for edge in graph['links']] + [graph['state']['lastLinkId']]) + 1
    graph['links'].append({'id': identifier, 'origin_id': origin, 'origin_slot': output,
                           'target_id': target, 'target_slot': slot, 'type': 'STRING'})
    graph['state']['lastLinkId'] = identifier
    if 'last_link_id' in graph:
        graph['last_link_id'] = max(graph['last_link_id'], identifier)
    port = node(graph, origin)['outputs'][output]
    port['links'] = (port.get('links') or []) + [identifier]
    if target == -20:
        graph['outputs'][slot]['linkIds'] = [identifier]
    else:
        port = node(graph, target)['inputs'][slot]
        assert port['link'] is None
        port['link'] = identifier


def transform(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = copy.deepcopy(documents)
    source, blueprint = result
    graph = r.graph(source, r.PROMPT_ID)
    if len(graph['outputs']) == 3:
        graph['outputs'].append({'id': NEGATIVE_ID, 'name': 'negative', 'type': 'STRING',
                                 'linkIds': [], 'pos': [8100, 2440]})
    assert [port['name'] for port in graph['outputs']] == ['prompt', '画幅W', '画幅H', 'negative']
    connect(graph, 4010, 3, 4011, append_input(node(graph, 4011), 'BASE负面'))
    wrapper = node(graph, 153)
    if not any(port['name'] == '负面词直写' for port in wrapper['inputs']):
        wrapper['inputs'].insert(1, {'name': '负面词直写', 'type': 'STRING',
                                     'widget': {'name': '负面词直写'}, 'link': None})
        for edge in graph['links']:
            if edge['target_id'] == 153 and edge['target_slot'] >= 1:
                edge['target_slot'] += 1
    connect(graph, 4011, 1, 153, next(index for index, port in enumerate(wrapper['inputs'])
                                  if port['name'] == '负面词直写'))
    connect(graph, 153, 1, -20, 3)
    host = r.host(source, r.PROMPT_ID)
    if len(host['outputs']) == 3:
        host['outputs'].append({'name': 'negative', 'type': 'STRING', 'links': []})
    encoders = [item for item in source['nodes'] if item['type'] == 'TextEncodeQwenImage21']
    assert {item['id'] for item in encoders} == {171, 4015}
    for encoder in encoders:
        slot = append_input(encoder, 'negative_prompt')
        if encoder['inputs'][slot]['link'] is not None:
            continue
        identifier = max([edge[0] for edge in source['links']] + [source['last_link_id']]) + 1
        source['links'].append([identifier, host['id'], 3, encoder['id'], slot, 'STRING'])
        source['last_link_id'] = identifier
        host['outputs'][3]['links'].append(identifier)
        encoder['inputs'][slot]['link'] = identifier
    r.synchronize(blueprint, source)
    return result


def reciprocal(graph: dict[str, Any], root: bool = False) -> None:
    edges = graph['links'] if not root else [dict(zip(
        ('id', 'origin_id', 'origin_slot', 'target_id', 'target_slot', 'type'), edge)) for edge in graph['links']]
    assert len({edge['id'] for edge in edges}) == len(edges)
    for edge in edges:
        origin, target = edge['origin_id'], edge['target_id']
        output = graph['inputs'][edge['origin_slot']] if origin == -10 else node(graph, origin)['outputs'][edge['origin_slot']]
        assert edge['id'] in (output.get('linkIds' if origin == -10 else 'links') or [])
        port = graph['outputs'][edge['target_slot']] if target == -20 else node(graph, target)['inputs'][edge['target_slot']]
        assert edge['id'] in port['linkIds'] if target == -20 else port['link'] == edge['id']
    for item in graph['nodes']:
        for slot, port in enumerate(item.get('inputs', [])):
            if port.get('link') is not None:
                assert any(edge['id'] == port['link'] and edge['target_id'] == item['id'] and edge['target_slot'] == slot for edge in edges)
        for slot, port in enumerate(item.get('outputs', [])):
            for identifier in port.get('links') or []:
                assert any(edge['id'] == identifier and edge['origin_id'] == item['id'] and edge['origin_slot'] == slot for edge in edges)


def assert_whitelist(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> None:
    expected = transform(before)
    assert expected == after, 'non-route field changed'
    for old, new in zip(before, after):
        assert r.graph(old, r.ACCEL_ID) == r.graph(new, r.ACCEL_ID) if any(
            item['id'] == r.ACCEL_ID for item in old['definitions']['subgraphs']) else True
        old_prompt, new_prompt = r.graph(old, r.PROMPT_ID), r.graph(new, r.PROMPT_ID)
        for previous, current in zip(old_prompt['nodes'], new_prompt['nodes']):
            assert previous.keys() == current.keys()
            for key in previous:
                if key not in ('inputs', 'outputs'):
                    assert previous[key] == current[key], (previous['id'], key)
        previous_links = copy.deepcopy(old_prompt['links'])
        if len(node(old_prompt, 153)['inputs']) == 2:
            for edge in previous_links:
                if edge['target_id'] == 153 and edge['target_slot'] >= 1:
                    edge['target_slot'] += 1
        assert previous_links == new_prompt['links'][:len(previous_links)]
        assert old_prompt['outputs'][:3] == new_prompt['outputs'][:3]


def validate(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source, blueprint = documents
    assert transform(documents) == documents, 'negative route missing or stale'
    reciprocal(source, root=True)
    host = r.host(source, r.PROMPT_ID)
    for encoder in [item for item in source['nodes'] if item['type'] == 'TextEncodeQwenImage21']:
        slot = next(index for index, port in enumerate(encoder['inputs']) if port['name'] == 'negative_prompt')
        assert any(edge[1:5] == [host['id'], 3, encoder['id'], slot] for edge in source['links'])
    assert len(host['outputs'][3]['links']) == 2
    results = []
    for document in documents:
        graph = r.graph(document, r.PROMPT_ID)
        reciprocal(graph)
        assert graph['state']['lastLinkId'] >= max(edge['id'] for edge in graph['links'])
        for origin, output, target, name in ((4010, 3, 4011, 'BASE负面'),
                                             (4011, 1, 153, '负面词直写')):
            slot = next(index for index, port in enumerate(node(graph, target)['inputs']) if port['name'] == name)
            assert any((edge['origin_id'], edge['origin_slot'], edge['target_id'], edge['target_slot']) ==
                       (origin, output, target, slot) for edge in graph['links'])
        assert any((edge['origin_id'], edge['origin_slot'], edge['target_id'], edge['target_slot']) ==
                   (153, 1, -20, 3) for edge in graph['links'])
        measured = r.helpers.metrics(graph)
        assert measured['counts']['crossings'] <= 9, measured['counts']
        assert all(value == 0 for key, value in measured['counts'].items() if key != 'crossings'), measured['counts']
        results.append(measured)
    assert all(r.graph(blueprint, r.PROMPT_ID)[key] == value
               for key, value in r.graph(source, r.PROMPT_ID).items())
    assert source['last_link_id'] >= max(edge[0] for edge in source['links'])
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    targets = r.paths()[:2]
    originals = [path.read_bytes() for path in targets]
    before = [json.loads(raw) for raw in originals]
    for document in before:
        reciprocal(r.graph(document, r.PROMPT_ID))
    reciprocal(before[0], root=True)
    after = before if args.check else transform(before)
    assert_whitelist(before, after)
    metrics = validate(after)
    assert transform(after) == after
    if args.check:
        print(json.dumps({'read_only': True, 'metrics': [item['counts'] for item in metrics]}))
        return
    prepared = [r.render(raw, old, new) for raw, old, new in zip(originals, before, after)]
    backup = r.TASK / 'backups/i2i-negative'
    backup.mkdir(parents=True, exist_ok=True)
    for raw in originals:
        snapshot = backup / (r.helpers.digest(raw) + '.json')
        if not snapshot.exists():
            with snapshot.open('xb') as handle:
                handle.write(raw)
        assert snapshot.read_bytes() == raw
    report = {'files': [], 'before_metrics': [r.helpers.metrics(r.graph(item, r.PROMPT_ID))['counts'] for item in before],
              'after_metrics': [item['counts'] for item in metrics], 'idempotent': True, 'reciprocal': True}
    assert all(path.read_bytes() == raw for path, raw in zip(targets, originals)), 'concurrent modification'
    acceleration = r.paths()[2].read_bytes()
    spans = r.helpers.spans(originals[0].decode())
    acceleration_index = next(index for index, graph in enumerate(before[0]['definitions']['subgraphs'])
                              if graph['id'] == r.ACCEL_ID)
    start, end = spans[('definitions', 'subgraphs', acceleration_index)]
    after_spans = r.helpers.spans(prepared[0][0].decode())
    new_start, new_end = after_spans[('definitions', 'subgraphs', acceleration_index)]
    assert originals[0].decode()[start:end] == prepared[0][0].decode()[new_start:new_end]
    for path, raw, (rendered, proof) in zip(targets, originals, prepared):
        assert path.read_bytes() == raw, 'hash guard'
        if rendered != raw:
            path.write_bytes(rendered)
        report['files'].append({'path': str(path.relative_to(r.ROOT)), 'before_sha256': r.helpers.digest(raw),
                                'after_sha256': r.helpers.digest(rendered), 'byte_proof': proof})
    assert r.paths()[2].read_bytes() == acceleration
    report['acceleration_sha256'] = r.helpers.digest(acceleration)
    (r.TASK / 'evidence/i2i-negative-applied.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
