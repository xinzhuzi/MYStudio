"""BFS A/B using the VAE CPU/FP32 path verified by the reconstruction probe."""
import argparse
import json
from pathlib import Path
import time
import urllib.request
import uuid
import bfs_qwen21_face_ab_1023 as ab

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--case', required=True, choices=['A', 'B'])
parser.add_argument('--seed', required=True, type=int, choices=[42, 43])
args = parser.parse_args()
r = ab.OUT
tag = f'{args.case}-vae-cpu-seed{args.seed}'
assert not (r / (tag + '.attempt.json')).exists(), 'No automatic retry.'
if args.case == 'B':
    prior = json.loads((r / f'A-vae-cpu-seed{args.seed}.history.json').read_text())
    assert prior['status']['status_str'] == 'success' and prior['status']['completed']
api = json.loads((r / (args.case + '.submitted-api.json')).read_text())
gui = json.loads((r / (args.case + '.submitted-gui.json')).read_text())
api['485']['class_type'] = 'VAELoaderKJ'
api['485']['inputs'].update(device='cpu', weight_dtype='fp32')
api['490']['inputs']['seed'] = args.seed
api['461']['inputs']['filename_prefix'] = 'BFS_face_AB_1023_' + tag
node = next(n for n in gui['nodes'] if n['id'] == 485)
node['type'] = 'VAELoaderKJ'
node['properties']['Node name for S&R'] = 'VAELoaderKJ'
node['widgets_values'] = [api['485']['inputs'][key] for key in ['vae_name', 'device', 'weight_dtype']]
node['widgets_values_named'] = dict(api['485']['inputs'])
ab.WIDGETS['485'] = ['vae_name', 'device', 'weight_dtype']
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
print('SUBMITTED_CPU_VAE', tag, pid, flush=True)
start = time.monotonic()
last_notice = -30
while True:
    record = ab.get('/history/' + pid).get(pid)
    if record:
        ab.write_new(r / (tag + '.history.json'), record)
        assert record['status']['status_str'] == 'success' and record['status']['completed'], record['status']
        outputs = []
        for item in record['outputs']['461']['images']:
            path = Path(ab.MANIFEST['outputDir']) / item['subfolder'] / item['filename']
            assert path.is_file(), path
            outputs.append({'path': str(path), 'sha256': ab.sha(path)})
        ab.write_new(r / (tag + '.outputs.json'), outputs)
        print('SUCCESS_CPU_VAE', tag, json.dumps(outputs, ensure_ascii=False), flush=True)
        break
    elapsed = time.monotonic() - start
    if elapsed > 3600:
        raise TimeoutError('Inspect saved prompt_id; do not retry.')
    if elapsed - last_notice >= 30:
        print('RUNNING', tag, round(elapsed), flush=True)
        last_notice = elapsed
    time.sleep(15)
