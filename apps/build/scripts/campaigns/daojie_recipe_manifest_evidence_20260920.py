#!/usr/bin/env python3
"""Verify saved nine-form/i2i manifests against existing images, read-only.

Checks image bytes and embedded key inputs; never converts manifest status
or old visual scores into present-day acceptance.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/09-19-daojie-nineform-recipes'


def main() -> None:
    prompt_root = REPO / 'docs/prompts'
    saved = next(p for p in prompt_root.iterdir() if p.name == '道劫_九型实弹_配方版_0919')
    app_data = next(p for p in (Path.home() / 'Library/Application Support').iterdir()
                    if p.name == '漫影工作室')
    engine_output = app_data / 'comfyui/output'
    manifests = [saved / 'runs_audit.json', saved / 'i2i/runs_audit.json']
    rows, manifest_records, observed = [], [], {}
    for manifest in manifests:
        raw = manifest.read_bytes()
        observed[str(manifest)] = hashlib.sha256(raw).hexdigest()
        report = json.loads(raw)
        assert isinstance(report['runs'], list)
        manifest_records.append({'file': str(manifest), 'sha256': observed[str(manifest)],
                                 'recorded_status': report['status'], 'recorded_runs': report['runs_total']})
        for run in report['runs']:
            row = {'manifest': str(manifest), 'name': run['name'], 'recorded_ran': run['ran'],
                   'recorded_sha256': run['sha256'], 'copies': [], 'key_inputs_verified': False}
            for label, path in [('output', Path(run['output'])), ('ws_copy', Path(run['ws_copy'])),
                                ('engine_image', engine_output / run['engine_image'])]:
                if not path.is_file():
                    row['copies'].append({'kind': label, 'file': str(path), 'exists': False})
                    continue
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                observed[str(path)] = digest
                item = {'kind': label, 'file': str(path), 'exists': True,
                        'sha256': digest, 'hash_matches_manifest': digest == run['sha256']}
                with Image.open(path) as image:
                    item['size'] = list(image.size)
                    prompt = json.loads(image.info['prompt'])
                samplers = [n['inputs'] for n in prompt.values() if n.get('class_type') == 'KSampler']
                item['sampler_count'] = len(samplers)
                expected = run['key_inputs']
                matched = []
                for sampler in samplers:
                    keys = [k for k in ('seed', 'steps', 'cfg', 'denoise') if k in expected]
                    matched.append(all(sampler.get(k) == expected[k] for k in keys))
                base_ok = prompt['80']['inputs']['base'] == expected['base']
                stack_ok = (prompt['90']['inputs']['preset'] == expected['preset']
                            and prompt['90']['inputs']['base'] == expected['90.base_link'])
                dimensions_ok = ('w' not in expected or item['size'] == [expected['w'], expected['h']])
                item['key_inputs_match'] = bool(matched) and all(matched) and base_ok and stack_ok and dimensions_ok
                row['copies'].append(item)
            row['key_inputs_verified'] = any(c.get('hash_matches_manifest') and c.get('key_inputs_match') for c in row['copies'])
            rows.append(row)
    changed = [path for path, digest in observed.items()
               if not Path(path).is_file() or hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest]
    data_root = REPO / 'apps/backend/engines/comfyui/my_nodes/nodes'
    common = json.loads(manifests[0].read_text())['common']
    data_matches = {}
    for name, key in (('daojie_bases.json', 'bases_json_sha256'), ('daojie_lora_stack.json', 'stack_json_sha256')):
        digest = hashlib.sha256((data_root / name).read_bytes()).hexdigest()
        data_matches[name] = {'current_sha256': digest, 'recorded_sha256': common[key],
                              'equal': digest == common[key]}
    evidence = {'verified_at': datetime.now().astimezone().isoformat(),
                'new_inference': False, 'user_acceptance': False,
                'manifests': manifest_records, 'runs': rows, 'changed_during_read': changed,
                'recipe_version_hashes': data_matches,
                'limitations': ['Passing verifies recorded artifacts, not visual quality or current rendering.',
                               'No user approval inferred from manifest status.',
                               'Dynamic external JSON content is checked by recorded hash when available.']}
    out = TASK / 'research' / ('manifest_evidence_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    out.mkdir(parents=True, exist_ok=False)
    (out / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output_directory': str(out), 'runs': len(rows),
                      'verified_saved_runs': sum(r['key_inputs_verified'] for r in rows),
                      'missing_copies': sum(not c['exists'] for r in rows for c in r['copies']),
                      'hash_mismatches': sum(c['exists'] and not c['hash_matches_manifest'] for r in rows for c in r['copies']),
                      'changed_during_read': changed, 'recipe_version_hashes': data_matches}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
