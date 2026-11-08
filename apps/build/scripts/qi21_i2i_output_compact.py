"""Shrink only the i2i output group and its SaveImage horizontal position."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
import layout_check

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--deploy', action='store_true')
args = parser.parse_args()
paths = subprocess.check_output(['fd', '-a', '--fixed-strings', 'qi21-道劫-i2i.json', str(ROOT / 'apps/backend/comfyui/workflows')], text=True).strip().splitlines()
assert len(paths) == 1
source = Path(paths[0])
receipt = ROOT / 'apps/output/automation/qi21-i2i-output-compact.json'
backup = ROOT / 'apps/output/bak/qi21-i2i-output-compact'
backup.mkdir(parents=True, exist_ok=True)
if args.deploy:
    record = json.loads(receipt.read_text())
    raw = source.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == record['after_sha256'], 'Concurrent source change'
    pending = []
    for path in record['destinations']:
        p = Path(path); old = p.read_bytes()
        assert hashlib.sha256(old).hexdigest() in {record['before_sha256'], record['after_sha256']}, 'User or concurrent edit: ' + str(p)
        pending.append((p, old))
    for index, (path, old) in enumerate(pending):
        if old == raw:
            continue
        (backup / ('destination-' + str(index) + '-' + record['before_sha256'][:16] + '.json')).write_bytes(old)
        assert path.read_bytes() == old, 'Concurrent destination change'
        path.write_bytes(raw)
        assert path.read_bytes() == raw
    print('Installed template and existing cache synchronized; no engine restart.')
    raise SystemExit(0)
raw = source.read_bytes()
graph = json.loads(raw)
original = copy.deepcopy(graph)
node = next(n for n in graph['nodes'] if n['id'] == 8)
group = next(g for g in graph['groups'] if g['title'] == '道劫·④输出')
assert node['type'] == 'SaveImage'
assert node['pos'] in ([10415.5, 2446.1], [8790, 2446.1])
assert group['bounding'][0] == 7745.3 and group['bounding'][1] == 1658.7
node['pos'][0] = 8790
group['bounding'][2] = round(node['pos'][0] + node['size'][0] + 30 - group['bounding'][0], 1)
assert group['bounding'][2] == 1587.3
restored = copy.deepcopy(graph)
next(n for n in restored['nodes'] if n['id'] == 8)['pos'] = next(n for n in original['nodes'] if n['id'] == 8)['pos']
next(g for g in restored['groups'] if g['title'] == '道劫·④输出')['bounding'] = next(g for g in original['groups'] if g['title'] == '道劫·④输出')['bounding']
assert restored == original, 'Modification exceeded geometry scope'
before, after = layout_check.check_workflow(original), layout_check.check_workflow(graph)
for old_scope, new_scope in zip(before, after):
    assert old_scope['name'] == new_scope['name']
    assert all(new_scope['counts'][key] <= old_scope['counts'][key] for key in layout_check.CHECK_KEYS), new_scope
wanted = raw if graph == original else (json.dumps(graph, ensure_ascii=False, indent=2) + '\n').encode()
record = {'source': str(source), 'before_sha256': hashlib.sha256(raw).hexdigest(),
          'after_sha256': hashlib.sha256(wanted).hexdigest(),
          'before_width': next(g for g in original['groups'] if g['title'] == '道劫·④输出')['bounding'][2],
          'after_width': group['bounding'][2], 'before': before, 'after': after, 'destinations': []}
app = next(p for p in Path('/Applications').iterdir() if p.name == '漫影工作室.app')
home = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
relative = source.relative_to(ROOT / 'apps/backend/comfyui/workflows')
allowed_hashes = {record['before_sha256'], record['after_sha256']}
if receipt.exists() and wanted == raw:
    previous = json.loads(receipt.read_text())
    assert previous['source'] == str(source) and previous['after_sha256'] == record['after_sha256']
    allowed_hashes.add(previous['before_sha256'])
for path in [app / 'Contents/Resources/backend/comfyui/workflows' / relative,
             home / 'comfyui/ComfyUI/user/default/workflows' / relative]:
    assert hashlib.sha256(path.read_bytes()).hexdigest() in allowed_hashes, 'User or concurrent template change: ' + str(path)
    record['destinations'].append(str(path))
if args.apply and wanted != raw:
    (backup / ('source-' + record['before_sha256'][:16] + '.json')).write_bytes(raw)
    assert source.read_bytes() == raw, 'Concurrent source change'
    source.write_bytes(wanted)
    assert source.read_bytes() == wanted
    receipt.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'applied': args.apply, 'changed': wanted != raw, 'before_width': record['before_width'], 'after_width': record['after_width'], 'main_counts': after[0]['counts']}))
