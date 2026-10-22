"""Save B's decoded tensor directly to local PNG, with a strict shared-queue gate."""
import json
from pathlib import Path
import time
import urllib.request
import uuid
import bfs_qwen21_face_ab_1023 as ab

r = ab.OUT
assert not (r / 'B-raw.attempt.json').exists(), 'No duplicate submission.'
history = json.loads((r / 'B.history.json').read_text())
assert history['status']['status_str'] == 'success' and history['status']['completed']
api = json.loads((r / 'B.submitted-api.json').read_text())
gui = json.loads((r / 'B.submitted-gui.json').read_text())
assert api['461']['inputs']['images'] == ['509', 0]
api['461']['inputs']['images'] = ['487', 0]
api['461']['inputs']['filename_prefix'] = 'BFS_face_AB_1023_B_seed42_raw_decode'
edge = next(e for e in gui['links'] if e[3:5] == [461, 0])
assert edge[1:3] == [509, 0]
edge[1] = 487
gui = ab.gui_for(api, gui)
ab.write_new(r / 'B-raw.api.json', api)
ab.write_new(r / 'B-raw.gui.json', gui)
ab.write_new(r / 'B-raw.attempt.json', {'started_at': time.time(), 'engine': ab.BASE})
ab.write_new(r / 'B-raw.pre-submit-queue.json', ab.idle_gate())
payload = {'prompt': api, 'client_id': str(uuid.uuid4()), 'extra_data': {'extra_pnginfo': {'workflow': gui}}}
request = urllib.request.Request(ab.BASE + '/prompt', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=30) as response:
    submitted = json.load(response)
ab.write_new(r / 'B-raw.submission.json', submitted)
assert not submitted.get('node_errors'), submitted
pid = submitted['prompt_id']
print('SUBMITTED_RAW', pid, flush=True)
start = time.monotonic()
while True:
    record = ab.get('/history/' + pid).get(pid)
    if record:
        ab.write_new(r / 'B-raw.history.json', record)
        assert record['status']['status_str'] == 'success' and record['status']['completed'], record['status']
        outputs = []
        for item in record['outputs']['461']['images']:
            path = Path(ab.MANIFEST['outputDir']) / item['subfolder'] / item['filename']
            assert path.is_file(), path
            outputs.append({'path': str(path), 'sha256': ab.sha(path)})
        ab.write_new(r / 'B-raw.outputs.json', outputs)
        print('SUCCESS_RAW', json.dumps(outputs, ensure_ascii=False), flush=True)
        print('CACHE', json.dumps(record['status']['messages']), flush=True)
        break
    if time.monotonic() - start > 1800:
        raise TimeoutError('Inspect saved prompt_id; do not retry.')
    time.sleep(15)
