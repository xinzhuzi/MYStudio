"""Sync only the proven unmodified pre-install i2i template cache."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
records = json.loads((ROOT / 'apps/output/automation/qi21-host-widget-preinstall.json').read_text())
backup = ROOT / 'apps/output/bak/qi21-i2i-host-widgets'
backup.mkdir(parents=True, exist_ok=True)
result = []
for row in records:
    source = Path(row['source'])
    wanted = source.read_bytes()
    assert hashlib.sha256(wanted).hexdigest() == row['after_sha256'], 'Concurrent source edit'
    assert Path(row['installed']).read_bytes() == wanted, 'Installed file differs from tested source'
    if 'cache' not in row:
        continue
    cache = Path(row['cache'])
    raw = cache.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest in {row['cache_before_sha256'], row['after_sha256']}, 'User changed cache; refuse overwrite'
    if raw != wanted:
        saved = backup / ('cache-' + digest[:16] + '.json')
        if not saved.exists():
            saved.write_bytes(raw)
        assert cache.read_bytes() == raw, 'Concurrent cache edit'
        cache.write_bytes(wanted)
    assert cache.read_bytes() == wanted
    result.append({'path': str(cache), 'sha256': row['after_sha256']})
(ROOT / 'apps/output/automation/qi21-host-widget-cache-sync.json').write_text(
    json.dumps({'ok': True, 'files': result}, ensure_ascii=False, indent=2) + '\n')
print('Verified installed sources; existing i2i cache synchronized with backup and concurrent-edit guards.')
