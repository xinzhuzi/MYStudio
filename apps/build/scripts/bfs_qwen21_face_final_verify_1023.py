"""Read-only fresh verification of the serial BFS diagnosis and face composite."""
import ast
import hashlib
import json
from pathlib import Path
import time
import numpy as np
from PIL import Image, ImageChops
import bfs_qwen21_face_ab_1023 as ab

r = ab.OUT
jobs = [('A', 'A.submitted-api.json', 'A.submitted-gui.json'),
        ('B', 'B.submitted-api.json', 'B.submitted-gui.json'),
        ('B-raw', 'B-raw.api.json', 'B-raw.gui.json')]
jobs += [(tag, tag + '.api.json', tag + '.gui.json') for tag in [
    'vae-roundtrip', 'vae-roundtrip-fp32-mps', 'vae-roundtrip-fp32-cpu',
    'A-vae-cpu-seed42', 'B-vae-cpu-seed42', 'A-vae-cpu-seed43', 'B-vae-cpu-seed43']]
records = []
for tag, api_name, gui_name in jobs:
    pid = json.loads((r / (tag + '.submission.json')).read_text())['prompt_id']
    history = ab.get('/history/' + pid)[pid]
    assert history['status']['status_str'] == 'success' and history['status']['completed'], tag
    api = json.loads((r / api_name).read_text())
    assert history['prompt'][2] == api, tag
    ab.WIDGETS['485'] = ['vae_name', 'device', 'weight_dtype'] if api['485']['class_type'] == 'VAELoaderKJ' else ['vae_name']
    ab.validate_pair(api, json.loads((r / gui_name).read_text()))
    q = json.loads((r / (tag + '.pre-submit-queue.json')).read_text())
    assert not q['queue_running'] and not q['queue_pending'], tag
    for entry in json.loads((r / (tag + '.outputs.json')).read_text()):
        p = Path(entry['path'])
        assert ab.sha(p) == entry['sha256'], tag
    messages = history['status']['messages']
    start = next(v[1]['timestamp'] for v in messages if v[0] == 'execution_start')
    end = next(v[1]['timestamp'] for v in messages if v[0] == 'execution_success')
    records.append({'tag': tag, 'prompt_id': pid, 'start': start, 'end': end})
ordered = sorted(records, key=lambda v: v['start'])
assert all(first['end'] <= second['start'] for first, second in zip(ordered, ordered[1:])), 'Own jobs overlapped'
for seed in [42, 43]:
    left, right = [json.loads((r / f'{case}-vae-cpu-seed{seed}.api.json').read_text()) for case in ['A', 'B']]
    for graph in [left, right]:
        graph['470']['inputs']['image'] = '<same body bytes>'
        graph['475']['inputs']['image'] = '<changed image2>'
        graph['461']['inputs']['filename_prefix'] = '<prefix>'
    assert left == right
for case in ['A', 'B']:
    u = json.loads((r / (case + '.uploads.json')).read_text())
    for key, expected in [('470', 'body-crop-1024.png'), ('475', 'body-crop-1024.png' if case == 'A' else 'reference-neutral-1024.png')]:
        uploaded = Path(ab.MANIFEST['inputDir']) / u[key]['subfolder'] / u[key]['name']
        assert ab.sha(uploaded) == ab.sha(r / expected)
raw = Image.open(json.loads((r / 'B-raw.outputs.json').read_text())[0]['path'])
processed = Image.open(json.loads((r / 'B.outputs.json').read_text())[0]['path'])
assert max(v[1] for v in ImageChops.difference(raw, processed).getextrema()) == 0
proof = json.loads((r / 'composite-v2-evidence.json').read_text())
original = Image.open(proof['original']).convert('RGB')
result = Image.open(proof['output'])
mask = np.asarray(Image.open(r / 'composite-v2-mask-1254.png')) > 0
assert result.mode == 'RGB' and result.size == (1254, 1254)
diff = np.abs(np.asarray(original, dtype=np.int16) - np.asarray(result, dtype=np.int16))
assert int(diff[~mask].max()) == 0 and int(diff[mask].max()) > 0
assert ab.sha(Path(proof['original'])) == proof['original_sha256']
assert ab.sha(Path(proof['output'])) == proof['sha256']
prepared = json.loads((r / 'prepared-evidence.json').read_text())
assert ab.sha(Path(prepared['production_workflow'])) == prepared['production_sha256']
input_plan = prepared['input_plan']
assert all(ab.sha(Path(input_plan[k]['path'])) == input_plan[k]['sha256'] for k in ['body', 'reference'])
for p in (ab.ROOT / 'apps/build/scripts').glob('bfs_qwen21_*1023.py'):
    ast.parse(p.read_text())
assert all(p.stat().st_size < 1000000 for p in [r / 'cpu-two-seeds-faces_thumb.png', r / 'composite-v2-head_thumb.png', r / 'vae-device-comparison_thumb.png'])
queue = ab.get('/queue')
verification = {'ok': True, 'verified_at': time.time(), 'own_jobs': ordered,
                'all_live_histories_success': True, 'gui_matches_actual_api': True,
                'all_submissions_observed_empty_queue': True, 'own_jobs_serial': True,
                'input_and_output_hashes_match': True, 'production_workflow_unchanged': True,
                'original_images_unchanged': True, 'raw_vs_processed_rgba_max_difference': 0,
                'composite_outside_mask_max_rgb_difference': 0,
                'queue_now': {k: [v[1] for v in items] for k, items in queue.items()}}
ab.write_new(r / 'final-verification.json', verification)
print(json.dumps(verification, ensure_ascii=False, indent=2), flush=True)
