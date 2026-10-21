#!/usr/bin/env python3
"""Offline verification of QI2.1 Turbo defaults; never submits or reloads an engine."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORT_DIR = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/round14-default-turbo'
COMFY = ROOT / 'apps/backend/engines/comfyui'
TURBO = '0 · Turbo 8步'
SIGMAS = [1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0]


def reject_network(*_args, **_kwargs):
    raise RuntimeError('Offline verification forbids network access')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f'Cannot load verification module: {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    socket.socket.connect = reject_network
    socket.create_connection = reject_network
    sys.path.insert(0, str(ROOT / 'apps/build/scripts'))
    builder = load_module('round14_builder', ROOT / 'apps/build/scripts/qwen21_bridge_template_build.py')
    speed = load_module('round14_speed', COMFY / 'my_nodes/nodes/my_qi21_speed_select.py')
    schema = speed.MyQi21SpeedSelect.INPUT_TYPES()['required']['mode']
    assert schema[0][0] == schema[1]['default'] == speed.DEFAULT_MODE == TURBO
    types = [entry['zh'] for entry in read(ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json')['types']]
    rows = []
    node = speed.MyQi21SpeedSelect()
    for type_name in [*types, '', None]:
        marker = {'turbo': type_name}
        assert node.select(speed.DEFAULT_MODE, latent_turbo=marker, latent_direct={'native': True}, latent_viggle={'viggle': True}, 型名=type_name)[0] is marker
        assert node.check_lazy_status(speed.DEFAULT_MODE, latent_turbo=None, latent_direct=None, latent_viggle=None, 型名=type_name) == ['latent_turbo']
        rows.append({'type': type_name, 'default': TURBO, 'lazy_requested': ['latent_turbo']})
    mirrors = []
    paths = sorted([p for p in (COMFY / 'workflows').rglob('*.json') if p.name in ('qi21-道劫-t2i.json', 'qi21-道劫-i2i.json', 'qi21-edit.json')])
    paths += sorted([p for p in (COMFY / 'my_nodes/subgraphs').iterdir() if p.name.startswith('qi21-道劫-加速子图') and p.suffix == '.json'])
    for path in paths:
        doc = read(path)
        for subgraph in doc.get('definitions', {}).get('subgraphs', []):
            selectors = [n for n in subgraph['nodes'] if n['type'] == 'MyQi21SpeedSelect']
            if not selectors:
                continue
            selector = selectors[0]
            assert selector['widgets_values'] == [TURBO]
            assert selector['widgets_values_named']['mode'] == TURBO
            assert subgraph['widgets'][0] == TURBO
            hosts = [n for n in doc['nodes'] if n['type'] == subgraph['id']]
            assert len(hosts) == 1
            assert hosts[0]['widgets_values'][0] == TURBO
            assert hosts[0]['widgets_values_named']['速度档位'] == TURBO
            mirrors.append({'path': str(path.relative_to(ROOT)), 'verified': True})
    assert len(mirrors) == 6
    info = read(COMFY / 'tests/fixtures/qi21_object_info_snapshot.json')
    exports = []
    for target_name, target in builder.TARGETS.items():
        saved = read(target['canvas'])
        graph, meta = builder.build_graph(info, saved, force_upscale=target['force_upscale'])
        api = read(target['out'])['graph']
        for label, actual in [('source_export', graph), ('saved_api', api)]:
            choice = actual['7:7015']['inputs']
            assert choice['mode'] == TURBO
            assert choice['latent_turbo'] == ['7:7031', 0]
            assert 'latent_direct' not in choice and 'latent_viggle' not in choice
            assert actual['7:7028']['inputs']['lora_name'] == 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors'
            assert actual['7:7028']['inputs']['strength_model'] == 1.0
            assert actual['7:7029']['class_type'] == 'BasicGuider'
            assert actual['7:7031']['inputs']['guider'] == ['7:7029', 0]
            assert actual['7:7031']['inputs']['sigmas'] == ['7:7030', 0]
            assert [float(v) for v in actual['7:7030']['inputs']['sigmas'].split(',')] == SIGMAS
            exports.append({'target': target_name, 'layer': label, 'mode': choice['mode'], 'steps': len(SIGMAS) - 1, 'nodes': len(actual)})
        exports[-1]['source_export_equals_api'] = graph == api
        (REPORT_DIR / f'main-{target_name}-export.json').write_text(json.dumps({'graph': graph, 'meta': meta}, ensure_ascii=False, indent=2) + '\n')
    before = read(REPORT_DIR / 'main-before.json')
    changed = [name for name, old in before.items() if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != old]
    report = {'ok': True, 'network_allowed': False, 'generation_submitted': False, 'default_matrix': rows, 'serialized_mirrors': mirrors, 'exports': exports, 'source_files_checked': len(before), 'source_files_changed': changed}
    (REPORT_DIR / 'main-graph-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'ok': True, 'default_cases': len(rows), 'mirrors': len(mirrors), 'exports': exports, 'changed': changed}, ensure_ascii=False))


if __name__ == '__main__':
    main()
