#!/usr/bin/env python3
"""Recover historical stack comparisons from existing PNGs, without inference.

Verifies saved pixels and embedded prompts only. Historical generation time,
old external JSON contents and present-day rendering equivalence are unproven.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/09-19-daojie-lora-quick-toggle'
PAIRS = ((117, 118), (119, 120), (119, 121), (122, 123))


def main() -> None:
    app_data = next(p for p in (Path.home() / 'Library/Application Support').iterdir()
                    if p.name == '漫影工作室')
    files = {p.name: p for p in (app_data / 'comfyui/output').iterdir() if p.is_file()}
    records, pixels, graphs = {}, {}, {}
    for number in sorted({n for pair in PAIRS for n in pair}):
        name = f'K2道劫文生图__{number:05}_.png'
        path = files[name]
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        with Image.open(path) as im:
            assert im.size == (1280, 720), name
            prompt = json.loads(im.info['prompt'])
            assert im.mode == 'RGB', (name, im.mode)
            pixels[number] = im.tobytes()
        sampler = prompt['12']['inputs']
        assert sampler['seed'] == 42 and sampler['steps'] == 4 and sampler['cfg'] == 1.0, name
        assert prompt['80']['inputs']['base'] == '人物', name
        graphs[number] = prompt
        records[number] = {'file': str(path), 'file_sha256': digest,
                           'rgb_sha256': hashlib.sha256(pixels[number]).hexdigest(),
                           'size': [1280, 720], 'prompt': prompt}

    a, b, c, d, e = (graphs[n] for n in (117, 118, 119, 120, 121))
    assert a['12']['inputs']['model'] == ['85', 0]
    assert a['85']['class_type'] == 'MyDaojieLoras'
    assert a['85']['inputs']['model'] == ['81', 0]
    assert a['81']['inputs']['model'] == ['47', 0]
    assert a['47']['inputs']['model'] == ['21', 0]
    assert b['90']['class_type'] == 'MyDaojieLoraStack'
    assert b['90']['inputs']['preset'] == '跟随底座型'
    assert b['90']['inputs']['base'] == ['80', 4]
    assert c['12']['inputs']['model'] == ['21', 0]
    for graph, expected in ((b, True), (d, False), (e, True)):
        flags = [v for k, v in graph['90']['inputs'].items() if k.startswith('enable_')]
        assert len(flags) == 14 and all(v is expected for v in flags)
        assert graph['12']['inputs']['model'] == ['90', 0]
        assert graph['90']['inputs']['model'] == ['21', 0]
    weights = [v for k, v in e['90']['inputs'].items() if k.startswith('weight_')]
    assert len(weights) == 14 and all(v == 0 for v in weights)
    assert d['90']['inputs']['preset'] == e['90']['inputs']['preset'] == '专家·全自定义'

    # All shared non-LoRA input branches must be identical, not just seed/size.
    for left, right, excluded in ((117, 118, {'12', '47', '81', '85', '86', '90'}),
                                  (119, 120, {'12', '86', '90'}),
                                  (119, 121, {'12', '86', '90'})):
        ga, gb = graphs[left], graphs[right]
        na = {k: v for k, v in ga.items() if k not in excluded}
        nb = {k: v for k, v in gb.items() if k not in excluded}
        assert na == nb, (left, right, 'non-LoRA branch drift')
        sa = {k: v for k, v in ga['12']['inputs'].items() if k != 'model'}
        sb = {k: v for k, v in gb['12']['inputs'].items() if k != 'model'}
        assert sa == sb

    pairs = []
    for left, right in PAIRS:
        equal = pixels[left] == pixels[right]
        pairs.append({'left': left, 'right': right, 'decoded_rgb_equal': equal})
    assert pairs[0]['decoded_rgb_equal'] and pairs[1]['decoded_rgb_equal']
    assert not pairs[2]['decoded_rgb_equal']
    for record in records.values():
        assert hashlib.sha256(Path(record['file']).read_bytes()).hexdigest() == record['file_sha256']

    report = {'verified_at': datetime.now().astimezone().isoformat(),
              'historical_artifacts_only': True, 'new_engine_run': False,
              'pairs': pairs, 'artifacts': records,
              'limits': ['PNG metadata does not preserve historical external recipe JSON contents.',
                         'No execution-time measurements recovered; file timestamps are not load timings.',
                         'Current presets changed since these historical outputs; fresh equivalence is still required.',
                         'Decoded RGB equality excludes PNG metadata and compression bytes.']}
    out = TASK / 'research' / ('historical_equivalence_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    out.mkdir(parents=True, exist_ok=False)
    (out / 'evidence.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output_directory': str(out), 'pairs': pairs,
                      'new_engine_run': False, 'current_equivalence_verified': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
