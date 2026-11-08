#!/usr/bin/env python3
"""Guarded face alpha/mask repair. Default is offline read-only; --apply changes
only the bound repository workflow. No installation, engine restart or generation.
Predecessor: qi21_local_face_repair_1026.py; do not rerun it on this later graph.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[3]
NAME = '自研件-qi21-道劫-换脸-局部重绘.json'
ORIGINAL_SHA256 = '4615ed3952cc1bb67e5360a7bac04c0bd6fc84cf1fe60a21217ee5db48f52585'
PATCHED_SHA256 = '3df6f3d8c4b7cab06a5523014170a48680fc94713b668982ea16a2d69aad3d49'
SCHEMAS = json.loads((ROOT / 'apps/backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json').read_text())
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
from layout_check import check_workflow
from workflow_layout import est_size

POSITIONS = {2: [2600, 80], 3: [3440, 5400], 83: [80, 10720], 81: [80, 5400], 82: [920, 5400], 13: [3440, 4640], 31: [4280, 1600], 41: [4280, 2360],
             40: [5960, 1600], 50: [6800, 1600], 19: [7640, 1600],
             70: [8480, 3880], 60: [9320, 3880], 84: [5120, 3120],
             85: [1760, 7680], 86: [920, 6920], 87: [2600, 6160], 88: [920, 9200]}


def make_node(node_id, kind, title, values):
    schema = SCHEMAS[kind]
    specs = {k: v for group in ('required', 'optional')
             for k, v in schema['input'].get(group, {}).items()}
    inputs, widgets, named = [], [], {}
    for key, value in values.items():
        typ = specs[key][0]
        is_link = isinstance(value, tuple)
        inputs.append({'name': key, 'type': 'COMBO' if isinstance(typ, list) else typ,
                       'link': None, **({} if is_link else {'widget': {'name': key}})})
        if not is_link:
            widgets.append(value)
            named[key] = value
        elif typ in ('INT', 'FLOAT', 'BOOLEAN', 'STRING'):
            placeholder = specs[key][1]['default']
            widgets.append(placeholder)
            named[key] = placeholder
    node = {'id': node_id, 'type': kind, 'pos': POSITIONS.get(node_id, [80, 5400]),
            'size': [320, 0], 'flags': {}, 'order': 0, 'mode': 0,
            'inputs': inputs, 'outputs': [
                {'name': name, 'type': typ, 'links': []}
                for name, typ in zip(schema.get('output_name', schema['output']), schema['output'])],
            'properties': {'Node name for S&R': kind}, 'title': title,
            'widgets_values': widgets, 'widgets_values_named': named}
    node['size'] = est_size(node)
    return node


def repair_graph(original):
    graph = copy.deepcopy(original)
    n = {x['id']: x for x in graph['nodes']}
    assert n[81]['type'] == 'SolidMask' and n[82]['type'] == 'FeatherMask'
    assert n[17]['widgets_values'] == [224, 176, 512, 96]
    assert n[40]['widgets_values'] == [42, 'fixed', 20, 1, 'euler', 'simple', 1.0]
    replacements = {
        81: make_node(81, 'CreateShapeMask', '[81] Face interior ellipse (sample coordinates)',
            dict(shape='circle', frames=1, location_x=114, location_y=80, grow=0,
                 frame_width=224, frame_height=176, shape_width=66, shape_height=80)),
        82: make_node(82, 'GrowMaskWithBlur', '[82] Feather shape boundary',
            dict(mask=(81, 0), expand=0, incremental_expandrate=0.0,
                 tapered_corners=True, flip_input=False, blur_radius=2.0,
                 lerp_alpha=1.0, decay_factor=1.0, fill_holes=False)),
        84: make_node(84, 'SetLatentNoiseMask', '[84] Noise only inside face',
            dict(samples=(41, 0), mask=(82, 0))),
        85: make_node(85, 'EmptyImage', '[85] Reference matte (white)',
            dict(width=(88, 0), height=(88, 1), batch_size=1, color=16777215)),
        86: make_node(86, 'InvertMask', '[86] Reference opacity = 1 - LoadImage mask',
            dict(mask=(11, 1))),
        88: make_node(88, 'GetImageSize', '[88] Reference dimensions', dict(image=(11, 0))),
        87: make_node(87, 'ImageCompositeMasked', '[87] Composite reference alpha before encode',
            dict(destination=(85, 0), source=(11, 0), x=0, y=0,
                 resize_source=False, mask=(86, 0))),
    }
    graph['nodes'] = [replacements.pop(x['id'], x) for x in graph['nodes']]
    graph['nodes'].extend(replacements.values())
    n = {x['id']: x for x in graph['nodes']}
    assert n[11]['type'] == 'LoadImage' and len(n[11]['outputs']) == 1
    n[11]['outputs'].append({'name': 'MASK', 'type': 'MASK', 'links': []})
    links = {e[0]: e for e in graph['links']}
    # Preserve existing link ids while replacing their exact source or destination.
    edge = next(e for e in links.values() if e[3] == 13 and e[4] == 0)
    edge[1:3] = [87, 0]
    edge = next(e for e in links.values() if e[3] == 40 and e[5] == 'LATENT')
    edge[1:3] = [84, 0]
    edge = next(e for e in links.values() if e[3] == 82)
    edge[4] = 0
    next_id = max(links) + 1
    for target, inputs in [(84, {'samples': (41, 0), 'mask': (82, 0)}),
                           (86, {'mask': (11, 1)}),
                           (88, {'image': (11, 0)}),
                           (85, {'width': (88, 0), 'height': (88, 1)}),
                           (87, {'destination': (85, 0), 'source': (11, 0), 'mask': (86, 0)})]:
        for key, (source, slot) in inputs.items():
            index = next(i for i, v in enumerate(n[target]['inputs']) if v['name'] == key)
            typ = n[target]['inputs'][index]['type']
            links[next_id] = [next_id, source, slot, target, index, typ]
            next_id += 1
    graph['links'] = list(links.values())
    for node in n.values():
        for out in node.get('outputs', []):
            out['links'] = []
        for inp in node.get('inputs', []):
            inp['link'] = None
        if node['id'] in POSITIONS:
            node['pos'] = POSITIONS[node['id']]
    for e in graph['links']:
        src, dst = n[e[1]]['outputs'][e[2]], n[e[3]]['inputs'][e[4]]
        assert src['type'] == dst['type'] == e[5], e
        src['links'].append(e[0]); dst['link'] = e[0]
    n[83]['widgets_values'][0] = (
        '## 局部换脸：脸部遮罩＋透明参考处理\n\n'
        '1. [10] 选择身图，[11] 选择第二张脸参考；example.png 是占位，必须更换。'
        '参考 PNG 的透明背景由 [86] 反转 LoadImage mask 得到不透明度，'
        '[88] 读取实际尺寸，[85]→[87] 先合成白底再进编码，避免透明区黑 RGB 污染。\n'
        '2. 当前裁片坐标 x=512、y=96、宽224、高176，属于1254方图样本。'
        '更换身图后须联动 [17]/[19]/[70] 裁片尺寸与位置；'
        '[81] 椭圆中心(114,80)、宽66高80仅覆盖本样本脸内，必须随脸调整并预览，'
        '不自动定位人脸；[19] divisible_by=1 保留精确尺寸。\n'
        '3. [41] 实际裁片 VAEEncode→[84] SetLatentNoiseMask→[40]，'
        '[81]→[82] 的2px形状羽化同时用于潜空间噪声约束和 [70] 像素合成，'
        '避免整块矩形覆盖头发与背景。采样保持20步/CFG1/denoise1/seed42。\n'
        '4. [3] texture_fix VAE 固定 CPU＋FP32，参考、裁片编码与解码共用；'
        '文件名bf16不是运行dtype，UNet/TE/采样不迁CPU。\n'
        '5. 第二张参考已在真实插画试验中迁入五官；黑框与光头覆盖在遮罩版消失。'
        '面部仍可能偏平涂，必须分别验相似度、画风、肤色和边界；'
        '执行成功不等于终稿艺术质量通过，不能据此判仅支持真人。'
    )
    for node in graph['nodes']:
        node['size'] = est_size(node)
    graph['last_node_id'] = 88
    graph['last_link_id'] = max(links)
    return graph


def validate(graph):
    nodes = {n['id']: n for n in graph['nodes']}
    links = {e[0]: e for e in graph['links']}
    assert len(links) == len(graph['links'])
    for e in links.values():
        source, target = nodes[e[1]]['outputs'][e[2]], nodes[e[3]]['inputs'][e[4]]
        assert source['type'] == target['type'] == e[5]
        assert target['link'] == e[0] and e[0] in source['links']
        assert 'widget' not in target
    counts = check_workflow(graph)[0]['counts']
    assert counts['crossings'] <= 29, counts
    assert all(v == 0 for k, v in counts.items() if k != 'crossings'), counts
    return counts


def patched_bytes(raw):
    digest = hashlib.sha256(raw).hexdigest()
    if PATCHED_SHA256 and digest == PATCHED_SHA256:
        validate(json.loads(raw)); return raw
    if digest in ('6ae18482d1ac0d16283ecc3614d0ec3dfa64bee1175be8fd5baea2c6c0fff3c0',
                  '2e984f83f54fbc9a61ac0287fbeb8bdc88a758aa6492738a0de3be7041c86ea8'):
        graph = json.loads(raw)
        matte = next(n for n in graph['nodes'] if n['id'] == 85)
        matte['widgets_values'] = [512, 512, 1, 16777215]
        matte['widgets_values_named'] = dict(zip(('width', 'height', 'batch_size', 'color'), matte['widgets_values']))
        for node in graph['nodes']:
            node['size'] = est_size(node)
        validate(graph)
        return (json.dumps(graph, ensure_ascii=False, indent=2) + '\n').encode()
    if digest != ORIGINAL_SHA256:
        raise ValueError('unexpected source SHA; refusing concurrent changes: ' + digest)
    graph = repair_graph(json.loads(raw))
    validate(graph)
    result = (json.dumps(graph, ensure_ascii=False, indent=2) + '\n').encode()
    if PATCHED_SHA256 and hashlib.sha256(result).hexdigest() != PATCHED_SHA256:
        raise ValueError('repair output drift')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    matches = list((ROOT / 'apps/backend/comfyui/workflows').rglob(NAME))
    assert len(matches) == 1
    path = matches[0]; before = path.read_bytes(); after = patched_bytes(before)
    if args.apply and before != after:
        if not PATCHED_SHA256:
            raise ValueError('reviewed output SHA is required')
        if path.read_bytes() != before:
            raise ValueError('concurrent source drift')
        backup = ROOT / f'apps/output/ai-workspace/ai/qi21-local-face-before-mask-{hashlib.sha256(before).hexdigest()[:12]}.json'
        with backup.open('xb') as stream: stream.write(before)
        path.write_bytes(after)
    print(json.dumps({'changed': before != after, 'applied': args.apply,
          'sha256': hashlib.sha256(after).hexdigest(), 'layout': validate(json.loads(after))}))


if __name__ == '__main__': main()
