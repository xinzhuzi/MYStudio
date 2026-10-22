"""Sync the verified t2i cache after the second install, preserving parallel i2i edits."""
import copy
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation'
records = json.loads((OUT / 'qi21-preinstall-cache-1022.json').read_bytes())
record = records[0]
source, installed, cache = (Path(record[key]) for key in ('source', 'installed', 'cache'))
assert source.name == 'qi21-道劫-t2i.json'
wanted = source.read_bytes()
assert installed.read_bytes() == wanted, 'Source changed after package'
original = cache.read_bytes()
if original != wanted:
    assert hashlib.sha256(original).hexdigest() == '52d1ab27ecca05ee8154de162662c8a86a00d07286d97995eddfa6fd4825ad8c', 'Cache changed concurrently'
    old, new = json.loads(original), json.loads(wanted)
    updated = copy.deepcopy(old)
    old_nodes = {n['id']: n for n in updated['nodes']}
    new_nodes = {n['id']: n for n in new['nodes']}
    for node_id in (503, 504):
        assert old_nodes[node_id]['mode'] == 4 and new_nodes[node_id]['mode'] == 0
        old_nodes[node_id]['mode'] = 0
    old_group = next(g for g in updated['groups'] if g['id'] == 6)
    new_group = next(g for g in new['groups'] if g['id'] == 6)
    assert old_group.get('flags') == {} and 'mode' not in old_group
    assert 'flags' not in new_group and new_group['mode'] == 4
    old_group.pop('flags')
    old_group['mode'] = 4
    assert updated == new, 'Unexpected cache/source differences'
    backup = ROOT / 'apps/output/bak/qi21-repair-cache-1022'
    backup.mkdir(parents=True, exist_ok=True)
    destination = backup / (cache.stem + '-' + hashlib.sha256(original).hexdigest()[:12] + '.json')
    if not destination.exists():
        shutil.copy2(cache, destination)
    assert cache.read_bytes() == original and source.read_bytes() == wanted
    cache.write_bytes(wanted)
assert cache.read_bytes() == installed.read_bytes() == source.read_bytes()
report = {'ok': True, 'path': str(cache), 'before_sha256': hashlib.sha256(original).hexdigest(),
          'after_sha256': hashlib.sha256(wanted).hexdigest(), 'scope': 't2i only'}
(OUT / 'qi21-t2i-cache-sync.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
