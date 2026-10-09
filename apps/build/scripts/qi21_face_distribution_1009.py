#!/usr/bin/env python3
"""Guarded distribution of existing Qi21 assets; never creates user workflows."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-09-qi21-source-prompt-review-fixes'
ENGINE = ROOT / 'apps/backend/engines/comfyui'
SOURCE = next((ROOT / 'apps/frontend/assets/studio-manuals/art_skills').glob('*/json/qi21_bases.json'))
APP_RESOURCES = next(Path('/Applications').glob('*.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json')).parents[4]
BUILD_SOURCE = next((ROOT / 'apps/release/build').rglob('studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'))
BUILD_RESOURCES = BUILD_SOURCE.parents[4]
previous = json.loads((TASK / 'research/distribution-plan.json').read_text())
ENGINE_DATA = Path(previous['destinations'][2]['realpath'])
ENGINE_HOME = ENGINE_DATA.parent.parent / 'ComfyUI'
MA_SOURCE = Path(previous['destinations'][3]['realpath'])
assert APP_RESOURCES.name == BUILD_RESOURCES.name == 'Resources'
assert ENGINE_HOME.is_dir()

if '--apply' not in sys.argv:
    pairs = [(SOURCE, p) for p in [APP_RESOURCES / SOURCE.relative_to(ROOT / 'apps/frontend/assets'), BUILD_SOURCE, ENGINE_DATA, MA_SOURCE]]
    graphs = list((ENGINE / 'my_nodes/subgraphs').glob('qi21-*.json'))
    graphs += list((ENGINE / 'workflows').rglob('qi21-*.json'))
    graphs += list((ENGINE / 'workflows').rglob('qwen21-daotu-rgba-t2i.json'))
    assert len(graphs) == 7, 'Review new graph inventory before distribution'
    absent_user = []
    for src in graphs:
        rel = src.relative_to(ENGINE)
        pairs += [(src, APP_RESOURCES / 'backend/engines/comfyui' / rel), (src, BUILD_RESOURCES / 'backend/engines/comfyui' / rel)]
        if rel.parts[0] == 'my_nodes':
            pairs.append((src, ENGINE_HOME / 'custom_nodes/my-nodes' / src.relative_to(ENGINE / 'my_nodes')))
        else:
            user = ENGINE_HOME / 'user/default/workflows' / src.relative_to(ENGINE / 'workflows')
            if user.exists():
                pairs.append((src, user))
            else:
                absent_user.append(str(user))
    entries = []
    for i, (src, dst) in enumerate(pairs):
        assert src.is_file() and dst.is_file(), f'Missing existing distribution: {dst}'
        a, b = src.read_bytes(), dst.read_bytes()
        json.loads(a); json.loads(b)
        entries.append({'source': str(src), 'destination': str(dst), 'source_sha256': hashlib.sha256(a).hexdigest(), 'before_sha256': hashlib.sha256(b).hexdigest(), 'changed': a != b, 'backup': f'backups/face-distribution-{i + 1}.json'})
    plan = {'entries': entries, 'absent_user_workflows': absent_user}
    (TASK / 'research/face-distribution-plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'pairs': len(entries), 'changed': sum(e['changed'] for e in entries), 'absent_user_workflows': len(absent_user)}, ensure_ascii=False))
else:
    plan = json.loads((TASK / 'research/face-distribution-plan.json').read_text())
    # Validate all sources and destinations before copying the first file.
    for entry in plan['entries']:
        assert hashlib.sha256(Path(entry['source']).read_bytes()).hexdigest() == entry['source_sha256'], 'Source changed after plan'
        assert hashlib.sha256(Path(entry['destination']).read_bytes()).hexdigest() == entry['before_sha256'], 'Destination changed concurrently'
        if entry['changed']:
            assert not (TASK / entry['backup']).exists(), 'Never overwrite backup'
    for entry in plan['entries']:
        if entry['changed']:
            src, dst = Path(entry['source']), Path(entry['destination'])
            shutil.copy2(dst, TASK / entry['backup'])
            assert hashlib.sha256(dst.read_bytes()).hexdigest() == entry['before_sha256'], 'Destination changed before copy'
            assert hashlib.sha256(src.read_bytes()).hexdigest() == entry['source_sha256'], 'Source changed before copy'
            shutil.copy2(src, dst)
    for entry in plan['entries']:
        assert Path(entry['source']).read_bytes() == Path(entry['destination']).read_bytes(), entry['destination']
    for path in plan['absent_user_workflows']:
        assert not Path(path).exists(), 'Unexpected user workflow created'
    result = {'ok': True, 'verified_pairs': len(plan['entries']), 'copied': sum(e['changed'] for e in plan['entries']), 'absent_user_workflows_not_created': len(plan['absent_user_workflows']), 'entries': plan['entries']}
    (TASK / 'research/face-distribution-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'entries'}, ensure_ascii=False))
