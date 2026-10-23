#!/usr/bin/env python3
"""Rename the two requested live Daojie documents without changing sample prompts."""
from pathlib import Path
import argparse
import ast
import hashlib
import json
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/daojie-type-docs-charsheet-1016'
PAIRS = [('道劫_九型主体句示例', '道劫_类型主体句示例'),
         ('道劫_九型配方', '道劫_类型配方')]
SCOPES = ['docs/prompts', 'docs/comfyui-kb',
          'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng',
          'apps/build/scripts', 'apps/backend/comfyui/workflows']
SELF = Path(__file__).resolve()


def digest(b):
    return hashlib.sha256(b).hexdigest()


def proposed(p, s):
    for old, new in PAIRS:
        s = s.replace(old + '.md', new + '.md').replace(old + '》', new + '》')
    if p.name == PAIRS[0][0] + '.md':
        s = s.replace('# 道劫九型·主体句示例九条(09-19)',
                      '# 道劫类型·主体句示例（共十型，09-19 起）', 1)
    if p.name == PAIRS[1][0] + '.md':
        s = s.replace('# 道劫九型出图配方矩阵', '# 道劫类型出图配方矩阵', 1)
        s = s.replace('## 一、九型配方矩阵', '## 一、类型配方矩阵', 1)
        s = s.replace('——九型→十型,「九型」旧称在本文历史叙述中保留。',
                      '——自1015起覆盖十型，当前文档统一称「类型」，按日期保存的九型实验记录保留原称。', 1)
    if p.relative_to(ROOT).as_posix() == 'docs/prompts/README.md':
        s = s.replace('道劫底座、九型配方及角色设定说明', '道劫底座、类型配方及角色设定说明', 1)
        s = s.replace('[道劫十型·主体句示例(', '[道劫类型·主体句示例(', 1)
        s = s.replace('[道劫九型出图配方矩阵(', '[道劫类型出图配方矩阵(', 1)
    return s


def collect():
    cmd = ['rg', '-l', '-F']
    for old, _ in PAIRS:
        cmd += ['-e', old]
    cmd += ['-g', '*.md', '-g', '*.json', '-g', '*.py', *SCOPES]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    assert result.returncode in (0, 1), result.stderr
    paths = {ROOT / line for line in result.stdout.splitlines()}
    paths.update(p for p in (ROOT / 'docs/prompts').iterdir()
                 if any(p.name == old + '.md' for old, _ in PAIRS))
    changes, archives = [], []
    for p in sorted(paths):
        if p.resolve() == SELF:
            continue
        if '档案' in p.parts:
            archives.append(str(p.relative_to(ROOT)))
            continue
        raw = p.read_bytes()
        before = raw.decode('utf-8')
        after = proposed(p, before)
        target = p
        for old, new in PAIRS:
            if p.parent == ROOT / 'docs/prompts' and p.name == old + '.md':
                target = p.with_name(new + '.md')
                assert not target.exists(), target
        if after != before or target != p:
            stage = 'workflow' if 'workflows' in p.parts else ('scripts' if p.suffix == '.py' else 'docs')
            if p.suffix == '.py':
                ast.parse(after, filename=str(p))
            if p.suffix == '.json':
                json.loads(after)
            if p.name == PAIRS[0][0] + '.md':
                fences = lambda t: re.findall(r'^```[^\n]*\n(.*?)^```', t, re.M | re.S)
                assert fences(before) == fences(after)
                assert len(re.findall(r'^## \d+\.', after, re.M)) == 10
            changes.append((p, target, raw, after.encode('utf-8'), stage))
    return changes, archives


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=['plan', 'docs', 'scripts', 'workflow'], default='plan')
    args = parser.parse_args()
    changes, archives = collect()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.stage == 'plan':
        data = [{'source': str(p.relative_to(ROOT)), 'target': str(t.relative_to(ROOT)),
                 'stage': stage, 'sha256': digest(raw)} for p,t,raw,after,stage in changes]
        (OUT / 'rename-plan.json').write_text(json.dumps({'changes': data, 'preserved_archives': archives}, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'planned': len(data), 'stages': {s: sum(c['stage'] == s for c in data) for s in ['docs','scripts','workflow']}, 'preserved_archives': archives}, ensure_ascii=False))
        return
    selected = [c for c in changes if c[4] == args.stage]
    # Validate all preimages and the workflow quiet gate before any write in this stage.
    for p,t,raw,after,stage in selected:
        assert p.read_bytes() == raw, f'Concurrent edit: {p}'
        if stage == 'workflow':
            age = time.time() - p.stat().st_mtime
            if age < 1800:
                raise SystemExit(f'QUIET_GATE_PENDING: age={age:.0f}s; required=1800s; zero workflow writes')
    records = []
    for p,t,raw,after,stage in selected:
        backup = OUT / 'backups' / p.relative_to(ROOT)
        backup.parent.mkdir(parents=True, exist_ok=True)
        assert not backup.exists(), backup
        shutil.copy2(p, backup)
        assert backup.read_bytes() == raw
        assert p.read_bytes() == raw, f'Concurrent edit: {p}'
        p.write_bytes(after)
        if t != p:
            p.rename(t)
        assert t.read_bytes() == after
        records.append({'source': str(p.relative_to(ROOT)), 'target': str(t.relative_to(ROOT)),
                        'before_sha256': digest(raw), 'after_sha256': digest(after),
                        'backup': str(backup.relative_to(ROOT))})
    (OUT / f'rename-{args.stage}.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'stage': args.stage, 'changed': len(records)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
