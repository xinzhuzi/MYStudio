#!/usr/bin/env python3
"""Recover a 26-case historical matrix from embedded PNG parameters.

Does not run the old generator, edit models, restore shared docs or infer
historical timings/approvals. Dynamic recipe contents were not embedded.
"""
from __future__ import annotations

import ast
import hashlib
import json
from datetime import datetime
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/09-19-daojie-lora-governance'


def main() -> None:
    generator = REPO / 'apps/build/scripts/daojie_ink4_ab_0919.py'
    tree = ast.parse(generator.read_text())
    names = {'SUBJECTS', 'BASE_KEYS', 'NEW_SLOTS'}
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            key = node.targets[0].id
            if key in names:
                constants[key] = ast.literal_eval(node.value)
    assert set(constants) == names
    app = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
    output = app / 'comfyui/output'
    cases = {(kind, None, None): [] for kind in constants['BASE_KEYS']}
    cases.update({(kind, slot, weight): [] for kind in constants['BASE_KEYS']
                  for slot in constants['NEW_SLOTS'] for weight in (0.6, 0.8, 1.0)})
    pixels, graphs = {}, {}
    for path in sorted(output.glob('K2道劫文生图__*.png')):
        with Image.open(path) as im:
            if im.size != (1024, 1024):
                continue
            graph = json.loads(im.info.get('prompt', '{}'))
            sampler = graph.get('12', {}).get('inputs', {})
            if sampler.get('seed') != 42 or sampler.get('steps') != 4 or sampler.get('cfg') != 1:
                continue
            if graph.get('85', {}).get('class_type') != 'MyDaojieLoras':
                continue
            base = graph.get('80', {}).get('inputs', {}).get('base')
            subject = graph.get('50', {}).get('inputs', {}).get('value')
            kinds = [kind for kind, name in constants['BASE_KEYS'].items()
                     if base == name and subject == constants['SUBJECTS'][kind]]
            if len(kinds) != 1:
                continue
            active = [slot for slot in constants['NEW_SLOTS'] if str(slot) in graph]
            if len(active) > 1:
                continue
            slot = active[0] if active else None
            strength = graph[str(slot)]['inputs']['strength_model'] if slot else None
            key = (kinds[0], slot, strength)
            if key not in cases:
                continue
            rgb = im.convert('RGB').tobytes()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        item = {'file': str(path), 'file_sha256': digest, 'rgb_sha256': hashlib.sha256(rgb).hexdigest(),
                'seed': 42, 'size': [1024, 1024], 'steps': 4, 'cfg': 1,
                'type': kinds[0], 'slot': slot, 'weight': strength,
                'lora_file': graph[str(slot)]['inputs']['lora_name'] if slot else None,
                'dynamic_lora_signature': graph['85'].get('is_changed'),
                'prompt': graph}
        cases[key].append(item)
        pixels[str(path)] = rgb
        graphs[str(path)] = graph
    missing = [key for key, entries in cases.items() if not entries]
    assert len(cases) == 26 and not missing, missing
    comparisons = []
    for weight in (0.6, 0.8):
        entries = cases[('scene', 87, weight)]
        assert len(entries) == 2, ('scene', 87, weight, len(entries))
        left, right = (r['file'] for r in entries)
        comparisons.append({'left': left, 'right': right,
                            'decoded_rgb_equal': pixels[left] == pixels[right],
                            'historical_recipe_content_available': False})
    source_hashes = {item['file']: item['file_sha256'] for group in cases.values() for item in group}
    assert all(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest for path, digest in source_hashes.items())
    report = {'verified_at': datetime.now().astimezone().isoformat(),
              'source_generator': str(generator), 'matrix_cases': 26,
              'covered_cases': sum(bool(v) for v in cases.values()),
              'artifacts': sum(len(v) for v in cases.values()),
              'cases': [{'type': key[0], 'slot': key[1], 'weight': key[2], 'images': value}
                        for key, value in cases.items()], 'repeat_image_comparisons': comparisons,
              'new_inference': False, 'user_acceptance': False,
              'limits': ['Historical external JSON contents and applied output strings are unavailable in PNG metadata.',
                         'The recovered 26-case coverage is not the missing original runs_audit.json.',
                         'No prompt IDs, execution timings, model file hashes or present-day visual approval inferred.',
                         'Original bypass87_scene run cannot be independently separated from a cached base image.']}
    out = TASK / 'research' / ('ink4_history_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    out.mkdir(parents=True, exist_ok=False)
    (out / 'evidence.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output_directory': str(out), 'covered_cases': report['covered_cases'],
                      'artifacts': report['artifacts'], 'repeat_image_comparisons': comparisons,
                      'new_inference': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
