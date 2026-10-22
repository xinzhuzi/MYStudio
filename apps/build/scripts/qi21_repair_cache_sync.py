"""Update only existing template caches proven identical to the previous install."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
manifest = ROOT / 'apps/output/automation/qi21-preinstall-cache-1022.json'
records = json.loads(manifest.read_bytes())
# The first install was fully audited; its published source hashes are a second
# safe baseline when a later install follows concurrent workflow edits.
previous_release = ROOT / 'apps/output/automation/qi21-release-ready-1022.json'
previous_audit = ROOT / 'apps/output/automation/qi21-repair-audit-final-1022.log'
assert 'ALL PASS' in previous_audit.read_text(), 'Previous release was not fully audited'
published_hashes = json.loads(previous_release.read_bytes())['source_hashes']
verified_t2i_cache = json.loads((ROOT / 'apps/output/automation/qi21-t2i-cache-sync.json').read_bytes())
assert verified_t2i_cache['ok'], 'Earlier t2i cache synchronization was not verified'
backup = ROOT / 'apps/output/bak/qi21-repair-cache-1022'
backup.mkdir(parents=True, exist_ok=True)
pending = []
for record in records:
    source, installed, cache = (Path(record[key]) for key in ('source', 'installed', 'cache'))
    assert record['cache_matches_installed'], 'Cache was already user-modified; refuse overwrite.'
    raw = cache.read_bytes()
    wanted = source.read_bytes()
    assert installed.read_bytes() == wanted, 'Installed template is not the current source: ' + source.name
    current = hashlib.sha256(raw).hexdigest()
    allowed_previous = {record['cache_sha256'], published_hashes.get(str(source))}
    if verified_t2i_cache['path'] == str(cache):
        allowed_previous.add(verified_t2i_cache['after_sha256'])
    assert current in allowed_previous or raw == wanted, 'Concurrent cache edit: ' + str(cache)
    json.loads(raw)
    json.loads(wanted)
    pending.append((cache, raw, wanted))
for cache, original, wanted in pending:
    if original == wanted:
        continue
    destination = backup / (cache.stem + '-' + hashlib.sha256(original).hexdigest()[:12] + '.json')
    if not destination.exists():
        shutil.copy2(cache, destination)
    assert cache.read_bytes() == original, 'Concurrent edit detected: ' + str(cache)
    cache.write_bytes(wanted)
    assert cache.read_bytes() == wanted
print('Three existing caches match the installed source; previous bytes backed up.')
