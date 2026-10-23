"""One controlled BFS run after the shared queue becomes idle; no production edits."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / '.trellis/tasks/10-22-bfs-qwen21-color-diagnosis/research'
HOME_DIR = Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui')
manifest = json.loads((HOME_DIR / 'manifest.json').read_text())
base = f"http://127.0.0.1:{manifest['engine']['port']}"

def get(endpoint):
    with urllib.request.urlopen(base + endpoint, timeout=20) as response:
        return json.load(response)

def write_new(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

started = time.monotonic()
last_notice = -60.0
while True:
    queue = get('/queue')
    if not queue['queue_running'] and not queue['queue_pending']:
        break
    elapsed = time.monotonic() - started
    if elapsed > 1800:
        raise TimeoutError('Shared queue did not become idle; no prompt submitted.')
    if elapsed - last_notice >= 60:
        print('WAIT_IDLE', round(elapsed), 'running', len(queue['queue_running']), 'pending', len(queue['queue_pending']), flush=True)
        last_notice = elapsed
    time.sleep(15)
source = RESEARCH / 'head-reference-neutral-rgb.png'
boundary = 'bfsprobe' + uuid.uuid4().hex
parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n'.encode(), f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="bfs-color-1023-head-neutral-rgb.png"\r\nContent-Type: image/png\r\n\r\n'.encode(), source.read_bytes(), f'\r\n--{boundary}--\r\n'.encode()]
request = urllib.request.Request(base + '/upload/image', data=b''.join(parts), headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
with urllib.request.urlopen(request, timeout=30) as response:
    upload = json.load(response)
write_new(RESEARCH / 'neutral-ref.upload.json', upload)
name = '/'.join(v for v in [upload['subfolder'], upload['name']] if v)
prompt = json.loads((RESEARCH / 'neutral-ref.api.json').read_text())
prompt['475']['inputs']['image'] = name
write_new(RESEARCH / 'neutral-ref.submitted-api.json', prompt)
original = Path(subprocess.check_output(['fd', '-a', '-t', 'f', 'BFS-.*Qwen2.1', str(ROOT / 'apps/backend/comfyui/workflows'), '--no-ignore'], text=True).strip())
gui = json.loads(original.read_text())
for node in gui['nodes']:
    if node['id'] == 470:
        node['widgets_values'][0] = 'yl-bfs-body.png'
    elif node['id'] == 475:
        node['widgets_values'][0] = name
    elif node['id'] == 461:
        node['widgets_values'][0] = prompt['461']['inputs']['filename_prefix']
write_new(RESEARCH / 'neutral-ref.gui.json', gui)
user_workflow = HOME_DIR / 'ComfyUI/user/default/workflows/2026-10-23_BFS_neutral-reference_probe.json'
write_new(user_workflow, gui)
payload = {'prompt': prompt, 'client_id': str(uuid.uuid4()), 'extra_data': {'extra_pnginfo': {'workflow': gui}}}
request = urllib.request.Request(base + '/prompt', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=30) as response:
    submitted = json.load(response)
write_new(RESEARCH / 'neutral-ref.submission.json', submitted)
assert not submitted.get('node_errors'), submitted
pid = submitted['prompt_id']
print('SUBMITTED', pid, flush=True)
started = time.monotonic()
last_notice = -60.0
while True:
    record = get('/history/' + pid).get(pid)
    if record:
        write_new(RESEARCH / 'neutral-ref.history.json', record)
        assert record['status']['status_str'] == 'success' and record['status']['completed'], record['status']
        for item in record['outputs']['461']['images']:
            output = Path(manifest['outputDir']) / item['subfolder'] / item['filename']
            assert output.is_file(), output
            print('OUTPUT', output, 'sha256', hashlib.sha256(output.read_bytes()).hexdigest(), flush=True)
        print('SUCCESS seconds', round(time.monotonic()-started), flush=True)
        break
    elapsed = time.monotonic() - started
    if elapsed > 1800:
        raise TimeoutError('Prompt still unresolved; inspect saved prompt_id before any new action.')
    if elapsed - last_notice >= 60:
        print('RUNNING', pid, round(elapsed), flush=True)
        last_notice = elapsed
    time.sleep(15)
