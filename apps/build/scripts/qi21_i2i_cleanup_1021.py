"""Remove only pure canvas reroutes; preserve every executable API value."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import qi21_i2i_negative_1016 as negative
import qi21_i2i_repair_1016 as repair
import qwen21_bridge_template_build as builder

ROOT = repair.ROOT
RESEARCH = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/round16-i2i-node-cleanup'
REMOVED = {19, 42, 43, 44, 7403}
NOTE = ('\n\n现行编码分工：\n'
        '[4015] 多参考编码：原生档使用多张参考图的条件；其latent用于局部编辑/画风转换的参考画幅。\n'
        '[171] 加速编码：Turbo/viggle使用主参考图与透明锚；它与[4015]不能合并为同一路条件。\n'
        '纯转接节点已移除，模型、VAE、条件和画幅信号直接连接真实源；用途判断仍由装配子图内[4022]完成。')
TITLES = {4015: '[4015] 多参考编码·原生与画幅', 171: '[171] 加速编码·主参考+透明锚'}


def paths():
    return repair.paths()[:2]


def node(graph, identifier):
    return next(n for n in graph['nodes'] if n['id'] == identifier)


def collapse_reroutes(graph):
    """Contract one-input pass-throughs, keeping consumer link IDs and fanout."""
    reroutes = [n for n in graph['nodes'] if n['type'] == 'Reroute']
    for route in reroutes:
        incoming, = [e for e in graph['links'] if e[3] == route['id']]
        assert incoming[1] != route['id'], 'self-referential reroute'
        outgoing = [e for e in graph['links'] if e[1] == route['id']]
        assert incoming[4] == 0 and all(e[2] == 0 for e in outgoing)
        source = node(graph, incoming[1])['outputs'][incoming[2]]
        source['links'] = [new for old in source['links'] for new in
                           ([e[0] for e in outgoing] if old == incoming[0] else [old])]
        for edge in outgoing:
            edge[1:3] = incoming[1:3]
        graph['links'].remove(incoming)
        graph['nodes'].remove(route)
    return graph


def validate(documents):
    source, blueprint = documents
    assert not any(n['type'] == 'Reroute' for n in source['nodes'])
    prompt = repair.graph(source, repair.PROMPT_ID)
    assert all(repair.graph(blueprint, repair.PROMPT_ID)[k] == v for k, v in prompt.items())
    for doc in documents:
        negative.reciprocal(doc, root=True)
        host = repair.host(doc, repair.PROMPT_ID)
        assert [(p['name'], p['type']) for p in host['outputs']] == [(p['name'], p['type']) for p in prompt['outputs']]
        for sub in doc['definitions']['subgraphs']:
            negative.reciprocal(sub)
            assert not any(e['origin_id'] == -10 and e['target_id'] == -20 for e in sub['links'])
    route = node(prompt, 4022)
    assert route['type'] == 'MyQi21PurposeCanvas' and route['widgets_values'] == [] and route['widgets_values_named'] == {}
    assert route['inputs'][0]['link'] == 287 and route['outputs'][0]['links'] == [288]
    edges = {e['id']: e for e in prompt['links']}
    assert edges[287] == {'id': 287, 'origin_id': -10, 'origin_slot': 7, 'target_id': 4022, 'target_slot': 0, 'type': 'COMBO'}
    assert edges[288] == {'id': 288, 'origin_id': 4022, 'origin_slot': 0, 'target_id': -20, 'target_slot': 5, 'type': 'BOOLEAN'}
    assert prompt['outputs'][5]['name'] == '使用类型画幅' and prompt['outputs'][5]['type'] == 'BOOLEAN'
    assert prompt['outputs'][5]['linkIds'] == [288]
    root_edges = {e[0]: e for e in source['links']}
    for wanted in ([32, 6, 5, 20, 2, 'BOOLEAN'], [282, 171, 0, 7, 3, 'CONDITIONING'],
                   [24, 1, 0, 9, 0, 'MODEL'], [37, 3, 0, 5, 1, 'VAE']):
        assert root_edges[wanted[0]] == wanted
    assert repair.host(source, repair.PROMPT_ID)['outputs'][5]['links'] == [32]
    assert repair.host(blueprint, repair.PROMPT_ID)['outputs'][5]['links'] == []
    assert repair.host(source, repair.PROMPT_ID)['widgets_values_named'] == repair.host(blueprint, repair.PROMPT_ID)['widgets_values_named']
    assert repair.host(source, repair.PROMPT_ID)['widgets_values_named']['组装用途'] == '局部编辑'
    assert [279, 4015, 0, 7, 1, 'CONDITIONING'] in source['links']
    assert [281, 4015, 2, 20, 0, 'LATENT'] in source['links']
    assert all(node(source, k)['title'] == v for k, v in TITLES.items())
    assert NOTE in node(source, 402)['widgets_values'][0] and NOTE in node(source, 402)['widgets_values_named']['text']


def transform(documents):
    result = copy.deepcopy(documents)
    source = result[0]
    actual = {n['id'] for n in source['nodes'] if n['type'] == 'Reroute'}
    if not actual:
        validate(result)
        return result
    assert actual == REMOVED, actual
    collapse_reroutes(source)
    for identifier, title in TITLES.items():
        node(source, identifier)['title'] = title
    note = node(source, 402)
    assert NOTE not in note['widgets_values'][0] and NOTE not in note['widgets_values_named']['text']
    note['widgets_values'][0] += NOTE
    note['widgets_values_named']['text'] += NOTE
    validate(result)
    return result


def projection(source, info, all_branches=False):
    if all_branches:
        with patch.object(builder, 'selected_graph', side_effect=lambda graph, outputs: graph):
            return builder.flatten_canvas(source, info)
    return builder.flatten_canvas(source, info)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    targets = paths()
    raws = [p.read_bytes() for p in targets]
    docs = [json.loads(raw) for raw in raws]
    after = transform(docs)
    info = json.loads((ROOT / 'apps/backend/engines/comfyui/tests/fixtures/qi21_object_info_snapshot.json').read_bytes())
    assert projection(docs[0], info, True) == projection(after[0], info, True), 'all-branch API changed'
    assert projection(docs[0], info) == projection(after[0], info), 'selected API changed'
    current, _ = builder.build_graph(info, after[0], force_upscale=False)
    assert current == json.loads(builder.OUT_I2I.read_bytes())['graph'], 'saved API changed'
    if not args.apply or after == docs:
        print('valid; zero reroutes; API unchanged; no source writes' if after == docs else 'dry-run equivalent; use --apply to write')
        return
    backup = RESEARCH / 'backups'
    backup.mkdir(parents=True, exist_ok=True)
    extras = [builder.OUT_I2I, ROOT / 'apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py', ROOT / 'apps/build/scripts/test_qi21_i2i_canvas_1021.py']
    receipts = []
    for p in [*targets, *extras]:
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        dest = backup / (digest + p.suffix)
        if not dest.exists():
            shutil.copy2(p, dest)
        assert dest.read_bytes() == p.read_bytes()
        receipts.append({'path': str(p.relative_to(ROOT)), 'before_sha256': digest, 'backup': str(dest.relative_to(ROOT))})
    prepared = [repair.render(raw, old, new)[0] for raw, old, new in zip(raws, docs, after)]
    for p, raw, new in zip(targets, raws, prepared):
        assert p.read_bytes() == raw, 'concurrent edit'
        if raw != new:
            p.write_bytes(new)
    (RESEARCH / 'files-manifest.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
    print('applied: main nodes 34→29; five Reroutes removed; all-branch/selected/saved APIs identical')


if __name__ == '__main__':
    main()
