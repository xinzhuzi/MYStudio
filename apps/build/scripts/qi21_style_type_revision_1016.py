"""Incremental, no-git revision ledger for the qi21 style/type boundary."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/qi21-style-type-separation-1016'
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'


def sha(content):
    return hashlib.sha256(content).hexdigest()


def backup(path):
    path = Path(path).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    ledger = OUT / 'changes.json'
    rows = json.loads(ledger.read_text()) if ledger.exists() else []
    if not any(r['path'] == str(path) for r in rows):
        dest = OUT / 'backups' / path.relative_to('/')
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['cp', '-p', str(path), str(dest)], check=True)
        rows.append({'path': str(path), 'backup': str(dest), 'before': sha(path.read_bytes())})
        ledger.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')


def save(path, text):
    path = Path(path)
    before = path.read_text()
    if before != text:
        backup(path)
        if path.read_text() != before:
            raise RuntimeError(f'Concurrent modification: {path}')
        path.write_text(text)


def save_json(path, data):
    save(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def finish():
    ledger = OUT / 'changes.json'
    rows = json.loads(ledger.read_text())
    for row in rows:
        row['after'] = sha(Path(row['path']).read_bytes())
        row['changed'] = row['before'] != row['after']
    ledger.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'tracked': len(rows), 'changed': sum(r['changed'] for r in rows)}))


if __name__ == '__main__':
    if sys.argv[1] == 'backup':
        for arg in sys.argv[2:]:
            backup(ROOT / arg)
    elif sys.argv[1] == 'finish':
        finish()
