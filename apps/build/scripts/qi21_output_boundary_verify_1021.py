"""Fresh offline evidence for the QI21 subgraph output repair."""
import hashlib
import json
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import qi21_output_boundary_1021 as fix
import qwen21_bridge_template_build as builder


def reject_network(*args, **kwargs):
    raise RuntimeError('offline verification forbids network')


socket.socket.connect = reject_network
socket.create_connection = reject_network
root = fix.ROOT
research = fix.RESEARCH
manifest = json.loads((research / 'main-source-manifest.json').read_bytes())
source, blueprint = [json.loads(p.read_bytes()) for p in fix.paths()]
fix.validate([source, blueprint])
assert fix.transform([source, blueprint]) == [source, blueprint]
before_source = json.loads((root / manifest[0]['backup']).read_bytes())
before_blueprint = json.loads((root / manifest[1]['backup']).read_bytes())
assert fix.transform([before_source, before_blueprint]) == [source, blueprint]
# All unrelated root nodes and embedded definitions retain exact semantic values.
before_nodes = {n['id']: n for n in before_source['nodes']}
after_nodes = {n['id']: n for n in source['nodes']}
assert set(before_nodes) - set(after_nodes) == set()
assert set(after_nodes) - set(before_nodes) == set()
assert all(n == after_nodes[k] for k, n in before_nodes.items() if k not in (6, 19, 402))
assert all(sg == fix.repair.graph(source, sg['id']) for sg in before_source['definitions']['subgraphs'] if sg['id'] != fix.repair.PROMPT_ID)
info = json.loads((root / 'apps/backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json').read_bytes())
exports = []
for name, target in builder.TARGETS.items():
    doc = json.loads(target['canvas'].read_bytes())
    graph, meta = builder.build_graph(info, doc, force_upscale=target['force_upscale'])
    assert graph == json.loads(target['out'].read_bytes())['graph']
    builder.check_object_info(graph, info)
    assert meta['档'] == '0 · Turbo 8步'
    exports.append({'target': name, 'nodes': len(graph), 'metadata': meta, 'saved_api_equal': True})
old_api = json.loads((root / manifest[2]['backup']).read_bytes())['graph']
new_api = json.loads(builder.OUT_I2I.read_bytes())['graph']
old_api['6:4022'] = old_api.pop('19')
for item in old_api.values():
    for key, val in item['inputs'].items():
        if val == ['19', 0]:
            item['inputs'][key] = ['6:4022', 0]
assert old_api == new_api, 'API has changes beyond router identity'
checker = fix.repair.helpers.checker
metrics = []
for label, old, new in [('root', before_source, source), ('assembly', fix.repair.graph(before_source, fix.repair.PROMPT_ID), fix.repair.graph(source, fix.repair.PROMPT_ID))]:
    counts = []
    for doc in (old, new):
        result = checker.check_scope(label, doc['nodes'], list(checker._iter_links(doc['links'])), doc, groups=doc['groups'])
        counts.append(result['counts'])
    for key in counts[0]:
        assert counts[1][key] <= counts[0][key], (label, key, counts)
    metrics.append({'scope': label, 'before': counts[0], 'after': counts[1], 'nonincrease': True})
for row in manifest:
    row['after_sha256'] = hashlib.sha256((root / row['path']).read_bytes()).hexdigest()
(research / 'main-source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
result = {'ok': True, 'network': False, 'generation': False, 'boundary_valid': True, 'original_replay_equal': True, 'unrelated_nodes_unchanged': True, 'api_only_router_identity_changed': True, 'exports': exports, 'metrics': metrics}
(research / 'main-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
