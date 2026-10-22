"""Idle-gated VAE-only reconstruction of the A/B body crop; no diffusion sampler."""
import copy
import argparse
import json
import time
import urllib.request
import uuid
import bfs_qwen21_face_ab_1023 as ab

r = ab.OUT
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mode', choices=['default', 'fp32-mps', 'fp32-cpu'], default='default')
args = parser.parse_args()
tag = 'vae-roundtrip' + ('' if args.mode == 'default' else '-' + args.mode)
assert not (r / (tag + '.attempt.json')).exists(), 'No automatic retry.'
base = json.loads((r / 'B.submitted-api.json').read_text())
original_gui = json.loads((r / 'B.submitted-gui.json').read_text())
nodes = {str(n['id']): n for n in original_gui['nodes']}
api = {key: copy.deepcopy(base[key]) for key in ['470', '485', '487', '461']}
api['911'] = {'class_type': 'VAEEncode', 'inputs': {'pixels': ['470', 0], 'vae': ['485', 0]}}
api['487']['inputs']['samples'] = ['911', 0]
api['461']['inputs']['images'] = ['487', 0]
api['461']['inputs']['filename_prefix'] = 'BFS_face_AB_1023_body_' + tag
if args.mode != 'default':
    api['485']['class_type'] = 'VAELoaderKJ'
    api['485']['inputs'].update(device='main_device' if args.mode == 'fp32-mps' else 'cpu', weight_dtype='fp32')
    nodes['485']['type'] = 'VAELoaderKJ'
    nodes['485']['widgets_values'] = [api['485']['inputs'][k] for k in ['vae_name', 'device', 'weight_dtype']]
    nodes['485']['widgets_values_named'] = dict(api['485']['inputs'])
    nodes['485']['properties']['Node name for S&R'] = 'VAELoaderKJ'
    ab.WIDGETS['485'] = ['vae_name', 'device', 'weight_dtype']
gui = {key: copy.deepcopy(original_gui[key]) for key in ['version', 'config']}
gui.update({'id': str(uuid.uuid4()), 'revision': 0, 'last_node_id': 911, 'last_link_id': 5,
            'nodes': [copy.deepcopy(nodes[key]) for key in ['470', '485', '487', '461']],
            'links': [[1, 470, 0, 911, 0, 'IMAGE'], [2, 485, 0, 911, 1, 'VAE'],
                      [3, 911, 0, 487, 0, 'LATENT'], [4, 485, 0, 487, 1, 'VAE'], [5, 487, 0, 461, 0, 'IMAGE']],
            'groups': []})
gui['nodes'].append({'id': 911, 'type': 'VAEEncode', 'pos': [440, 0], 'size': [300, 90], 'mode': 0,
                     'order': 2, 'flags': {}, 'properties': {'Node name for S&R': 'VAEEncode'},
                     'inputs': [{'name': 'pixels', 'type': 'IMAGE', 'link': 1}, {'name': 'vae', 'type': 'VAE', 'link': 2}],
                     'outputs': [{'name': 'LATENT', 'type': 'LATENT', 'links': [3]}], 'widgets_values': []})
positions = {470: [0, 0], 485: [0, 430], 487: [880, 0], 461: [1320, 0], 911: [440, 0]}
for n in gui['nodes']:
    n['pos'] = positions[n['id']]
gui = ab.gui_for(api, gui)
ab.write_new(r / (tag + '.api.json'), api)
ab.write_new(r / (tag + '.gui.json'), gui)
ab.write_new(r / (tag + '.attempt.json'), {'started_at': time.time(), 'engine': ab.BASE})
ab.write_new(r / (tag + '.pre-submit-queue.json'), ab.idle_gate())
payload = {'prompt': api, 'client_id': str(uuid.uuid4()), 'extra_data': {'extra_pnginfo': {'workflow': gui}}}
request = urllib.request.Request(ab.BASE + '/prompt', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=30) as response:
    submitted = json.load(response)
ab.write_new(r / (tag + '.submission.json'), submitted)
assert not submitted.get('node_errors'), submitted
pid = submitted['prompt_id']
print('SUBMITTED_VAE_ROUNDTRIP', pid, flush=True)
start = time.monotonic()
while True:
    record = ab.get('/history/' + pid).get(pid)
    if record:
        ab.write_new(r / (tag + '.history.json'), record)
        assert record['status']['status_str'] == 'success' and record['status']['completed'], record['status']
        outputs = []
        for item in record['outputs']['461']['images']:
            path = ab.Path(ab.MANIFEST['outputDir']) / item['subfolder'] / item['filename']
            assert path.is_file(), path
            outputs.append({'path': str(path), 'sha256': ab.sha(path)})
        ab.write_new(r / (tag + '.outputs.json'), outputs)
        print('SUCCESS_VAE_ROUNDTRIP', json.dumps(outputs, ensure_ascii=False), flush=True)
        break
    if time.monotonic() - start > 600:
        raise TimeoutError('Inspect saved prompt_id; do not retry.')
    time.sleep(15)
