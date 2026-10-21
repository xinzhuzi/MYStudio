"""Verify the bounded Round12 source slice without touching the runtime."""
from __future__ import annotations

import ast
import difflib
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/round12-prompt-conflict'
RUNNER = EVIDENCE.parent / 'round11-i2i-canvas/run-offline.py'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def differences(old, new, path=()):
    if isinstance(old, dict) and isinstance(new, dict) and old.keys() == new.keys():
        return [p for k in old for p in differences(old[k], new[k], path + (k,))]
    if isinstance(old, list) and isinstance(new, list) and len(old) == len(new):
        return [p for i, (a, b) in enumerate(zip(old, new))
                for p in differences(a, b, path + (i,))]
    return [] if old == new else [path]


def run_check(label: str, command: list[str], env: dict[str, str]):
    result = subprocess.run(command, cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    (EVIDENCE / f'main-{label}.log').write_text(result.stdout)
    return {'command': command, 'exitCode': result.returncode,
            'log': f'main-{label}.log', 'summary': result.stdout.splitlines()[-4:]}


def main():
    manifest = json.loads((EVIDENCE / 'backup-manifest.json').read_bytes())
    source_diffs = []
    for item in manifest:
        before, current = Path(item['backup']), Path(item['path'])
        assert digest(ROOT / before) == item['beforeSha256']
        source_diffs.extend(difflib.unified_diff(
            (ROOT / before).read_text().splitlines(True),
            (ROOT / current).read_text().splitlines(True),
            fromfile=str(before), tofile=str(current)))
    (EVIDENCE / 'main-source.diff').write_text(''.join(source_diffs))
    snapshots = {item['path']: item for item in manifest}
    bases = next(path for path in snapshots if path.endswith('/qi21_bases.json'))
    old = json.loads((ROOT / snapshots[bases]['backup']).read_bytes())
    new = json.loads((ROOT / bases).read_bytes())
    index = next(i for i, item in enumerate(old['types']) if item['zh'] == '人物多视图')
    changed = differences(old, new)
    assert set(changed) == {('rgba', '_doc'), ('types', index, 'positive_text'),
                            ('types', index, 'rgba_positive')}, changed
    assert old['art_style_base'] == new['art_style_base']
    frozen = json.loads((EVIDENCE / 'immutable-before.json').read_bytes())
    assert all(digest(ROOT / item['path']) == item['sha256'] for item in frozen)
    node = next(path for path in snapshots if path.endswith('/my_qi21_prompt_select.py'))
    trees = [ast.parse((ROOT / path).read_text())
             for path in (snapshots[node]['backup'], node)]
    methods = [{n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
               for tree in trees]
    assert methods[0].keys() == methods[1].keys()
    changed_methods = [name for name in methods[0] if ast.dump(methods[0][name]) != ast.dump(methods[1][name])]
    assert set(changed_methods) == {'INPUT_TYPES', 'compose'}, changed_methods
    assert ast.dump(methods[0]['compose'].args) == ast.dump(methods[1]['compose'].args)
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    names = ['test_my_qi21_prompt_select.py', 'test_my_qi21_final_output.py',
             'test_my_qi21_base.py', 'test_my_qi21_prompt_assembly.py',
             'test_my_qi21_rgba_select.py', 'test_my_qi21_transparent_lean_1008.py',
             'test_qi21_rgba_text.py', 'test_qi21_prompt_conflict_1021.py']
    tests = ['apps/backend/engines/comfyui/my_nodes/tests/' + name for name in names]
    tests.append('apps/build/scripts/test_qi21_i2i_canvas_1021.py')
    assert all((ROOT / path).is_file() for path in tests)
    focused = run_check('focused', [sys.executable, '-B', str(RUNNER), '-q', *tests], env)
    assert focused['exitCode'] == 0, focused
    assert 'SIDE_EFFECT_ATTEMPTS []' in (EVIDENCE / focused['log']).read_text()
    contract = run_check('workflow-contract', [sys.executable, '-B', str(RUNNER), '-q',
        'apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py'], env)
    output = (EVIDENCE / contract['log']).read_text()
    assert 'SIDE_EFFECT_ATTEMPTS []' in output
    failed = [line for line in output.splitlines() if line.startswith('FAILED ')]
    assert contract['exitCode'] == 1 and len(failed) == 1 and '::test_prompt_source_single_truth' in failed[0], failed
    assert '装机固定位漂移: qi21_bases.json' in output
    report = {'scope': 'source/offline only', 'dataChangedPaths': changed,
              'styleUnchanged': True, 'frozenFilesUnchanged': len(frozen),
              'changedMethods': changed_methods, 'composeSignatureUnchanged': True,
              'focused': focused, 'workflowContract': contract,
              'remaining': ['installed prompt library differs from repository'],
              'aggregateGatePassed': False, 'runtimeReloaded': False,
              'installationPerformed': False, 'modelGenerationSubmitted': False,
              'sourceHashes': {item['path']: digest(ROOT / item['path']) for item in manifest}}
    (EVIDENCE / 'main-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
