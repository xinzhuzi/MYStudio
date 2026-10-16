#!/usr/bin/env python3
"""Audit saved QI2.1 defaults, dry-run real canvases, and review offline receipts."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/10-16-qi21-defaults-install'
COMFY = REPO / 'apps/backend/engines/comfyui'
TURBO = '0 · Turbo 8步'
TURBO_FILE = 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors'
FIX_FILE = 'qwen2.1-detail-fix-2.0.safetensors'
CANVAS_NAMES = {'t2i': 'qi21-道劫-t2i.json', 'i2i': 'qi21-道劫-i2i.json', 'edit': 'qi21-edit.json'}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def product_paths(root: Path = COMFY) -> list[Path]:
    return sorted((root / 'workflows').rglob('*.json')) + sorted((root / 'my_nodes/subgraphs').glob('*.json'))


def canvas_paths(root: Path = COMFY) -> dict[str, Path]:
    paths = list((root / 'workflows').rglob('*.json'))
    return {line: next(path for path in paths if path.name == name) for line, name in CANVAS_NAMES.items()}


def link_errors(graph: dict) -> list[str]:
    nodes = {node['id']: node for node in graph['nodes']}
    links: list[dict] = graph.get('links', [])
    if links and isinstance(links[0], list):
        links = [dict(zip(('id', 'origin_id', 'origin_slot', 'target_id', 'target_slot', 'type'), link)) for link in links]
    by_id = {link['id']: link for link in links}
    errors = []
    if graph.get('7:7028', {}).get('inputs', {}).get('model') != ['7:7027', 0] or graph.get('7:7031', {}).get('inputs', {}).get('guider') != ['7:7029', 0]:
        errors.append('receipt graph lacks actual Fix→Turbo→guider→sampler dependency')
    if len(by_id) != len(links):
        errors.append('duplicate link IDs')
    for link in links:
        source, target = link['origin_id'], link['target_id']
        try:
            source_slot = graph['inputs'][link['origin_slot']] if source == -10 else nodes[source]['outputs'][link['origin_slot']]
            target_slot = graph['outputs'][link['target_slot']] if target == -20 else nodes[target]['inputs'][link['target_slot']]
            outgoing = source_slot.get('linkIds' if source == -10 else 'links') or []
            incoming = target_slot.get('linkIds') if target == -20 else [target_slot.get('link')]
            if link['id'] not in outgoing or link['id'] not in (incoming or []):
                errors.append(f"link {link['id']} lacks reciprocal endpoint")
        except (KeyError, IndexError):
            errors.append(f"link {link['id']} has missing endpoint")
    for node in nodes.values():
        for slot_index, slot in enumerate(node.get('inputs', [])):
            link_id = slot.get('link')
            if link_id is not None and (link_id not in by_id or (by_id[link_id]['target_id'], by_id[link_id]['target_slot']) != (node['id'], slot_index)):
                errors.append(f"node {node['id']} input {slot_index} has stale link {link_id}")
        for slot_index, slot in enumerate(node.get('outputs', [])):
            for link_id in slot.get('links') or []:
                if link_id not in by_id or (by_id[link_id]['origin_id'], by_id[link_id]['origin_slot']) != (node['id'], slot_index):
                    errors.append(f"node {node['id']} output {slot_index} has stale link {link_id}")
    for side, node_id, id_key, slot_key in (('inputs', -10, 'origin_id', 'origin_slot'), ('outputs', -20, 'target_id', 'target_slot')):
        for index, slot in enumerate(graph.get(side, [])):
            expected = {link['id'] for link in links if link[id_key] == node_id and link[slot_key] == index}
            if set(slot.get('linkIds') or []) != expected:
                errors.append(f'boundary {side}[{index}] linkIds drift')
    return errors


def audit_document(document: dict) -> list[str]:
    errors = []
    subgraphs = (document.get('definitions') or {}).get('subgraphs', [])
    if any(any(node['type'] in ('MyQi21ApiPE', 'MyQi21SpeedSelect') or node.get('title') == '[4012] PE启用?' for node in subgraph['nodes']) for subgraph in subgraphs):
        errors.extend(link_errors(document))
    for graph in [document, *subgraphs]:
        nodes = {node['id']: node for node in graph.get('nodes', [])}
        if any(node['type'] in ('MyQi21ApiPE', 'MyQi21SpeedSelect') or node.get('title') == '[4012] PE启用?' for node in nodes.values()):
            errors.extend(link_errors(graph))
        for node in nodes.values():
            if node['type'] == 'MyQi21ApiPE':
                if len(node.get('widgets_values', [])) < 7 or node['widgets_values'][6] is not False:
                    errors.append('MyQi21ApiPE missing saved seventh switch=False')
                if node.get('widgets_values_named', {}).get('AI扩写开关') is not False:
                    errors.append('MyQi21ApiPE named switch drift')
            if node.get('title') == '[4012] PE启用?':
                if node.get('widgets_values') != [False]:
                    errors.append('PrimitiveBoolean PE saved default is not False')
                if node.get('widgets_values_named', {}).get('value', False) is not False:
                    errors.append('PrimitiveBoolean PE named default drift')
                selector = nodes[4014]
                if selector.get('widgets_values', [None] * 5)[4] is not False:
                    errors.append('PE selection saved widget mirror drift')
            if node['type'] == 'MyQi21SpeedSelect':
                if node.get('widgets_values') != [TURBO] or node.get('widgets_values_named', {}).get('mode') != TURBO:
                    errors.append('speed selector positional/named default drift')
                if graph.get('widgets', [None])[0] != TURBO:
                    errors.append('accel subgraph saved default drift')
                links = {link['id']: link for link in graph['links']}
                try:
                    fix, turbo = nodes[7027], nodes[7028]
                    if fix['widgets_values'] != [FIX_FILE, 0.5] or turbo['widgets_values'] != [TURBO_FILE, 1.0]:
                        errors.append('Fix/Turbo dependency or strength drift')
                    for loader in (fix, turbo):
                        if loader.get('widgets_values_named') != dict(zip(('lora_name', 'strength_model'), loader['widgets_values'])):
                            errors.append(f"loader {loader['id']} named values drift")
                    fix_in = links[fix['inputs'][0]['link']]
                    turbo_in = links[turbo['inputs'][0]['link']]
                    if (fix_in['origin_id'], fix_in['origin_slot']) != (-10, next(index for index, slot in enumerate(graph['inputs']) if slot['name'] == 'model')) or (turbo_in['origin_id'], turbo_in['origin_slot']) != (7027, 0):
                        errors.append('Turbo model route must be base→Fix0.5→Turbo1.0')
                    if '直连底模' in turbo.get('title', '') or 'Fix' not in turbo.get('title', ''):
                        errors.append('Turbo title misstates Fix route')
                except (KeyError, IndexError, StopIteration):
                    errors.append('Turbo Fix topology missing')
    for subgraph in subgraphs:
        has_speed = any(node['type'] == 'MyQi21SpeedSelect' for node in subgraph['nodes'])
        has_pe = any(node.get('title') == '[4012] PE启用?' for node in subgraph['nodes'])
        for host in document.get('nodes', []):
            if host['type'] != subgraph['id']:
                continue
            named = host.get('widgets_values_named', {})
            if has_speed and (host['widgets_values'][0] != TURBO or named.get('速度档位') != TURBO):
                errors.append('speed host positional/named default drift')
            if has_pe:
                control_names = list(named) if named else [slot['name'] for slot in host['inputs'] if 'widget' in slot]
                if 'PE启用?' not in control_names:
                    errors.append('PE host missing control mapping')
                    continue
                index = control_names.index('PE启用?')
                if host['widgets_values'][index] is not False or subgraph['widgets'][index] is not False or named.get('PE启用?', False) is not False:
                    errors.append('PE host/subgraph/named saved default drift')
            if any(node['type'] == 'MyQi21ApiPE' for node in subgraph['nodes']):
                if host.get('widgets_values') != [host.get('widgets_values_named', {}).get('型选择')]:
                    errors.append('t2i assembly host contains stale saved controls')
    return errors


def audit(root: Path = COMFY) -> dict:
    inventory = []
    failures = []
    for path in product_paths(root):
        document = read_json(path)
        observed_errors = audit_document(document) if 'graph' not in document else audit_api(document['graph'])
        in_scope = 'Q2-1图像' in path.parts or path.name.startswith('qi21-')
        errors = observed_errors if in_scope else []
        classes = [node.get('type', node.get('class_type')) for scope in [document, *(document.get('definitions') or {}).get('subgraphs', [])] for node in scope.get('nodes', [])]
        classes.extend(node['class_type'] for node in document.get('graph', {}).values())
        relevant = in_scope and (any(name in ('MyQi21ApiPE', 'MyQi21SpeedSelect') for name in classes) or path.name.startswith('qi21-提示词类型优化'))
        inventory.append({'path': str(path.relative_to(root)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'relevant': relevant, 'errors': errors, 'out_of_scope_observations': observed_errors if not in_scope else []})
        failures.extend(f"{path.name}: {error}" for error in errors)
    mirrors = []
    for line, path in canvas_paths(root).items():
        canvas = read_json(path)
        for subgraph in canvas['definitions']['subgraphs']:
            if not any(node['type'] == 'MyQi21SpeedSelect' for node in subgraph['nodes']):
                continue
            name = 'qi21-道劫-加速子图' + ('' if line == 't2i' else '-' + line) + '.json'
            blueprint = read_json(root / 'my_nodes/subgraphs' / name)
            normalize = lambda graph: {key: value for key, value in graph.items() if key not in ('id', 'category')}
            equal = normalize(subgraph) == normalize(blueprint['definitions']['subgraphs'][0])
            mirrors.append({'line': line, 'accel_canonical_equal': equal})
            if not equal:
                failures.append(f'{line}: accel blueprint/canvas drift')
    source = next((REPO / 'apps/frontend/assets/studio-manuals/art_skills').rglob('qi21_bases.json'))
    types = [item['zh'] for item in read_json(source)['types'] if item['zh'] != '自由']
    return {'ok': not failures, 'inventory': inventory, 'mirrors': mirrors, 'types': types,
            'types_source': str(source.relative_to(REPO)), 'types_source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'errors': failures}


def audit_api(graph: dict) -> list[str]:
    errors = []
    for node in graph.values():
        if node['class_type'] == 'MyQi21ApiPE' and node['inputs'].get('AI扩写开关') is not False:
            errors.append('App API missing explicit saved PE=False')
        if node['class_type'] == 'MyQi21SpeedSelect' and node['inputs'].get('mode') != TURBO:
            errors.append('App API speed is not Turbo')
    if any(node['class_type'] == 'MyQi21ApiPE' for node in graph.values()):
        if graph.get('7:7028', {}).get('inputs', {}).get('model') != ['7:7027', 0]:
            errors.append('App API Turbo Fix route missing')
        for key, filename, strength in (('7:7027', FIX_FILE, 0.5), ('7:7028', TURBO_FILE, 1.0)):
            inputs = graph.get(key, {}).get('inputs', {})
            if inputs.get('lora_name') != filename or inputs.get('strength_model') != strength:
                errors.append(f'App API {key} dependency/strength drift')
    return errors


def default_prompt(path: Path, schemas: dict) -> tuple[dict, dict]:
    import qwen21_bridge_template_build as builder
    workflow = read_json(path)
    failures = audit_document(workflow)
    if failures:
        raise ValueError(f'{path.name}: {failures}')
    graph = builder.flatten_canvas(workflow, schemas)
    builder.check_object_info(graph, schemas)
    if graph['7:7015']['inputs']['mode'] != TURBO or graph['7:7028']['inputs']['model'] != ['7:7027', 0]:
        raise ValueError('saved-default conversion did not retain Turbo+Fix')
    if any(node['class_type'] == 'TextGenerate' for node in graph.values()):
        raise ValueError('default PE model branch is reachable')
    return workflow, graph


def new_run(kind: str) -> Path:
    path = TASK / 'evidence' / kind / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    path.mkdir(parents=True, exist_ok=False)
    return path


def dry_run(root: Path, schemas: dict) -> Path:
    run = new_run('dry-run')
    rows = []
    for line, path in canvas_paths(root).items():
        _workflow, graph = default_prompt(path, schemas)
        (run / line).mkdir(parents=True, exist_ok=False)
        (run / line / 'workflow.json').write_bytes(path.read_bytes())
        write_json(run / line / 'prompt.json', graph)
        rows.append({'line': line, 'workflow_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     'nodes': len(graph), 'noise': graph['7:7031']['inputs']['noise'],
                     'sampler': graph['7:7031']['inputs']['sampler'], 'speed': graph['7:7015']['inputs']['mode']})
    write_json(run / 'summary.json', {'ok': True, 'posted': False, 'graphs': rows})
    return run


def judge_execution(graph: dict, history: dict, prompt_id: str, events: list[dict]) -> dict:
    entry = history.get(prompt_id, {})
    status = entry.get('status', {})
    executed = set()
    cached = set()
    own_events = [event for event in events if event.get('data', {}).get('prompt_id') == prompt_id]
    for event in own_events:
        data = event['data']
        if event.get('type') in ('executing', 'executed') and data.get('node') is not None:
            executed.add(str(data['node']))
        if event.get('type') == 'execution_cached':
            cached.update(str(key) for key in data.get('nodes', []))
    required = {'7:7027', '7:7028', '7:7031'}
    forbidden = {'7:7011', '7:7012', '7:7024'} | {key for key, node in graph.items() if node['class_type'] == 'TextGenerate'}
    errors = []
    if status.get('status_str') != 'success' or status.get('completed') is not True:
        errors.append('matching history is not completed success')
    if not required <= executed | cached or '7:7031' not in executed:
        errors.append(f'Turbo/Fix execution evidence missing: {sorted(required - (executed | cached))}; sampler must execute freshly')
    if forbidden & executed:
        errors.append(f'PE/viggle branch executed: {sorted(forbidden & executed)}')
    for key, node in graph.items():
        if node['class_type'] == 'MyQi21ApiPE':
            pe_status = entry.get('outputs', {}).get(key, {}).get('api_pe_status', [])
            if pe_status != ['关闭:直拼三层装配(未请求模型)']:
                errors.append(f'PE direct-branch receipt missing for {key}')
    return {'ok': not errors, 'errors': errors, 'executed': sorted(executed), 'cached': sorted(cached)}


def inspect_png(path: Path) -> dict:
    from PIL import Image, ImageStat
    with Image.open(path) as image:
        image.load()
        rgba = image.convert('RGBA')
        rgb = rgba.convert('RGB')
        alpha = rgba.getchannel('A')
        visible = sum(alpha.histogram()[6:])
        histogram = rgb.convert('L').histogram()
        nonblack = sum(histogram[6:]) / (image.width * image.height)
        variation = max(ImageStat.Stat(rgb).stddev)
        return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'size': list(image.size),
                'mode': image.mode, 'alpha_extrema': list(alpha.getextrema()),
                'visible_fraction': visible / (image.width * image.height), 'nonblack_fraction': nonblack,
                'variation': variation, 'ok': visible > 0 and nonblack > 0.01 and variation > 0.5,
                'visual_review': 'pending human inspection'}


def review_receipt(folder: Path) -> dict:
    folder = folder.resolve()
    if not folder.is_relative_to((TASK / 'evidence').resolve()):
        raise ValueError('receipt must be under this task evidence directory')
    graph = read_json(folder / 'prompt.json')
    prompt_id = read_json(folder / 'submission.json')['prompt_id']
    events = json.loads((folder / 'events.json').read_text(encoding='utf-8'))
    if not isinstance(events, list):
        raise TypeError('receipt events must be a JSON array')
    verdict = judge_execution(graph, read_json(folder / 'history.json'), prompt_id, events)
    manifest = json.loads((folder / 'images.json').read_text(encoding='utf-8'))
    images = []
    for item in manifest:
        path = (folder / item['path']).resolve()
        if not path.is_relative_to(folder):
            raise ValueError('image receipt escapes its evidence folder')
        metrics = inspect_png(path)
        returned = read_json(folder / 'history.json')[prompt_id].get('outputs', {}).get(item['node'], {}).get('images', [])
        if item['metadata'] not in returned or item['sha256'] != metrics['sha256']:
            verdict['errors'].append(f'image receipt identity/hash mismatch: {path.name}')
        images.append({'path': path.name, **metrics})
    verdict.update(images=images, prompt_id=prompt_id, visual_review='pending human inspection')
    verdict['ok'] = not verdict['errors'] and bool(images) and all(image['ok'] for image in images)
    write_json(folder / 'receipt-review.json', verdict)
    return verdict


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument('--audit', action='store_true')
    actions.add_argument('--dry-run', action='store_true')
    actions.add_argument('--receipt', type=Path, help='offline review of an existing receipt directory; never submits')
    parser.add_argument('--object-info', type=Path)
    parser.add_argument('--comfy-root', type=Path, default=COMFY)
    args = parser.parse_args()
    if args.receipt:
        verdict = review_receipt(args.receipt)
        print(json.dumps(verdict, ensure_ascii=False))
        raise SystemExit(0 if verdict['ok'] else 1)
    report = audit(args.comfy_root)
    write_json(TASK / 'evidence/defaults-audit.json', report)
    if not report['ok']:
        raise SystemExit(json.dumps(report['errors'], ensure_ascii=False))
    if args.audit:
        print(json.dumps({'ok': True, 'files': len(report['inventory']), 'types': report['types']}, ensure_ascii=False))
        return
    import qwen21_bridge_template_build as builder
    schemas = builder.object_info(args.object_info)
    if args.dry_run:
        print(dry_run(args.comfy_root, schemas))
        return


if __name__ == '__main__':
    main()
