"""Collect current repair evidence without Git or modifying user data."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[4]
out = root / 'apps/output/automation/project-gap-audit-1017'
backups = out / 'backups-1018'
changes = []
for saved in sorted(backups.rglob('*')):
    if not saved.is_file():
        continue
    rel = saved.relative_to(backups)
    if rel.parts[0] not in ('apps', 'docs'):
        continue
    current = root / rel
    if current.is_file() and saved.read_bytes() != current.read_bytes():
        changes.append({'path': str(rel), 'backup_sha256': hashlib.sha256(saved.read_bytes()).hexdigest(), 'current_sha256': hashlib.sha256(current.read_bytes()).hexdigest()})
extra = [
    'apps/frontend/lib/storage/persistence-status.ts',
    'apps/frontend/lib/storage/persistence-status.test.ts',
    'apps/frontend/lib/storage/storage-confirmation.test.ts',
    'apps/frontend/lib/storage/split-resource-contract.test.ts',
    'apps/frontend/components/PersistenceFailureBanner.tsx',
    'apps/frontend/components/PersistenceFailureBanner.test.tsx',
    'apps/frontend/components/panels/studio/workbench-queue-actions.test.tsx',
    'apps/frontend/electron/ipc/files/file-storage-durability.test.ts',
    'apps/frontend/electron/rendering/plugins/remotion/queue/queue-consistency.test.ts',
    'apps/frontend/lib/storage/indexed-db-storage.test.ts',
    'apps/frontend/lib/storage/project-storage.test.ts',
    'apps/frontend/electron/ipc/studio/remotion-queue-ipc.test.ts',
    'apps/frontend/electron/rendering/plugins/remotion/studio/remotion-studio-start-options.test.ts',
]
for rel in extra:
    current = root / rel
    assert current.is_file(), rel
    changes.append({'path': rel, 'current_sha256': hashlib.sha256(current.read_bytes()).hexdigest(), 'note': 'new source or updated regression; no baseline hash captured'})
(out / 'changes-1018.json').write_text(json.dumps(changes, ensure_ascii=False, indent=2))
for log in Path('/tmp').glob('gap-*-1018.log'):
    shutil.copy2(log, out / log.name)
for name in ['storage-red-1018.log', 'split-red-1018.log', 'queue-red-1018.log', 'storage-integrated-1018.log', 'storage-edges-1018.log', 'split-contract-1018.log', 'queue-races-1018.log', 'persistence-ui-1018.log', 'audit-green-1018.log']:
    source = Path('/tmp') / name
    if source.is_file():
        shutil.copy2(source, out / name)
shutil.copy2(root / 'apps/output/automation/quality-gate-report.json', out / 'quality-gate-report-1018.json')
print(json.dumps({'changed_or_added_sources_and_regressions': len(changes), 'output': str(out)}, ensure_ascii=False))
