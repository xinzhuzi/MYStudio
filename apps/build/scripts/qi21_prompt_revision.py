"""Guarded small-batch edits for the user-approved Daojie prompt revision."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/daojie-qi21-prompt-revision-1016'
OUT.mkdir(parents=True, exist_ok=True)
LEDGER = OUT / 'changes.json'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write(path: Path, text: str, why: str) -> None:
    path = path.resolve()
    before = path.read_bytes()
    after = text.encode('utf-8')
    if before == after:
        return
    relative = path.relative_to(ROOT) if path.is_relative_to(ROOT) else Path('external') / path.relative_to('/')
    backup = OUT / 'backups' / relative
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        shutil.copy2(path, backup)
    if path.read_bytes() != before:
        raise RuntimeError(f'Concurrent change: {path}')
    path.write_bytes(after)
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else []
    row = next((x for x in ledger if x['path'] == str(path)), None)
    if row is None:
        row = {'path': str(path), 'backup': str(backup), 'before': sha(backup.read_bytes()), 'changes': []}
        ledger.append(row)
    row['after'] = sha(after)
    if why not in row['changes']:
        row['changes'].append(why)
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')


def replace(path: Path, old: str, new: str, why: str, count: int = 1) -> None:
    text = path.read_text()
    if text.count(old) != count:
        raise RuntimeError(f'{path}: expected {count} matches, got {text.count(old)}: {old[:80]}')
    write(path, text.replace(old, new), why)


def json_write(path: Path, data: dict, why: str) -> None:
    write(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n', why)
