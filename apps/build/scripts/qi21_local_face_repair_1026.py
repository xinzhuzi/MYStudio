#!/usr/bin/env python3
"""Guarded, idempotent repair of the existing QI21 local face canvas.

Offline only. Default checks a proposed repair; --apply writes only its repository
workflow. No installation, engine mutation, upload or generation is performed.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ORIGINAL_SHA256 = '18b1f2de6a4af41a856227c90e9586c13517a56a3705fa1d4dbe40cd13f9f396'
PATCHED_SHA256 = '4615ed3952cc1bb67e5360a7bac04c0bd6fc84cf1fe60a21217ee5db48f52585'
NAME = '自研件-qi21-道劫-换脸-局部重绘.json'
VAE_NAME = 'texture_fix_vae_for_qwen_image_2.1_bf16.safetensors'
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
from layout_check import check_workflow
from workflow_layout import est_size

POSITIONS = {
    1: [80, 80], 2: [80, 840], 3: [80, 4640],
    10: [80, 3880], 11: [80, 3120], 81: [80, 5400],
    80: [920, 80], 17: [920, 2360], 13: [920, 3120], 82: [920, 5400],
    18: [1760, 840], 31: [2600, 1600], 41: [2600, 2360],
    40: [3440, 1600], 50: [4280, 1600], 19: [5120, 1600],
    70: [5960, 3880], 60: [6800, 3880], 83: [80, 6160],
}


def widget(name, kind):
    return {'name': name, 'type': kind, 'link': None, 'widget': {'name': name}}


def added_node(node_id, kind, title, inputs, outputs, values):
    return {'id': node_id, 'type': kind, 'pos': POSITIONS[node_id],
            'size': [320, 120], 'flags': {}, 'order': 0, 'mode': 0,
            'inputs': inputs, 'outputs': outputs,
            'properties': {'Node name for S&R': kind},
            'widgets_values': values, 'title': title}


def repair_graph(original):
    graph = copy.deepcopy(original)
    nodes = {node['id']: node for node in graph['nodes']}
    assert len(nodes) == 16 and set(nodes) == {1, 2, 3, 10, 11, 17, 18, 13, 31, 41, 80, 40, 50, 19, 70, 60}
    assert nodes[3]['type'] == 'VAELoader'
    assert nodes[41]['type'] == 'EmptyLatentImage'
    assert nodes[17]['widgets_values'] == [224, 176, 512, 96]
    assert nodes[40]['widgets_values'] == [42, 'fixed', 20, 1, 'euler', 'simple', 1.0]

    vae = nodes[3]
    vae['type'] = 'VAELoaderKJ'
    vae['title'] = '[3] 参考与解码·CPU FP32 VAE'
    vae['inputs'] = [widget('vae_name', 'COMBO'), widget('device', 'COMBO'), widget('weight_dtype', 'COMBO')]
    vae['widgets_values'] = [VAE_NAME, 'cpu', 'fp32']
    vae['widgets_values_named'] = dict(zip(('vae_name', 'device', 'weight_dtype'), vae['widgets_values']))

    for slot in nodes[31]['inputs']:
        if slot['name'].startswith('images.'):
            slot['type'] = 'IMAGE'
            slot.pop('widget', None)
    nodes[31]['outputs'] = [
        {'name': 'positive', 'type': 'CONDITIONING', 'links': [8]},
        {'name': 'negative', 'type': 'CONDITIONING', 'links': [10]},
        {'name': 'latent', 'type': 'LATENT', 'links': []},
    ]
    for slot in nodes[40]['inputs']:
        if slot['name'] in ('positive', 'negative'):
            slot['type'] = 'CONDITIONING'
    for edge in graph['links']:
        if edge[0] in (8, 10):
            edge[5] = 'CONDITIONING'
    next(slot for slot in nodes[50]['inputs'] if slot['name'] == 'vae')['link'] = 17

    latent = nodes[41]
    latent.update(type='VAEEncode', title='[41] 脸块实图潜码·VAEEncode',
                  inputs=[{'name': 'pixels', 'type': 'IMAGE', 'link': 18},
                          {'name': 'vae', 'type': 'VAE', 'link': 19}], widgets_values=[])
    resize = nodes[19]
    resize['widgets_values'][6] = 1  # Exact 224x176, not silently truncated to 224x160.
    resize['title'] = '[19] 缩回裁片·精确尺寸'
    resize['widgets_values_named'] = dict(zip(
        ('width', 'height', 'upscale_method', 'keep_proportion', 'pad_color', 'crop_position', 'divisible_by', 'device'),
        resize['widgets_values']))
    composite = nodes[70]
    next(slot for slot in composite['inputs'] if slot['name'] == 'resize_to_batch').update(
        name='resize_source', widget={'name': 'resize_source'})
    composite['inputs'].append({'name': 'mask', 'type': 'MASK', 'link': 21})
    composite['title'] = '[70] 羽化贴回·保持裁片外原图'
    composite['widgets_values_named'] = dict(zip(('x', 'y', 'resize_source'), composite['widgets_values']))

    width, height, _, _ = nodes[17]['widgets_values']
    mask = added_node(81, 'SolidMask', '[81] 裁片遮罩·尺寸随裁片',
                      [widget('value', 'FLOAT'), widget('width', 'INT'), widget('height', 'INT')],
                      [{'name': 'MASK', 'type': 'MASK', 'links': [20]}], [1.0, width, height])
    feather = added_node(82, 'FeatherMask', '[82] 四边羽化·16像素',
                         [{'name': 'mask', 'type': 'MASK', 'link': 20},
                          *[widget(name, 'INT') for name in ('left', 'top', 'right', 'bottom')]],
                         [{'name': 'MASK', 'type': 'MASK', 'links': [21]}], [16, 16, 16, 16])
    note = added_node(83, 'MarkdownNote', '[83] 局部换脸·输入与验证边界', [], [], [
        '## 局部换脸：裁片编辑＋羽化合成\n\n'
        '1. [10] 选择身图；[11] 选择第二张脸参考（不透明图）。默认 example.png 只是占位，必须更换；'
        '两图都实际进入双图编码，接线存在不等于身份相似已验收。\n'
        '2. 当前裁片为 x=512、y=96、宽224、高176，属于特定样本坐标。更换身图后必须调整 '
        '[17] 的宽/高/x/y、[19] 的宽/高、[81] 的宽/高及 [70] 的 x/y，保持一致；'
        '[19] divisible_by=1 保留精确176高度。此流不自动检测人脸。\n'
        '3. [41] 从放大的实际裁片 VAEEncode 得到本模型潜码，不使用 SD 空潜码；'
        '默认仍为20步、CFG1、denoise1，属于裁片参考编辑，不是潜空间 mask 限定重绘。'
        '[81]→[82] 的16像素羽化 mask 只用于像素合成，裁片外保留原身图。\n'
        '4. [3] texture_fix VAE 固定 CPU＋FP32，同时服务参考编码、裁片编码与解码。'
        '本机已验证此路径可避开 MPS 灰棕失真；文件名 bf16 不等于运行 dtype。'
        '不将 UNet、TE 或采样迁移到 CPU。\n'
        '5. 第二张图提供五官来源；全链路须另以实际输出评估相似度、画风、色彩和接缝。'
        '契约通过只证明配置与连线，不能保证换脸成功或只适用于真人。'
    ])
    note['size'] = [640, 720]
    graph['nodes'].extend([mask, feather, note])
    graph['links'].extend([[17, 3, 0, 50, 1, 'VAE'], [18, 18, 0, 41, 0, 'IMAGE'],
                           [19, 3, 0, 41, 1, 'VAE'], [20, 81, 0, 82, 0, 'MASK'],
                           [21, 82, 0, 70, 5, 'MASK']])
    graph['last_node_id'] = 83
    graph['last_link_id'] = 21
    nodes = {node['id']: node for node in graph['nodes']}
    for node in nodes.values():
        if node.get('widgets_values') is None:
            node['widgets_values'] = []
        node['properties']['Node name for S&R'] = node['type']
        node['pos'] = POSITIONS[node['id']].copy()
        if node['type'] != 'MarkdownNote':
            node['size'] = [520 if node['id'] == 31 else 320, 0]
        node['size'] = est_size(node)
        for output in node.get('outputs', []):
            output['links'] = []
    for edge in graph['links']:
        nodes[edge[1]]['outputs'][edge[2]]['links'].append(edge[0])
    return graph


def validate(graph):
    nodes = {node['id']: node for node in graph['nodes']}
    links = {edge[0]: edge for edge in graph['links']}
    assert len(links) == len(graph['links'])
    for edge in links.values():
        source = nodes[edge[1]]['outputs'][edge[2]]
        target = nodes[edge[3]]['inputs'][edge[4]]
        assert target['link'] == edge[0]
        assert edge[0] in source['links']
        assert source['type'] == target['type'] == edge[5]
    for node in nodes.values():
        for index, slot in enumerate(node.get('inputs', [])):
            if slot.get('link') is not None:
                assert links[slot['link']][3:5] == [node['id'], index]
    counts = check_workflow(graph)[0]['counts']
    assert counts['crossings'] <= 15, counts
    assert all(value == 0 for key, value in counts.items() if key != 'crossings'), counts
    return counts


def patched_bytes(raw):
    digest = hashlib.sha256(raw).hexdigest()
    if digest == PATCHED_SHA256:
        validate(json.loads(raw))
        return raw
    if digest != ORIGINAL_SHA256:
        raise ValueError(f'Unexpected source SHA256 {digest}; refusing to overwrite concurrent work')
    graph = repair_graph(json.loads(raw))
    validate(graph)
    result = (json.dumps(graph, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if PATCHED_SHA256 and hashlib.sha256(result).hexdigest() != PATCHED_SHA256:
        raise ValueError('repair result drifted from the verified patch')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='write the guarded repository workflow only')
    args = parser.parse_args()
    path = next((ROOT / 'apps/backend/comfyui/workflows').rglob(NAME))
    before = path.read_bytes()
    after = patched_bytes(before)
    if args.apply and after != before:
        if not PATCHED_SHA256:
            raise ValueError('verified patched SHA256 is required before writing')
        if path.read_bytes() != before:
            raise ValueError('source changed while checking; refusing to overwrite')
        path.write_bytes(after)
    print(json.dumps({'path': str(path), 'applied': args.apply, 'changed': after != before,
                      'source_sha256': hashlib.sha256(before).hexdigest(),
                      'result_sha256': hashlib.sha256(after).hexdigest(),
                      'layout': validate(json.loads(after))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
