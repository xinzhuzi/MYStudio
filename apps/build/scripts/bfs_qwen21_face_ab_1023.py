"""Prepare audited BFS head-swap copies; submit exactly one idle-gated case."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / '.trellis/tasks/10-22-bfs-qwen21-color-diagnosis/research'
OUT = RESEARCH / 'face-ab-1023'
HOME_DIR = (Path.home() / 'Library/Application Support' / '漫影工作室' / 'comfyui').resolve()
MANIFEST = json.loads((HOME_DIR / 'manifest.json').read_text())
BASE = f"http://127.0.0.1:{MANIFEST['engine']['port']}"
PROMPT = ('head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. '
          'remove the head from <image1> completely and replace it with the head from <image2>, '
          'strictly preserving the hair, eye color, nose structure from <image2>. '
          'copy the direction of the eye, head rotation, micro expressions from <image1>, high quality, sharp details, 4k')
WIDGETS = {
    '13': ['aspect_ratio', 'megapixels', 'multiple'],
    '470': ['image'], '475': ['image'],
    '477': ['width', 'height', 'upscale_method', 'keep_proportion', 'pad_color', 'crop_position', 'divisible_by', 'device'],
    '478': ['width', 'height', 'upscale_method', 'keep_proportion', 'pad_color', 'crop_position', 'divisible_by', 'device'],
    '484': ['clip_name', 'type', 'device'], '485': ['vae_name'],
    '486': ['width', 'height', 'batch_size'],
    '490': ['seed', None, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    '491': ['unet_name', 'weight_dtype'], '493': ['lora_name', 'strength_model'],
    '495': ['device', 'dtype'], '496': ['prompt', 'negative_prompt', 'resolution'],
    '510': ['value'], '508': ['value', 'width', 'height'], '507': ['mode'],
    '461': ['filename_prefix', 'format', 'format.bit_depth', 'format.input_color_space'],
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def get(endpoint):
    with urllib.request.urlopen(BASE + endpoint, timeout=20) as response:
        return json.load(response)


def validate_pair(api, gui):
    nodes = {str(n['id']): n for n in gui['nodes']}
    links = {v[0]: v for v in gui['links']}
    for key, execution in api.items():
        node = nodes[key]
        assert node['type'] == execution['class_type'] and node['mode'] == 0, key
        rebuilt = {}
        for name, value in zip(WIDGETS.get(key, []), node.get('widgets_values') or []):
            if name is not None:
                rebuilt[name] = value
                if name in node.get('widgets_values_named', {}):
                    assert node['widgets_values_named'][name] == value, (key, name)
        for slot_index, slot in enumerate(node.get('inputs', [])):
            if slot.get('link') is not None:
                edge = links[slot['link']]
                assert edge[3:5] == [int(key), slot_index], (key, edge)
                source = nodes[str(edge[1])]['outputs'][edge[2]]
                assert edge[0] in source['links'], edge
                rebuilt[slot['name']] = [str(edge[1]), edge[2]]
        assert rebuilt == execution['inputs'], (key, rebuilt, execution['inputs'])


def gui_for(api, original):
    gui = copy.deepcopy(original)
    nodes = {n['id']: n for n in gui['nodes']}
    for node in gui['nodes']:
        for slot in node.get('outputs', []):
            slot['links'] = []
    for edge in gui['links']:
        nodes[edge[1]]['outputs'][edge[2]]['links'].append(edge[0])
        nodes[edge[3]]['inputs'][edge[4]]['link'] = edge[0]
    for node in gui['nodes']:
        key = str(node['id'])
        if key in api:
            for index, name in enumerate(WIDGETS.get(key, [])):
                if name is not None and name in api[key]['inputs']:
                    value = api[key]['inputs'][name]
                    if not isinstance(value, list):
                        node['widgets_values'][index] = value
                        if 'widgets_values_named' in node:
                            node['widgets_values_named'][name] = value
    validate_pair(api, gui)
    return gui


def prepare():
    assert not OUT.exists(), 'Prepared directory already exists; inspect it rather than overwrite.'
    plan = json.loads((RESEARCH / 'face-test-input-plan.json').read_text())
    for key in ['body', 'reference']:
        assert sha(Path(plan[key]['path'])) == plan[key]['sha256'], key
    matches = subprocess.check_output(['fd', '-a', '-t', 'f', 'BFS-.*Qwen2.1',
                                       str(ROOT / 'apps/backend/comfyui/workflows'), '--no-ignore'], text=True).splitlines()
    assert len(matches) == 1, matches
    original_path = Path(matches[0])
    gui = json.loads(original_path.read_text())
    baseline = json.loads((RESEARCH / 'v2.actual-api.json').read_text())
    gui = gui_for(baseline, gui)
    live = {name: get('/object_info/' + name)[name] for name in sorted({v['class_type'] for v in baseline.values()})}
    for key, field in [('484', 'clip_name'), ('485', 'vae_name'), ('491', 'unet_name'), ('493', 'lora_name')]:
        node = baseline[key]
        options = live[node['class_type']]['input']['required'][field][0]
        if isinstance(options, str):
            options = live[node['class_type']]['input']['required'][field][1]['options']
        assert node['inputs'][field] in options, (key, field)
    OUT.mkdir()
    body = Image.open(plan['body']['path']).convert('RGB').crop(plan['proposed_body_crop_xyxy']).resize((1024, 1024), Image.Resampling.LANCZOS)
    reference = Image.open(plan['reference']['path']).convert('RGBA')
    neutral = Image.new('RGBA', reference.size, (249, 246, 241, 255))
    reference = Image.alpha_composite(neutral, reference).convert('RGB').resize((1024, 1024), Image.Resampling.LANCZOS)
    body.save(OUT / 'body-crop-1024.png')
    reference.save(OUT / 'reference-neutral-1024.png')
    write_new(OUT / 'live-node-info.json', live)
    cases = {}
    for case, reference_name in [('A', 'body-crop-1024.png'), ('B', 'reference-neutral-1024.png')]:
        api = copy.deepcopy(baseline)
        for key in ['470', '475']:
            api[key].pop('is_changed', None)
        api['13']['inputs']['megapixels'] = 1.0
        api['470']['inputs']['image'] = 'body-crop-1024.png'
        api['475']['inputs']['image'] = reference_name
        api['496']['inputs']['prompt'] = PROMPT
        api['461']['inputs']['filename_prefix'] = f'BFS_face_AB_1023_{case}_seed42'
        write_new(OUT / f'{case}.prepared-api.json', api)
        write_new(OUT / f'{case}.prepared-gui.json', gui_for(api, gui))
        cases[case] = api
    left, right = copy.deepcopy(cases['A']), copy.deepcopy(cases['B'])
    for value in [left, right]:
        value['475']['inputs']['image'] = '<reference>'
        value['461']['inputs']['filename_prefix'] = '<prefix>'
    assert left == right
    write_new(OUT / 'prepared-evidence.json', {
        'production_workflow': str(original_path), 'production_sha256': sha(original_path),
        'source_api': str(RESEARCH / 'v2.actual-api.json'), 'source_api_sha256': sha(RESEARCH / 'v2.actual-api.json'),
        'input_plan': plan, 'canvas': [1024, 1024], 'seed': 42,
        'assets': {p.name: {'sha256': sha(p), 'size': list(Image.open(p).size), 'mode': Image.open(p).mode}
                   for p in [OUT / 'body-crop-1024.png', OUT / 'reference-neutral-1024.png']},
        'ab_only_differences': ['475.inputs.image', '461.inputs.filename_prefix'],
        'gui_api_verified': True, 'engine': BASE,
    })
    print('PREPARED', OUT, flush=True)


def idle_gate():
    start = time.monotonic()
    while True:
        queue = get('/queue')
        if not queue['queue_running'] and not queue['queue_pending']:
            return queue
        if time.monotonic() - start > 1800:
            raise TimeoutError('Queue busy for 30 minutes; no prompt submitted.')
        print('WAIT_IDLE', len(queue['queue_running']), len(queue['queue_pending']), flush=True)
        time.sleep(30)


def upload(path):
    boundary = 'bfsab' + uuid.uuid4().hex
    name = 'bfs-ab-1023-' + uuid.uuid4().hex + '-' + path.name
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode()
    body += path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    request = urllib.request.Request(BASE + '/upload/image', data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    uploaded = Path(MANIFEST['inputDir']) / result['subfolder'] / result['name']
    assert sha(uploaded) == sha(path), uploaded
    return result


def run_case(case):
    if case == 'B':
        prior = json.loads((OUT / 'A.history.json').read_text())
        assert prior['status']['status_str'] == 'success' and prior['status']['completed']
    api = json.loads((OUT / f'{case}.prepared-api.json').read_text())
    gui = json.loads((OUT / f'{case}.prepared-gui.json').read_text())
    assert not (OUT / f'{case}.attempt.json').exists(), 'No automatic retry or duplicate submission.'
    write_new(OUT / f'{case}.attempt.json', {'started_at': time.time(), 'case': case, 'engine': BASE})
    idle_gate()
    uploads = {}
    for key, name in [('470', 'body-crop-1024.png'), ('475', 'body-crop-1024.png' if case == 'A' else 'reference-neutral-1024.png')]:
        uploads[key] = upload(OUT / name)
        api[key]['inputs']['image'] = '/'.join(p for p in [uploads[key]['subfolder'], uploads[key]['name']] if p)
    gui = gui_for(api, gui)
    write_new(OUT / f'{case}.uploads.json', uploads)
    write_new(OUT / f'{case}.submitted-api.json', api)
    write_new(OUT / f'{case}.submitted-gui.json', gui)
    write_new(OUT / f'{case}.pre-submit-queue.json', idle_gate())
    payload = {'prompt': api, 'client_id': str(uuid.uuid4()), 'extra_data': {'extra_pnginfo': {'workflow': gui}}}
    request = urllib.request.Request(BASE + '/prompt', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        submitted = json.load(response)
    write_new(OUT / f'{case}.submission.json', submitted)
    assert not submitted.get('node_errors'), submitted
    pid = submitted['prompt_id']
    print('SUBMITTED', case, pid, flush=True)
    start = time.monotonic()
    while True:
        record = get('/history/' + pid).get(pid)
        if record:
            write_new(OUT / f'{case}.history.json', record)
            assert record['status']['status_str'] == 'success' and record['status']['completed'], record['status']
            outputs = []
            for item in record['outputs']['461']['images']:
                path = Path(MANIFEST['outputDir']) / item['subfolder'] / item['filename']
                image = Image.open(path)
                assert image.size == (1024, 1024), image.size
                outputs.append({'path': str(path), 'sha256': sha(path), 'size': list(image.size), 'mode': image.mode})
            assert outputs, 'No image saved'
            write_new(OUT / f'{case}.outputs.json', outputs)
            print('SUCCESS', case, json.dumps(outputs, ensure_ascii=False), flush=True)
            return
        if time.monotonic() - start > 3600:
            raise TimeoutError('Prompt unresolved after one hour; inspect saved prompt_id, do not retry.')
        print('RUNNING', case, pid, round(time.monotonic() - start), flush=True)
        time.sleep(30)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--prepare', action='store_true')
    group.add_argument('--case', choices=['A', 'B'])
    args = parser.parse_args()
    if args.prepare:
        prepare()
    else:
        run_case(args.case)
