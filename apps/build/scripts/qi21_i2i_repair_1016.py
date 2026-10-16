#!/usr/bin/env python3
"""Offline, hash-guarded i2i blueprint synchronization and layout repair."""
from __future__ import annotations

import argparse
import copy
import importlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-16-qi21-defaults-install'
sys.path.insert(0, str(Path(__file__).resolve().parent))
helpers = importlib.import_module('qi21_t2i_accel_layout_1016')
PROMPT_ID = 'd47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d'
ACCEL_ID = 'b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b'
SIGMA_NOTE = 'σ表仅影响 viggle；Turbo 使用内部固定官方8步σ表，原生档不使用该控件。'
POSITIONS = {'7011': [1900, 4400], '7012': [4100, 4200], '7010': [5100, 6500],
             '7014': [300, 3600], '7015': [8500, 2200], '7017': [850, 1300],
             '7018': [650, 2400], '7019': [2500, 3800], '7020': [1900, 5500],
             '7021': [2500, 4500], '7022': [3600, 3300], '7023': [5000, 2800],
             '7024': [5500, 4400], '7027': [700, 900], '7028': [1900, 1000],
             '7029': [2500, 1000], '7030': [3100, 1750], '7031': [3700, 1200]}


def paths() -> list[Path]:
    base = ROOT / 'apps/backend/engines/comfyui'
    result = []
    for directory, name in (('workflows', 'qi21-道劫-i2i.json'),
                            ('my_nodes/subgraphs', 'qi21-提示词类型优化子图-i2i.json'),
                            ('my_nodes/subgraphs', 'qi21-道劫-加速子图-i2i.json')):
        matches = list((base / directory).rglob(name))
        assert len(matches) == 1, (name, matches)
        result.append(matches[0])
    return result


def graph(document: dict[str, Any], identifier: str) -> dict[str, Any]:
    matches = [item for item in document['definitions']['subgraphs'] if item['id'] == identifier]
    assert len(matches) == 1
    return matches[0]


def host(document: dict[str, Any], identifier: str) -> dict[str, Any]:
    matches = [item for item in document['nodes'] if item['type'] == identifier]
    assert len(matches) == 1
    return matches[0]


def layout(target: dict[str, Any], positions: dict[str, list[int]]) -> None:
    original_titles = [node.get('title', '') for node in target['nodes']]
    original_titles.extend(group['title'] for group in target['groups'])
    titles = {7012: '[7012] viggle前段7步', 7017: '[7017] 共享噪声',
              7020: '[7020] viggle动态9步σ', 7027: '[7027] 共享Fix×0.5'}
    for node in target['nodes']:
        if node['type'] != 'Note':
            node['pos'] = positions[str(node['id'])][:]
        if node['id'] in titles:
            node['title'] = titles[node['id']]
    notes = [node for node in target['nodes'] if node['type'] == 'Note']
    if not notes:
        assert not any(node['id'] == 7016 for node in target['nodes'])
        notes = [{'id': 7016, 'type': 'Note', 'pos': [300, 80], 'size': [1400, 500],
                  'flags': {}, 'order': 0, 'mode': 0, 'properties': {},
                  'title': '[7016] 加速档位说明', 'widgets_values': [''],
                  'widgets_values_named': {'text': ''}}]
        target['nodes'].extend(notes)
    assert len(notes) == 1
    note = notes[0]
    text = note['widgets_values'][0]
    current_labels = {*titles.values(), '共享输入', 'Turbo 8步', 'viggle/原生', '档位选择', '[7016] 加速档位说明'}
    for explanation in [*original_titles, SIGMA_NOTE, 'viggle 7+2步', '原生40步']:
        if explanation and explanation not in current_labels and explanation not in text:
            text += '\n' + explanation
    note['widgets_values'][0] = text
    note['widgets_values_named']['text'] = text
    note['size'] = [1400, 500]
    note['pos'] = [300, 80]
    node_groups = ((7014, 7016, 7017, 7018, 7027), (7028, 7029, 7030, 7031),
                   (7011, 7019, 7020, 7021, 7012, 7022, 7023, 7024, 7010), (7015,))
    groups = copy.deepcopy(target['groups'][:4])
    by_id = {node['id']: node for node in target['nodes']}
    for group, title, members in zip(groups, ('共享输入', 'Turbo 8步', 'viggle/原生', '档位选择'), node_groups):
        group['title'] = title
        boxes = [helpers.checker._est_box(by_id[identifier]) for identifier in members]
        left = min(box[0] for box in boxes) - 30
        top = min(box[1] for box in boxes) - 55
        group['bounding'] = [left, top, max(box[2] for box in boxes) - left + 30,
                             max(box[3] for box in boxes) - top + 30]
    target['groups'] = groups
    for index, item in enumerate(target['inputs']):
        item['pos'] = [80, 800 + index * 20]
    for item in target['outputs']:
        item['pos'] = [9000, 1825]
    target['inputNode']['bounding'] = [80, 760, 160, 300]
    target['outputNode']['bounding'] = [9000, 1760, 160, 180]


def synchronize(blueprint: dict[str, Any], source: dict[str, Any]) -> None:
    authoritative = graph(source, PROMPT_ID)
    target = graph(blueprint, PROMPT_ID)
    target.update(copy.deepcopy(authoritative))
    original_host = host(blueprint, PROMPT_ID)
    source_host = host(source, PROMPT_ID)
    named = copy.deepcopy(source_host['widgets_values_named'])
    original_host['inputs'] = []
    for item in authoritative['inputs']:
        slot = {'name': item['name'], 'type': item['type'], 'link': None}
        if item['name'] in named:
            slot['widget'] = {'name': item['name']}
        original_host['inputs'].append(slot)
    original_host['outputs'] = [{'name': item['name'], 'type': item['type'], 'links': []}
                                for item in authoritative['outputs']]
    original_host['widgets_values'] = copy.deepcopy(source_host['widgets_values'])
    original_host['widgets_values_named'] = named
    original_host['properties'].update(copy.deepcopy(source_host['properties']))


def frozen(document: dict[str, Any], kind: int) -> dict[str, Any]:
    result = copy.deepcopy(document)
    if kind == 1:
        target = graph(result, PROMPT_ID)
        for key in graph(json.loads(paths()[0].read_bytes()), PROMPT_ID):
            target.pop(key, None)
        target_host = host(result, PROMPT_ID)
        for key in ('inputs', 'outputs', 'widgets_values', 'widgets_values_named'):
            target_host.pop(key, None)
        source_properties = host(json.loads(paths()[0].read_bytes()), PROMPT_ID)['properties']
        for key in source_properties:
            target_host['properties'].pop(key, None)
        return result
    target = graph(result, ACCEL_ID)
    target.pop('groups')
    target['nodes'] = [node for node in target['nodes'] if not (node['id'] == 7016 and node['type'] == 'Note')]
    for node in target['nodes']:
        for key in ('pos', 'size', 'title'):
            node.pop(key, None)
        if node['type'] == 'Note':
            node['widgets_values'][0] = '<allowed explanation>'
            node['widgets_values_named']['text'] = '<allowed explanation>'
    for side in ('inputs', 'outputs'):
        for item in target[side]:
            item.pop('pos', None)
    for side in ('inputNode', 'outputNode'):
        target[side].pop('bounding', None)
    return result


def render(raw: bytes, before: dict[str, Any], after: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    text = raw.decode()
    locations = helpers.spans(text)
    changes = []

    def visit(old: Any, new: Any, location: tuple[str | int, ...]) -> None:
        if old == new:
            return
        if isinstance(old, dict) and isinstance(new, dict) and old.keys() == new.keys():
            for key in old:
                visit(old[key], new[key], (*location, key))
        elif isinstance(old, list) and isinstance(new, list) and len(old) == len(new):
            for index, (old_item, new_item) in enumerate(zip(old, new)):
                visit(old_item, new_item, (*location, index))
        else:
            start, end = locations[location]
            line_start = text.rfind('\n', 0, start) + 1
            indentation = len(text[line_start:]) - len(text[line_start:].lstrip(' '))
            replacement = json.dumps(new, ensure_ascii=False, indent=2).replace('\n', '\n' + ' ' * indentation)
            changes.append((start, end, replacement, location))

    visit(before, after, ())
    cursor = 0
    pieces = []
    untouched = []
    for start, end, replacement, location in sorted(changes):
        assert cursor <= start
        chunk = text[cursor:start]
        pieces.extend((chunk, replacement))
        untouched.append(helpers.digest(chunk.encode()))
        cursor = end
    pieces.append(text[cursor:])
    untouched.append(helpers.digest(text[cursor:].encode()))
    rendered = ''.join(pieces).encode()
    assert json.loads(rendered) == after
    return rendered, {'changed_paths': [list(item[3]) for item in changes],
                      'untouched_chunk_sha256': untouched, 'outside_bytes_preserved': True}


def validate(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source, prompt, acceleration = documents
    source_prompt = graph(source, PROMPT_ID)
    target_prompt = graph(prompt, PROMPT_ID)
    assert all(target_prompt[key] == value for key, value in source_prompt.items())
    target_host = host(prompt, PROMPT_ID)
    for side in ('inputs', 'outputs'):
        assert [(item['name'], item['type']) for item in target_host[side]] == [
            (item['name'], item['type']) for item in source_prompt[side]]
    assert target_host['widgets_values'] == host(source, PROMPT_ID)['widgets_values']
    assert target_host['widgets_values_named'] == host(source, PROMPT_ID)['widgets_values_named']
    assert all(item.get('widget') == {'name': item['name']} for item in target_host['inputs']
               if item['name'] in target_host['widgets_values_named'])
    source_acceleration = graph(source, ACCEL_ID)
    assert all(graph(acceleration, ACCEL_ID)[key] == value for key, value in source_acceleration.items())
    results = []
    for target in (source_acceleration, graph(acceleration, ACCEL_ID)):
        measured = helpers.metrics(target)
        assert measured['counts']['crossings'] <= 11, measured
        assert all(value == 0 for key, value in measured['counts'].items() if key != 'crossings'), measured
        assert len(target['groups']) <= 4
        assert all(len(group['title']) <= 20 for group in target['groups'])
        results.append(measured)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    targets = paths()
    originals = [path.read_bytes() for path in targets]
    before = [json.loads(raw) for raw in originals]
    if args.check:
        results = validate(before)
        print(json.dumps({'read_only': True, 'metrics': [item['counts'] for item in results]}, ensure_ascii=False))
        return
    positions = POSITIONS
    after = copy.deepcopy(before)
    synchronize(after[1], after[0])
    for document in (after[0], after[2]):
        layout(graph(document, ACCEL_ID), positions)
    for kind in range(3):
        assert frozen(before[kind], kind) == frozen(after[kind], kind), 'semantic whitelist violation'
    assert graph(before[0], PROMPT_ID) == graph(after[0], PROMPT_ID)
    results = validate(after)
    repeated = copy.deepcopy(after)
    synchronize(repeated[1], repeated[0])
    for document in (repeated[0], repeated[2]):
        layout(graph(document, ACCEL_ID), positions)
    assert repeated == after, 'non-idempotent transform'
    prepared = [render(raw, old, new) for raw, old, new in zip(originals, before, after)]
    for (rendered, _), document in zip(prepared, after):
        assert render(rendered, document, document)[0] == rendered
    backup = TASK / 'backups/i2i-repair'
    backup.mkdir(parents=True, exist_ok=True)
    for raw in originals:
        snapshot = backup / (helpers.digest(raw) + '.json')
        if not snapshot.exists():
            with snapshot.open('xb') as handle:
                handle.write(raw)
        assert snapshot.read_bytes() == raw
    assert all(path.read_bytes() == raw for path, raw in zip(targets, originals)), 'concurrent modification'
    report = {'files': [], 'metrics': results,
              'before_metrics': [helpers.metrics(graph(before[index], ACCEL_ID)) for index in (0, 2)],
              'semantic_whitelist_equal': True,
              'note_added_reason': 'Both original acceleration definitions contain no Note; isolated non-executable Note 7016 preserves titles and sigma explanation. No computational topology or links changed.',
              'prompt_source_unchanged': True, 'idempotent': True}
    for path, raw, (rendered, proof) in zip(targets, originals, prepared):
        current = path.read_bytes()
        assert current == raw and helpers.digest(current) == helpers.digest(raw), 'hash guard'
        if rendered != raw:
            path.write_bytes(rendered)
        report['files'].append({'path': str(path.relative_to(ROOT)), 'before_sha256': helpers.digest(raw),
                                'after_sha256': helpers.digest(rendered), 'byte_proof': proof})
    assert all(path.read_bytes() == item[0] for path, item in zip(targets, prepared))
    (TASK / 'evidence/i2i-graph-repair-applied.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'applied': True, 'metrics': [item['counts'] for item in results]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
