"""Guarded, idempotent repair of i2i host widget serialization only."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ENGINE = ROOT / 'apps/backend/comfyui'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
paths = []
for folder, filename in [('workflows', 'qi21-道劫-i2i.json'),
                         ('my_nodes/subgraphs', 'qi21-提示词类型优化子图-i2i.json')]:
    matches = subprocess.check_output(['fd', '-a', '--fixed-strings', filename, str(ENGINE / folder)], text=True).strip().splitlines()
    assert len(matches) == 1, matches
    paths.append(Path(matches[0]))
backup = ROOT / 'apps/output/bak/qi21-i2i-host-widgets'
backup.mkdir(parents=True, exist_ok=True)
records, pending = [], []
for path in paths:
    raw = path.read_bytes()
    graph = json.loads(raw)
    original = copy.deepcopy(graph)
    sg = next(s for s in graph['definitions']['subgraphs']
              if any(n['type'] == 'MyQi21DaojieBase' for n in s['nodes']))
    host = next(n for n in graph['nodes'] if n['type'] == sg['id'])
    named = host['widgets_values_named']
    names = ['型选择', 'PE启用?', 'RGBA透明', '组装用途']
    values = [named[name] for name in names]
    assert values == ['人物', False, '自动', '自由出图'], values
    old_values = host['widgets_values']
    assert old_values == values or old_values == [named['指令']] + values
    assert sg['widgets'] == old_values
    host['widgets_values'] = values
    host['widgets_values_named'] = dict(zip(names, values))
    sg['widgets'] = list(values)
    instruction = next(i for i in host['inputs'] if i['name'] == '指令')
    instruction.pop('widget', None)
    # Prove no other graph, geometry, connection, input text or parameter changed.
    restored = copy.deepcopy(graph)
    old_sg = next(s for s in original['definitions']['subgraphs'] if s['id'] == sg['id'])
    restored_sg = next(s for s in restored['definitions']['subgraphs'] if s['id'] == sg['id'])
    restored_sg['widgets'] = old_sg['widgets']
    restored['nodes'] = original['nodes']
    assert restored == original
    patched_host = copy.deepcopy(host)
    old_host = next(n for n in original['nodes'] if n['id'] == host['id'])
    for key in ['inputs', 'widgets_values', 'widgets_values_named']:
        patched_host[key] = old_host[key]
    assert patched_host == old_host
    for before, after in zip(old_host['inputs'], host['inputs']):
        assert {k: v for k, v in before.items() if k != 'widget' or before['name'] != '指令'} == after
    wanted = (json.dumps(graph, ensure_ascii=False, indent=2) + '\n').encode()
    if graph == original:
        wanted = raw
    digest = hashlib.sha256(raw).hexdigest()
    records.append({'source': str(path), 'before_sha256': digest,
                    'after_sha256': hashlib.sha256(wanted).hexdigest(), 'changed': wanted != raw})
    pending.append((path, raw, wanted, digest))
if args.apply:
    assert all(path.read_bytes() == raw for path, raw, _, _ in pending), 'Concurrent source edit'
    for path, raw, wanted, digest in pending:
        if raw == wanted:
            continue
        saved = backup / (path.stem + '-' + digest[:16] + '.json')
        if not saved.exists():
            saved.write_bytes(raw)
        assert path.read_bytes() == raw, 'Concurrent source edit: ' + str(path)
        path.write_bytes(wanted)
        assert path.read_bytes() == wanted
    receipt = ROOT / 'apps/output/automation/qi21-i2i-host-widgets-fix.json'
    if any(row['changed'] for row in records):
        receipt.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'applied': args.apply, 'files': records}, ensure_ascii=False))
