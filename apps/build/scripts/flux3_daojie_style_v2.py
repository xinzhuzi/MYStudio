#!/usr/bin/env python3
"""Isolated style-v2 ten-type preparation. Remote writes/submissions require --execute."""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import inspect
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path, PureWindowsPath

import flux3_daojie_workflow as w

HERE = Path(__file__).resolve().parent
REVISION = 'flux3-style-v2-1016'
LOCAL = w.TASK / 'rerun-style-v2'
STYLE_SOURCE = w.sources()[3]
REMOTE_ROOT = 'E:/IP/flux3-style-v2-1016'
PREFIX = 'flux3/ten-types-style-v2-1016'
IDENTITY = '；人物身份明确为东亚人（East Asian），保持原有年龄、性别、发型与服饰设定。'
TYPES = ('人物', '场景', '道具', '美宣', '人物多视图', '高清人脸', '分镜剧情图', '表情差分', '概念气氛图', '设定卡')
PE_KEYS = {'400', '404', '4010', '4017', '4030', '4031', '4032', '4013', '4014', '4110', '4111'}
DEPENDENCIES = (HERE / 'flux3_daojie_workflow.py', HERE / 'flux3_daojie_ssh.py',
                Path(__file__).resolve(),
                LOCAL / 'runtime-loader-baseline.json',
                w.TASK / 'artifacts/gui-template.json', w.TASK / 'artifacts/cases.json',
                w.TASK / 'research/object-info-after.json')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_once(path, value, binary=False):
    payload = value if binary else encoded(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.read_bytes() == payload, f'Refusing to overwrite differing evidence: {path}')
    else:
        with path.open('xb') as stream:
            stream.write(payload)


def report_path(label):
    return LOCAL / f'{label}-{time.time_ns()}.json'


def build_cases(previous):
    require(tuple(case['type'] for case in previous) == TYPES, 'Ten exact ordered types required')
    result = []
    for old in previous:
        case = copy.deepcopy(old)
        human = case['index'] in {1, 4, 5, 6, 7, 8, 10}
        case.update(previous_subject=old['subject'], previous_input_adjustment=old['input_adjustment'],
                    has_humans=human, revision=REVISION)
        case['subject'] += IDENTITY if human else ''
        case['identity_adjustment'] = IDENTITY if human else None
        result.append(case)
    return result


def build_workflow(case, style):
    workflow = w.build_gui(case)
    nodes = workflow['nodes'] + [node for sub in workflow['definitions']['subgraphs'] for node in sub['nodes']]
    by_id = {str(node['id']): node for node in nodes}
    by_id['9']['widgets_values'][0] = f"{PREFIX}/{case['index']:02d}"
    by_id['9']['widgets_values_named']['filename_prefix'] = by_id['9']['widgets_values'][0]
    style_node = by_id['4032']
    style_node['widgets_values_named'] = {'美术风格': style['positive_text'], '负向词表': style['negative_text']}
    style_node['widgets_values'] = [style['positive_text'], style['negative_text']]
    if case['index'] == 8:
        pe = by_id['4013']
        pe['widgets_values_named']['temperature'] = 0.5
        pe['widgets_values'][2] = 0.5
    workflow.setdefault('extra', {})['flux3StyleRevision'] = REVISION
    return workflow


def patch_style_bytes(original, style):
    text = original.decode('utf-8-sig')
    decoder = json.JSONDecoder()
    position = len(text) - len(text.lstrip())
    require(text[position] == '{', 'Top-level JSON must be object')
    position += 1
    spans = []
    keys = []
    while True:
        while position < len(text) and text[position].isspace():
            position += 1
        if text[position] == '}':
            break
        key, position = decoder.raw_decode(text, position)
        require(isinstance(key, str), 'Invalid top-level key')
        keys.append(key)
        while text[position].isspace():
            position += 1
        require(text[position] == ':', 'Expected JSON colon')
        position += 1
        while text[position].isspace():
            position += 1
        start = position
        _, position = decoder.raw_decode(text, position)
        if key == 'art_style_base':
            spans.append((start, position))
        while text[position].isspace():
            position += 1
        if text[position] == '}':
            break
        require(text[position] == ',', 'Expected JSON comma')
        position += 1
    require(len(keys) == len(set(keys)), 'Duplicate top-level keys refused')
    require(len(spans) == 1, 'Exactly one art_style_base object required')
    start, end = spans[0]
    if json.loads(text[start:end]) == style:
        return original
    replacement = json.dumps(style, ensure_ascii=False, indent=2)
    result = (text[:start] + replacement + text[end:]).encode('utf-8')
    if original.startswith(b'\xef\xbb\xbf'):
        result = b'\xef\xbb\xbf' + result
    old_data = json.loads(original)
    new_data = json.loads(result)
    require(new_data.pop('art_style_base') == style, 'Style patch mismatch')
    old_data.pop('art_style_base')
    require(new_data == old_data, 'Non-style data changed')
    return result


def draft_bundle():
    source = STYLE_SOURCE.read_bytes()
    style = json.loads(source)['art_style_base']
    check_style(style['positive_text'], False)
    require(bool(style['negative_text']), 'Frozen negative style missing')
    return {'revision': REVISION, 'style_source': str(STYLE_SOURCE.relative_to(w.ROOT)),
            'source_sha256': sha(source), 'art_style_base': style, 'style_sha256': sha(encoded(style)),
            'dependencies': {str(path.relative_to(w.ROOT)): sha(path.read_bytes()) for path in DEPENDENCIES},
            'cases': build_cases(read_json(w.TASK / 'artifacts/cases.json'))}


def load_bundle(required=True):
    path = LOCAL / 'frozen.json'
    require(path.exists() or not required, 'Run prepare first')
    bundle = read_json(path) if path.exists() else draft_bundle()
    current = draft_bundle()
    comparable = copy.deepcopy(bundle)
    # Other tasks may update unrelated fields in the shared JSON. The exact
    # frozen art_style_base, cases and all execution dependencies still gate us.
    comparable['source_sha256'] = current['source_sha256']
    require(comparable == current, 'Frozen style, cases or builder dependency drift; stop for review')
    return bundle


def pe_graph(graph):
    return {key: value for key, value in graph.items() if key in PE_KEYS}


def check_style(text, human):
    lower = text.lower()
    anchors = {
        'gongbi': ('gongbi', '工笔'),
        'baimiao': ('baimiao', '白描'),
        'lianhuanhua': ('lianhuanhua', '连环画'),
        'watercolor washes': ('watercolor', '水彩', '透明薄染', '薄透设色'),
        'ink wash': ('ink wash', '水墨'),
    }
    missing = [name for name, terms in anchors.items() if not any(term in lower for term in terms)]
    diagnostics = []
    for name, alternatives in (
        ('transparent washes', ('薄染', '薄透', 'transparent washes', 'transparent watercolor')),
        ('clean digital surface', ('洁净平整', '干净平整', 'clean digital', 'clean and flat')),
        ('brushwork', ('手绘笔性', 'brushwork')),
    ):
        if not any(term in lower for term in alternatives):
            diagnostics.append(name)
    if human and not any(term in lower for term in ('东亚', 'east asian')):
        missing.append('East Asian identity')
    require(not missing, 'PE style/identity gate failed; no supplement allowed: ' + ', '.join(missing))
    return diagnostics


def check_history(history, prompt_id, graph):
    require(history['prompt'][1] == prompt_id, 'Specific prompt_id mismatch')
    require(history['prompt'][2] == graph, 'Executed graph differs from saved submitted graph')
    require(history['status']['status_str'] == 'success' and history['status']['completed'], 'History not successful')


def check_pe(history, case, style):
    outputs = history['outputs']
    node = outputs['4013']
    status = node['api_pe_status'][0]
    require(status == 'AI扩写OK:' + w.MODEL, 'Wrong served model or fallback: ' + status)
    require(outputs['4032']['bases_text'][0] == style['positive_text'].strip(), 'Live positive style stale')
    require(outputs['4032']['bases_text_negative'][0] == style['negative_text'].strip(), 'Live negative style stale')
    expanded = node['api_pe_pos'][0]
    positive = outputs['4110']['text'][0]
    negative = outputs['4111']['text'][0]
    check_style(expanded, case['has_humans'])
    check_style(positive, case['has_humans'])
    require(positive == expanded, 'RGB final positive is not verbatim PE positive')
    require(negative == node['api_pe_neg'][0], 'RGB final negative differs from PE negative')
    terms = [term.strip() for term in re.split('[,，\\n]', style['negative_text']) if term.strip()]
    require(all(term in negative for term in terms), 'Style negatives lost in final output')
    return {'api_pe_status': status, 'expanded_positive': expanded, 'expanded_negative': node['api_pe_neg'][0],
            'final_positive': positive, 'final_negative': negative}


def prepare():
    bundle = load_bundle(False)
    save_once(LOCAL / 'frozen.json', bundle)
    for case in bundle['cases']:
        folder = LOCAL / 'artifacts' / f"{case['index']:02d}"
        workflow = build_workflow(case, bundle['art_style_base'])
        graph = w.expand_gui(workflow)
        w.validate_api(graph)
        save_once(folder / 'input.json', case)
        save_once(folder / 'workflow.json', workflow)
        save_once(folder / 'integrated-api.json', graph)
        save_once(folder / 'graph-metadata.json', {'revision': REVISION, 'gui_sha256': sha(encoded(workflow)),
                  'api_sha256': sha(encoded(graph)), 'style_sha256': bundle['style_sha256'],
                  'gui_api_equal': graph == expected_graph(case, bundle['art_style_base']),
                  'supplement': None, 'gui_live_verified': False})
    print(json.dumps({'prepared': 10, 'folder': str(LOCAL), 'no_remote_calls': True}))


def expected_graph(case, style):
    graph = w.api_graph(case)
    graph['9']['inputs']['filename_prefix'] = f"{PREFIX}/{case['index']:02d}"
    graph['4032']['inputs'] = {'美术风格': style['positive_text'], '负向词表': style['negative_text']}
    if case['index'] == 8:
        graph['4013']['inputs']['temperature'] = 0.5
    return graph


def artifact_folder(case):
    name = '08-attempt02' if case['index'] == 8 else f"{case['index']:02d}"
    return LOCAL / 'artifacts' / name


def validate():
    bundle = load_bundle(False)
    for case in bundle['cases']:
        graph = w.expand_gui(build_workflow(case, bundle['art_style_base']))
        require(graph == expected_graph(case, bundle['art_style_base']), 'GUI/API divergence')
        w.validate_api(graph)
        folder = artifact_folder(case)
        if (LOCAL / 'frozen.json').exists():
            require(read_json(folder / 'input.json') == case, 'Saved case drift')
            require(w.expand_gui(read_json(folder / 'workflow.json')) == graph, 'Saved GUI drift')
            require(read_json(folder / 'integrated-api.json') == graph, 'Saved API drift')
    print(json.dumps({'no_submit': True, 'types': 10, 'gui_api_equal': True,
                      'frozen': (LOCAL / 'frozen.json').exists(), 'style_sha256': bundle['style_sha256']}))


def remote_worker(action, data):
    import base64
    import hashlib
    import json
    import shutil
    import time
    import urllib.error
    import urllib.request
    from pathlib import Path

    def check(condition, message):
        if not condition:
            raise RuntimeError(message)

    def digest(payload):
        return hashlib.sha256(payload).hexdigest()

    def get(route):
        with urllib.request.urlopen('http://127.0.0.1:17000' + route, timeout=12) as response:
            return json.load(response)

    def idle():
        queue = get('/queue')
        check(not queue['queue_running'] and not queue['queue_pending'], 'Queue occupied; no submission/write')
        return queue

    def persist(path, value):
        content = json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8') + b'\n'
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            check(path.read_bytes() == content, 'Existing remote evidence differs: ' + str(path))
        else:
            with path.open('xb') as stream:
                stream.write(content)

    root = Path('E:/IP')
    homes = [path / 'comfyui' for path in root.iterdir() if (path / 'comfyui/manifest.json').is_file()]
    check(len(homes) == 1, 'Engine home ambiguous')
    home = homes[0]
    work = root / 'flux3-style-v2-1016'
    targets = {
        'repo': root / 'MYStudio/apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
        'app': root / 'manying-studio/resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
        'runtime': home / 'daojie-data/qi21_bases.json',
    }
    if action == 'inspect':
        files = {}
        for name, path in targets.items():
            content = path.read_bytes()
            files[name] = {'path': str(path), 'sha256': digest(content),
                           'mtime_ns': path.stat().st_mtime_ns, 'payload': base64.b64encode(content).decode()}
        loaders = {}
        for name in ('my_qi21_bases_text.py', 'my_qi21_api_pe.py'):
            path = home / 'ComfyUI/custom_nodes/my-nodes/nodes' / name
            content = path.read_bytes()
            loaders[name] = {'path': str(path), 'sha256': digest(content),
                             'source': content.decode('utf-8-sig')}
        with urllib.request.urlopen('http://127.0.0.1:1234/api/v1/models', timeout=12) as response:
            models = json.load(response)
        return {'files': files, 'home': str(home), 'loaders': loaders, 'queue': get('/queue'),
                'key_state': get('/my-nodes/qi21-pe-key'), 'object_info': get('/object_info'), 'lm_models': models}
    if action == 'deploy':
        records = data['files']
        check(set(records) == set(targets), 'Exactly three style targets required')
        idle()
        for name, record in records.items():
            path = targets[name]
            check(str(path) == record['path'], 'Target path changed')
            check(digest(path.read_bytes()) == record['old_sha256'], 'Old hash fence failed: ' + name)
        changes = []
        for name, record in records.items():
            idle()
            path = targets[name]
            old = path.read_bytes()
            check(digest(old) == record['old_sha256'], 'Target changed before write: ' + name)
            content = base64.b64decode(record['new_payload'], validate=True)
            check(digest(content) == record['new_sha256'], 'New payload hash mismatch')
            before = json.loads(old)
            after = json.loads(content)
            check(after.pop('art_style_base') == data['art_style_base'], 'Wrong new style')
            before.pop('art_style_base')
            check(before == after, 'Non-style objects changed')
            backup = None
            old_mtime = path.stat().st_mtime_ns
            if old != content:
                backup = work / 'backups' / data['stamp'] / name / 'qi21_bases.json'
                backup.parent.mkdir(parents=True, exist_ok=True)
                check(not backup.exists(), 'Backup already exists')
                shutil.copy2(path, backup)
                check(digest(backup.read_bytes()) == record['old_sha256'], 'Backup hash failed')
                idle()
                check(digest(path.read_bytes()) == record['old_sha256'], 'Target drift after backup')
                path.write_bytes(content)
                check(path.stat().st_mtime_ns != old_mtime, 'mtime unchanged; stop and review loader cache')
            check(digest(path.read_bytes()) == record['new_sha256'], 'Written hash mismatch')
            changes.append({'target': str(path), 'old_sha256': record['old_sha256'],
                            'sha256': record['new_sha256'], 'backup': str(backup) if backup else None,
                            'mtime_before_ns': old_mtime, 'mtime_after_ns': path.stat().st_mtime_ns})
            persist(work / ('deployment-' + data['stamp'] + '-' + name + '.json'), changes[-1])
        return {'ok': True, 'files': changes, 'restart_required': False, 'live_style_verified': False}
    check(data['folder'] in ['probe', '08-attempt02'] + [f'{index:02d}' for index in range(1, 11)], 'Invalid record folder')
    folder = work / data['folder']
    stage = data['stage']
    check(stage in ('style', 'pe', 'render'), 'Invalid stage')
    if action == 'lookup':
        paths = {name: folder / f'{stage}-{name}.json' for name in ('intent', 'submission')}
        return {name: json.loads(path.read_bytes()) if path.exists() else None for name, path in paths.items()}
    if action == 'submit':
        for name, record in data['style_fence'].items():
            check(str(targets[name]) == record['path'], 'Style fence path changed')
            check(digest(targets[name].read_bytes()) == record['sha256'], 'Style fence hash drift: ' + name)
        check(get('/my-nodes/qi21-pe-key')['source'] == 'none', 'Cloud key present; no submission')
        idle()
        check(time.time() < data['deadline'], 'Type deadline expired before submission')
        check(not (folder / f'{stage}-intent.json').exists(), 'Remote intent exists; resume, never resubmit')
        persist(folder / f'{stage}-prompt.json', data['payload'])
        persist(folder / 'workflow.json', data['payload']['extra_data']['extra_pnginfo']['workflow'])
        persist(folder / 'input.json', data['case'])
        idle()
        persist(folder / f'{stage}-intent.json', data['intent'])
        request = urllib.request.Request('http://127.0.0.1:17000/prompt',
                                        data=json.dumps(data['payload']).encode('utf-8'),
                                        headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            failure = {'http_status': error.code, 'body': error.read().decode('utf-8', errors='replace')}
            persist(folder / f'{stage}-rejection.json', failure)
            raise RuntimeError(str(failure))
        check(result.get('prompt_id') and not result.get('node_errors'), 'Prompt rejected: ' + str(result))
        persist(folder / f'{stage}-submission.json', result)
        return result
    if action == 'poll':
        history = get('/history/' + data['prompt_id'])
        if data['prompt_id'] not in history:
            return {'done': False, 'queue': get('/queue')}
        item = history[data['prompt_id']]
        persist(folder / f'{stage}-history.json', item)
        return {'done': True, 'history': item}
    if action == 'image':
        from PIL import Image

        meta = data['meta']
        check(meta['type'] == 'output', 'Image is not output media')
        path = home / 'output' / meta['subfolder'] / meta['filename']
        output_root = home / 'output/flux3/ten-types-style-v2-1016'
        check(path.resolve().is_relative_to(output_root.resolve()), 'Image outside revision output root')
        content = path.read_bytes()
        with Image.open(path) as image:
            image.load()
            check(image.mode == 'RGB' and list(image.size) == data['size'], 'Image mode/size mismatch')
            return {'image_path': str(path), 'mode': image.mode, 'size': list(image.size),
                    'sha256': digest(content), 'payload': base64.b64encode(content).decode()}
    if action == 'receipt':
        persist(folder / 'receipt.json', data['receipt'])
        return {'ok': True}
    raise RuntimeError('Unknown action: ' + action)


def remote(action, **data):
    code = inspect.getsource(remote_worker) + '\nimport json\nprint(json.dumps(remote_worker(' + repr(action) + ', ' + repr(data) + '), ensure_ascii=True))\n'
    result = subprocess.run([sys.executable, str(HERE / 'flux3_daojie_ssh.py'), '--timeout', '60'],
                            input=code, text=True, capture_output=True, timeout=65, check=False)
    require(result.returncode == 0, 'SSH action failed; resume saved intent/ID, do not resubmit: ' + result.stderr + result.stdout[:1000])
    return json.loads(result.stdout)


def inspect_style():
    bundle = load_bundle(False)
    snapshot = remote('inspect')
    path = report_path('inspect')
    files = {}
    for name, record in snapshot['files'].items():
        original = base64.b64decode(record['payload'], validate=True)
        patched = patch_style_bytes(original, bundle['art_style_base'])
        files[name] = {'path': record['path'], 'old_sha256': sha(original), 'new_sha256': sha(patched),
                       'new_payload': base64.b64encode(patched).decode(), 'old_mtime_ns': record['mtime_ns']}
    loaders_match = True
    for name, record in snapshot['loaders'].items():
        local = w.ROOT / 'apps/backend/engines/comfyui/my_nodes/nodes' / name
        match = local.read_text(encoding='utf-8').replace('\r\n', '\n') == record['source'].replace('\r\n', '\n')
        record['matches_local_normalized'] = match
        loaders_match = loaders_match and match
    manifest = {'revision': REVISION, 'frozen_sha256': sha(encoded(bundle)), 'captured_at': time.time(),
                'art_style_base': bundle['art_style_base'], 'files': files, 'snapshot': snapshot,
                'loaders_match_local': loaders_match, 'effective_style_verified': False}
    save_once(path, manifest)
    print(json.dumps({'manifest': str(path), 'loaders_match_local': loaders_match,
                      'queue': snapshot['queue'], 'effective_style_verified': False}, ensure_ascii=False))


def checked_manifest(path, bundle, deployed=False):
    manifest = read_json(path)
    require(manifest['revision'] == REVISION, 'Wrong manifest revision')
    require(manifest['frozen_sha256'] == sha(encoded(bundle)), 'Manifest source/parameter drift')
    runtime_baseline = read_json(LOCAL / 'runtime-loader-baseline.json')
    require({name: record['sha256'] for name, record in manifest['snapshot']['loaders'].items()}
            == runtime_baseline, 'Runtime loader drift from approved live baseline')
    if deployed:
        require(all(record['old_sha256'] == record['new_sha256'] for record in manifest['files'].values()),
                'Fresh inspect must show all three copies already aligned before live execution')
    return manifest


def deploy_style(path):
    bundle = load_bundle()
    manifest = checked_manifest(path, bundle)
    result = remote('deploy', files=manifest['files'], art_style_base=bundle['art_style_base'],
                    stamp=time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    destination = report_path('deployment')
    save_once(destination, result)
    print(json.dumps({'report': str(destination), **result}, ensure_ascii=False))


def submitted_id(folder, stage, graph, workflow, case, manifest, deadline):
    request_path = folder / f'{stage}-prompt.json'
    intent_path = folder / f'{stage}-intent.json'
    submission_path = folder / f'{stage}-submission.json'
    if request_path.exists():
        payload = read_json(request_path)
        require(payload['prompt'] == graph, 'Saved submission graph drift')
        require(payload['extra_data']['extra_pnginfo']['workflow'] == workflow, 'Saved GUI drift')
    else:
        payload = {'prompt': graph, 'client_id': REVISION + '-' + uuid.uuid4().hex,
                   'extra_data': {'extra_pnginfo': {'workflow': workflow}}}
        save_once(request_path, payload)
    if submission_path.exists():
        require(intent_path.exists(), 'Submission missing durable intent')
        require(read_json(intent_path)['payload_sha256'] == sha(encoded(payload)), 'Intent payload drift')
        return read_json(submission_path)['prompt_id']
    lookup = remote('lookup', folder=folder.name, stage=stage)
    if lookup['submission'] is not None:
        require(intent_path.exists() and lookup['intent'] == read_json(intent_path), 'Remote/local intent mismatch')
        require(read_json(intent_path)['payload_sha256'] == sha(encoded(payload)), 'Recovered payload mismatch')
        save_once(submission_path, lookup['submission'])
        return lookup['submission']['prompt_id']
    require(not intent_path.exists() and lookup['intent'] is None,
            'Ambiguous submission intent without ID; inspect remote intent/queue/history by client_id; no auto-resubmit')
    require(time.time() < deadline, 'Type deadline expired; no new submission')
    intent = {'revision': REVISION, 'client_id': payload['client_id'], 'payload_sha256': sha(encoded(payload)),
              'deadline': deadline, 'created_at': time.time()}
    save_once(intent_path, intent)
    fence = {name: {'path': record['path'], 'sha256': record['new_sha256']}
             for name, record in manifest['files'].items()}
    result = remote('submit', folder=folder.name, stage=stage, payload=payload, intent=intent,
                    deadline=deadline, style_fence=fence, case=case)
    require(result.get('prompt_id') and not result.get('node_errors'), 'Missing prompt ID or node error')
    save_once(submission_path, result)
    print(f'{stage} submitted {result["prompt_id"]}', flush=True)
    return result['prompt_id']


def wait_history(folder, stage, prompt_id, graph, deadline):
    history_path = folder / f'{stage}-history.json'
    if history_path.exists():
        history = read_json(history_path)
        check_history(history, prompt_id, graph)
        return history
    while True:
        result = remote('poll', folder=folder.name, stage=stage, prompt_id=prompt_id)
        if result['done']:
            history = result['history']
            save_once(history_path, history)
            check_history(history, prompt_id, graph)
            print(f'{stage} completed {prompt_id}', flush=True)
            return history
        if time.time() >= deadline:
            save_once(report_path(f'timeout-{folder.name}-{stage}'),
                      {'prompt_id': prompt_id, 'queue': result['queue'], 'deadline': deadline})
            raise TimeoutError('Type deadline reached; job retained, no cancellation or next submission')
        time.sleep(min(8, max(0, deadline - time.time())))


def stage_history(folder, stage, graph, workflow, case, manifest, deadline):
    prompt_id = submitted_id(folder, stage, graph, workflow, case, manifest, deadline)
    return prompt_id, wait_history(folder, stage, prompt_id, graph, deadline)


def probe_style(path):
    bundle = load_bundle()
    manifest = checked_manifest(path, bundle, deployed=True)
    case = bundle['cases'][0]
    workflow = build_workflow(case, bundle['art_style_base'])
    graph = {'4032': w.expand_gui(workflow)['4032']}
    folder = LOCAL / 'probe'
    deadline_path = folder / 'deadline.json'
    if not deadline_path.exists():
        save_once(deadline_path, {'deadline': time.time() + 300})
    prompt_id, history = stage_history(folder, 'style', graph, workflow, case, manifest, read_json(deadline_path)['deadline'])
    output = history['outputs']['4032']
    style = bundle['art_style_base']
    require(output['bases_text'][0] == style['positive_text'].strip(), 'Effective style positive stale')
    require(output['bases_text_negative'][0] == style['negative_text'].strip(), 'Effective style negative stale')
    proof = {'revision': REVISION, 'style_sha256': bundle['style_sha256'], 'prompt_id': prompt_id,
             'history_sha256': sha(encoded(history)), 'no_restart': True, 'live_node_output_matches': True}
    save_once(LOCAL / 'live-style-proof.json', proof)
    print(json.dumps(proof))


def visual_result(folder):
    path = folder / 'visual.json'
    if not path.exists():
        return {'visual_status': 'pending', 'visual_notes': []}
    result = read_json(path)
    require(result['visual_status'] in ('pass', 'issues'), 'Visual status must be pass or issues')
    require(isinstance(result['visual_notes'], list) and all(isinstance(note, str) and note.strip() for note in result['visual_notes'])
            and bool(result['visual_notes']), 'Open visual observations required')
    return result


def run_type(kind, stage, path):
    bundle = load_bundle()
    manifest = checked_manifest(path, bundle, deployed=True)
    proof = read_json(LOCAL / 'live-style-proof.json')
    require(proof['style_sha256'] == bundle['style_sha256'] and proof['live_node_output_matches'], 'Live style proof required')
    case = next(item for item in bundle['cases'] if item['type'] == kind)
    for prior in bundle['cases'][:case['index'] - 1]:
        verify_one(prior, bundle)
    if case['index'] > 1:
        require(visual_result(LOCAL / 'artifacts/01')['visual_status'] != 'pending', 'Main must inspect portrait before remaining types')
    folder = artifact_folder(case)
    workflow = read_json(folder / 'workflow.json')
    graph = w.expand_gui(workflow)
    require(graph == expected_graph(case, bundle['art_style_base']), 'Prepared graph drift')
    require(read_json(folder / 'integrated-api.json') == graph, 'Prepared GUI/API mismatch')
    deadline_path = folder / 'deadline.json'
    if not deadline_path.exists():
        save_once(deadline_path, {'started_at': time.time(), 'deadline': time.time() + 1800})
    deadline = read_json(deadline_path)['deadline']
    if stage == 'render':
        require((folder / 'pe-submission.json').exists(), 'Run PE first; render cannot bypass PE gate')
    pe_id, expanded = stage_history(folder, 'pe', pe_graph(graph), workflow, case, manifest, deadline)
    texts = check_pe(expanded, case, bundle['art_style_base'])
    save_once(folder / 'pe-gate.json', {**texts, 'pe_prompt_id': pe_id, 'style_sha256': bundle['style_sha256'], 'supplement': None})
    if stage == 'pe':
        print(json.dumps({'type': kind, 'pe_gate_ok': True, 'pe_prompt_id': pe_id}, ensure_ascii=False))
        return
    render_id, rendered = stage_history(folder, 'render', graph, workflow, case, manifest, deadline)
    require(check_pe(rendered, case, bundle['art_style_base']) == texts, 'Integrated render PE differs from approved PE; do not count')
    metadata = rendered['outputs']['9']['images']
    require(len(metadata) == 1, 'Expected exactly one saved image')
    result = remote('image', folder=folder.name, stage='render', meta=metadata[0], size=[case['width'], case['height']])
    payload = base64.b64decode(result.pop('payload'), validate=True)
    require(sha(payload) == result['sha256'], 'Transferred image hash mismatch')
    save_once(folder / 'image.png', payload, binary=True)
    receipt = {**case, **result, **texts, 'pe_prompt_id': pe_id, 'prompt_id': render_id,
               'history_status': 'success', 'style_sha256': bundle['style_sha256'],
               'gui_sha256': sha(encoded(workflow)), 'api_sha256': sha(encoded(graph)),
               'supplement': None, 'visual_status': 'pending', 'visual_notes': []}
    save_once(folder / 'receipt.json', receipt)
    remote('receipt', folder=folder.name, stage='render', receipt=receipt)
    verify_one(case, bundle)
    print(json.dumps({'type': kind, 'generation_ok': True, 'prompt_id': render_id, 'sha256': receipt['sha256']}, ensure_ascii=False))


def verify_one(case, bundle):
    from PIL import Image

    folder = artifact_folder(case)
    receipt = read_json(folder / 'receipt.json')
    require(all(receipt[key] == value for key, value in case.items()), 'Receipt case mismatch')
    require(read_json(folder / 'input.json') == case, 'Input evidence mismatch')
    workflow = read_json(folder / 'workflow.json')
    graph = w.expand_gui(workflow)
    require(graph == expected_graph(case, bundle['art_style_base']), 'Saved GUI not approved API')
    require(read_json(folder / 'integrated-api.json') == graph, 'Saved integrated API differs')
    require(receipt['style_sha256'] == bundle['style_sha256'] and receipt['supplement'] is None, 'Style/provenance mismatch')
    require(receipt['api_sha256'] == sha(encoded(graph)) and receipt['gui_sha256'] == sha(encoded(workflow)), 'Graph hash mismatch')
    histories = {}
    for stage, id_key in (('pe', 'pe_prompt_id'), ('render', 'prompt_id')):
        expected = pe_graph(graph) if stage == 'pe' else graph
        request = read_json(folder / f'{stage}-prompt.json')
        submission = read_json(folder / f'{stage}-submission.json')
        intent = read_json(folder / f'{stage}-intent.json')
        require(intent['revision'] == REVISION and intent['payload_sha256'] == sha(encoded(request)), 'Intent provenance mismatch')
        require(request['client_id'] == intent['client_id'] and request['client_id'].startswith(REVISION + '-'), 'Wrong run client ID')
        require(submission['prompt_id'] == receipt[id_key], 'Submission ID mismatch')
        require(request['prompt'] == expected, 'Submitted graph differs from GUI-derived projection')
        require(request['extra_data']['extra_pnginfo']['workflow'] == workflow, 'Request GUI differs')
        history = read_json(folder / f'{stage}-history.json')
        check_history(history, receipt[id_key], expected)
        require(history['prompt'][3]['client_id'] == request['client_id'], 'History client provenance mismatch')
        require(history['prompt'][3]['extra_pnginfo']['workflow'] == workflow, 'Executed GUI provenance mismatch')
        histories[stage] = history
    texts = check_pe(histories['pe'], case, bundle['art_style_base'])
    require(check_pe(histories['render'], case, bundle['art_style_base']) == texts, 'Render did not consume exact PE text')
    require(all(receipt[key] == value for key, value in texts.items()), 'Receipt PE text differs')
    content = (folder / 'image.png').read_bytes()
    require(sha(content) == receipt['sha256'], 'PNG hash mismatch')
    with Image.open(folder / 'image.png') as image:
        image.load()
        require(image.mode == receipt['mode'] == 'RGB', 'Not RGB')
        require(list(image.size) == receipt['size'] == [case['width'], case['height']], 'Wrong actual dimensions')
        png_graph = json.loads(image.info['prompt'])
        # ComfyUI annotates IS_CHANGED nodes when embedding the executed prompt.
        # Class types, inputs and every other field must still match exactly.
        normalized_png_graph = {
            key: {name: value for name, value in node.items() if name != 'is_changed'}
            for key, node in png_graph.items()
        }
        require(normalized_png_graph == graph, 'PNG graph provenance mismatch')
        require(json.loads(image.info['workflow']) == workflow, 'PNG GUI provenance mismatch')
    metadata = histories['render']['outputs']['9']['images']
    require(len(metadata) == 1 and metadata[0]['type'] == 'output', 'Wrong output metadata')
    path = PureWindowsPath(receipt['image_path'])
    require(path.name == metadata[0]['filename'], 'PNG filename mismatch')
    require(path.parent.parts[-2:] == ('flux3', 'ten-types-style-v2-1016'), 'Old/wrong output folder')
    require(PureWindowsPath(metadata[0]['subfolder']).parts == ('flux3', 'ten-types-style-v2-1016'), 'Wrong output subfolder')
    require(path.drive.upper() == 'E:' and 'comfyui' in path.parts, 'Wrong output drive/home')
    return receipt


def verify():
    bundle = load_bundle()
    rows = []
    for case in bundle['cases']:
        row = {'type': case['type'], 'index': case['index'], 'generation_ok': False, 'visual_ok': False}
        try:
            receipt = verify_one(case, bundle)
            visual = visual_result(artifact_folder(case))
            row.update(generation_ok=True, visual_ok=visual['visual_status'] == 'pass',
                       prompt_id=receipt['prompt_id'], sha256=receipt['sha256'], **visual)
        except (KeyError, ValueError, OSError, TypeError) as error:
            row['error'] = str(error)
        rows.append(row)
    passed = all(row['generation_ok'] for row in rows)
    report = {'revision': REVISION, 'generation_ok': passed,
              'visual_ok': all(row['visual_ok'] for row in rows), 'gui_verified': False,
              'gui_note': 'Saved GUI/API equality is not live GUI opening evidence.', 'types': rows}
    destination = report_path('verification')
    save_once(destination, report)
    print(json.dumps({'report': str(destination), 'generation_ok': passed,
                      'count': sum(row['generation_ok'] for row in rows), 'gui_verified': False}))
    return 0 if passed else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog='No bulk execution, restart, key change, model download/unload or userdata workflow writes.')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('prepare', help='Freeze current source + old cases; save ten GUI/API inputs only, no SSH')
    commands.add_parser('validate', help='Read-only offline GUI/API and source-drift validation; no prepare/submit')
    commands.add_parser('inspect-style', help='GET/read-only SSH; persist three-copy hash-fenced deployment manifest locally')
    for name, help_text in (
        ('deploy-style', 'Patch only art_style_base in three copies, with backup/idle/hash fences'),
        ('probe-style', 'Execute style output node only and verify effective hot-read style; no model inference'),
        ('run', 'One exact type, PE gate then integrated render, or resume its durable IDs'),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument('--manifest', type=Path, required=True, help='Exact inspect-style report; execution needs fresh already-aligned three-copy report')
        command.add_argument('--execute', action='store_true', help='Explicit main-session authorization for remote writes/submission')
        if name == 'run':
            command.add_argument('--type', choices=TYPES, required=True)
            command.add_argument('--stage', choices=('pe', 'render', 'all'), default='pe',
                                 help='Default PE only; render/all require preserved successful PE and style gate')
    commands.add_parser('verify', help='Offline ten PNG/history/style/PE provenance checks, visuals reported separately')
    args = parser.parse_args()
    if args.command in ('deploy-style', 'probe-style', 'run') and not args.execute:
        parser.error('Remote side effects require --execute; worker must not invoke this command')
    if args.command == 'prepare':
        prepare()
    elif args.command == 'validate':
        validate()
    elif args.command == 'inspect-style':
        inspect_style()
    elif args.command == 'deploy-style':
        deploy_style(args.manifest)
    elif args.command == 'probe-style':
        probe_style(args.manifest)
    elif args.command == 'run':
        run_type(args.type, args.stage, args.manifest)
    else:
        return verify()
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, TimeoutError, subprocess.SubprocessError) as error:
        print(f'STOP: {type(error).__name__}: {error}', file=sys.stderr)
        raise SystemExit(1)
