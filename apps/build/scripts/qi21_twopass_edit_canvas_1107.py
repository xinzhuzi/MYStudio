#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1107 二采精修·Edit 模式·画布手术 v2:子图形(替代 v1 平铺,0929 S3 纪律+用户原令)。

v1 教训:root 平铺 KSampler 违反「主图应零 KSampler」纪律与「二采单独做个子图」
用户原令。v2 改为独立子图「道劫·二采精修子图」,与洗底/加速同范式。

改动(全部幂等,DRY_RUN=1 只报不写):
A. 卸 v1 平铺残留(若在):8100-8107 根节点/7901-7914 链,恢复 7468 与计数器
B. 装配子图[6] 新增出口「透明模式」(BOOLEAN ← inner 4013 ApiPE.出2,链 348);
   inner 4013.outputs[2].links 登记 348(v1 漏登记,契约测试抓过)
C. 画布 definitions 新增「道劫·二采精修子图」:
   入槽 image/clip/vae/model/透明模式 → 出槽 image
   内件 8100 修图指令 / 8101 透明包裹 / 8102 Edit编码(resolution=0 同尺寸)
       8107 模型缓存(裸底模) / 8103 KSampler 40步 cfg1 dn1.0 / 8104 VAEDecode
   内链 8201-8214(-10 边界进 / -20 边界出)
D. 根图:宿主 [8100] 落位(5880,1500);洗底 [7500] 挪 (6300,1980);
   SaveImage [8] 挪 (6620,2400)(全右向流,塔检测合规);根链 7920-7925;
   [7500].image 改吃宿主出(原 7468=[5]直连)
E. 蓝图双同步:
   - qi21-提示词类型优化子图.json(装配蓝图):同 B 三处 delta(与画布 def
     除子图 id 外 canonical 全等,脚本内自检)
   - qi21-道劫-二采精修子图.json(二采蓝图):整体重写为 Edit 形(旧 latent 放大形废止)

1107 实弹配方:cfg=1 官方 Edit 语义,同尺寸(resolution=0, latent 随 image_1),
150s@人物海报,修手成功(用户目检+视觉子代理双验;用户裁定:二采=同尺寸只修图)。
"""
from __future__ import annotations

import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
WF = os.path.join(REPO, 'apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/自研件-qi21-道劫-t2i.json')
BP_ASM = os.path.join(REPO, 'apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json')
BP_2PASS = os.path.join(REPO, 'apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-二采精修子图.json')

FIX_INSTRUCTION = (
    '保持<image1>的整体画面不变:人物五官、发型、服饰、姿态、构图、色彩与背景均保持原样。'
    '修复画面中的结构缺陷:人物手部每只手五指完整、逐指分明、解剖结构正确;'
    '兵器与物件结构连贯完整、比例合理。'
    '只做上述局部修复,不作重新构图或整体重绘。'
)

SUB6_NAME = '[6] 文本提示词类型优化子图'
SUB6_OUT_ID = 'b2f3a4c5-0007-4b07-8f07-3c5f81b56b07'
SUB6_LINK = 348
NEW_SG = 'a1e5c9d2-1107-4f21-9c3b-2e7d8f5a4b6c'  # 二采精修子图 uuid(恒定)

FLAT_V1 = (8100, 8101, 8102, 8103, 8104, 8107)
V1_LINKS = set(range(7901, 7915))
OLD_WASH = 7468
ROOT_L = {'image': 7920, 'clip': 7921, 'vae': 7922, 'model': 7923,
          'rgba': 7924, 'to_wash': 7925}


def ue() -> dict:
    return {'widget_ue_connectable': {}, 'version': '7.8', 'input_ue_unconnectable': {}}


def inner_nodes() -> list[dict]:
    def n(nid, ctype, title, pos, size, inputs, outputs, widgets=None, named=None):
        d = {'id': nid, 'type': ctype, 'pos': pos, 'size': size, 'flags': {},
             'order': nid - 8100, 'mode': 0, 'inputs': inputs, 'outputs': outputs,
             'title': title, 'properties': {'Node name for S&R': ctype,
                                            'ue_properties': ue()}}
        if widgets is not None:
            d['widgets_values'] = widgets
        if named is not None:
            d['widgets_values_named'] = named
        return d

    return [
        n(8100, 'PrimitiveStringMultiline', '[8100] 修图指令(同尺寸只修图)',
          [120, 80], [400, 170], [],
          [{'name': 'STRING', 'type': 'STRING', 'links': [8204], 'slot_index': 0}],
          widgets=[FIX_INSTRUCTION], named={'value': FIX_INSTRUCTION}),
        n(8101, 'MyQi21FinalOutput', '[8101] 透明包裹',
          [580, 80], [360, 130],
          [{'name': '正向提示词', 'type': 'STRING', 'shape': 7, 'link': 8204},
           {'name': '负向提示词', 'type': 'STRING', 'shape': 7, 'link': None},
           {'name': '透明模式', 'type': 'BOOLEAN', 'shape': 7, 'link': 8205}],
          [{'name': '进编码正向文本', 'type': 'STRING', 'slot_index': 0, 'links': [8206]},
           {'name': '进编码负向文本', 'type': 'STRING', 'slot_index': 1, 'links': []}],
          widgets=['', '', False],
          named={'正向提示词': '', '负向提示词': '', '透明模式': False}),
        n(8102, 'MyQi21FastEncode', '[8102] Edit编码(resolution=0 同尺寸)',
          [1000, 60], [420, 320],
          [{'name': 'clip', 'type': 'CLIP', 'link': 8201},
           {'name': 'images.image_1', 'shape': 7, 'type': 'IMAGE', 'link': 8203},
           {'name': 'vae', 'shape': 7, 'type': 'VAE', 'link': 8202},
           {'name': 'prompt', 'type': 'STRING', 'widget': {'name': 'prompt'}, 'link': 8206}],
          [{'name': 'positive', 'type': 'CONDITIONING', 'links': [8209]},
           {'name': 'negative', 'type': 'CONDITIONING', 'links': [8210]},
           {'name': 'latent', 'type': 'LATENT', 'links': [8211]}],
          widgets=['', '', 0], named={'prompt': '', 'negative_prompt': '', 'resolution': 0}),
        n(8107, 'QwenImage21Cache', '[8107] 模型缓存(裸底模)',
          [120, 380], [340, 110],
          [{'name': 'model', 'type': 'MODEL', 'link': 8207}],
          [{'name': 'MODEL', 'type': 'MODEL', 'links': [8208]}],
          widgets=['auto', 'default'], named={'device': 'auto', 'dtype': 'default'}),
        n(8103, 'KSampler', '[8103] Edit采样·40步 cfg1',
          [1480, 120], [330, 260],
          [{'name': 'model', 'type': 'MODEL', 'link': 8208},
           {'name': 'positive', 'type': 'CONDITIONING', 'link': 8209},
           {'name': 'negative', 'type': 'CONDITIONING', 'link': 8210},
           {'name': 'latent_image', 'type': 'LATENT', 'link': 8211}],
          [{'name': 'LATENT', 'type': 'LATENT', 'links': [8212]}],
          widgets=[11061400, 'fixed', 40, 1.0, 'euler', 'simple', 1.0]),
        n(8104, 'VAEDecode', '[8104] VAEDecode',
          [1900, 160], [210, 50],
          [{'name': 'samples', 'type': 'LATENT', 'link': 8212},
           {'name': 'vae', 'type': 'VAE', 'link': 8213}],
          [{'name': 'IMAGE', 'type': 'IMAGE', 'links': [8215], 'slot_index': 0}]),
        n(8105, 'MyQi21ColorAnchor', '[8105] 色彩锚(Lab 一采色权威)',
          [2180, 200], [360, 150],
          [{'name': 'image', 'type': 'IMAGE', 'link': 8215},
           {'name': 'reference', 'type': 'IMAGE', 'link': 8216}],
          [{'name': 'IMAGE', 'type': 'IMAGE', 'links': [8214], 'slot_index': 0}],
          widgets=[0.15], named={'chroma_keep': 0.15}),
    ]


def sub_links() -> list[dict]:
    L = lambda i, o, os_, t, ts, ty: {'id': i, 'origin_id': o, 'origin_slot': os_,
                                      'target_id': t, 'target_slot': ts, 'type': ty}
    return [
        L(8201, -10, 1, 8102, 0, 'CLIP'),
        L(8202, -10, 2, 8102, 2, 'VAE'),
        L(8203, -10, 0, 8102, 1, 'IMAGE'),
        L(8204, 8100, 0, 8101, 0, 'STRING'),
        L(8205, -10, 4, 8101, 2, 'BOOLEAN'),
        L(8206, 8101, 0, 8102, 3, 'STRING'),
        L(8207, -10, 3, 8107, 0, 'MODEL'),
        L(8208, 8107, 0, 8103, 0, 'MODEL'),
        L(8209, 8102, 0, 8103, 1, 'CONDITIONING'),
        L(8210, 8102, 1, 8103, 2, 'CONDITIONING'),
        L(8211, 8102, 2, 8103, 3, 'LATENT'),
        L(8212, 8103, 0, 8104, 0, 'LATENT'),
        L(8213, -10, 2, 8104, 1, 'VAE'),
        L(8215, 8104, 0, 8105, 0, 'IMAGE'),
        L(8216, -10, 0, 8105, 1, 'IMAGE'),
        L(8214, 8105, 0, -20, 0, 'IMAGE'),
    ]


def new_subgraph_def() -> dict:
    return {
        'category': '漫影', 'widgets': [],
        'extra': {'ue_links': [], 'links_added_by_ue': []},
        'config': {'defaultIOState': {}},
        'state': {'lastGroupId': 0, 'lastNodeId': 8107, 'lastLinkId': 8216,
                  'lastRerouteId': 0},
        'version': 1, 'revision': 1,
        'id': NEW_SG, 'name': '道劫·二采精修子图',
        'inputNode': {'id': -10, 'bounding': [60, 60, 128, 128]},
        'outputNode': {'id': -20, 'bounding': [1720, 420, 128, 68]},
        'inputs': [
            {'id': f'{NEW_SG}-0001', 'name': 'image', 'type': 'IMAGE',
             'linkIds': [8203], 'pos': [84, 84]},
            {'id': f'{NEW_SG}-0002', 'name': 'clip', 'type': 'CLIP',
             'linkIds': [8201], 'pos': [84, 104]},
            {'id': f'{NEW_SG}-0003', 'name': 'vae', 'type': 'VAE',
             'linkIds': [8202, 8213], 'pos': [84, 124]},
            {'id': f'{NEW_SG}-0004', 'name': 'model', 'type': 'MODEL',
             'linkIds': [8207], 'pos': [84, 144]},
            {'id': f'{NEW_SG}-0005', 'name': '透明模式', 'type': 'BOOLEAN',
             'linkIds': [8205], 'pos': [84, 164]},
        ],
        'outputs': [
            {'id': f'{NEW_SG}-1001', 'name': 'image', 'type': 'IMAGE',
             'linkIds': [8214], 'pos': [1744, 444]},
        ],
        'groups': [],
        'nodes': inner_nodes(),
        'links': sub_links(),
    }


def host_node() -> dict:
    return {'id': 8100, 'type': NEW_SG, 'pos': [5880, 1500], 'size': [340, 260],
            'flags': {}, 'order': 46, 'mode': 0,
            'inputs': [
                {'name': 'image', 'type': 'IMAGE', 'link': ROOT_L['image']},
                {'name': 'clip', 'type': 'CLIP', 'link': ROOT_L['clip']},
                {'name': 'vae', 'type': 'VAE', 'link': ROOT_L['vae']},
                {'name': 'model', 'type': 'MODEL', 'link': ROOT_L['model']},
                {'name': '透明模式', 'type': 'BOOLEAN', 'link': ROOT_L['rgba']},
            ],
            'outputs': [{'name': 'image', 'type': 'IMAGE', 'slot_index': 0,
                         'links': [ROOT_L['to_wash']]}],
            'title': '[8100] 二采·Edit修图(同尺寸)',
            'properties': {'subgraph': NEW_SG, 'previewExposures': [],
                           'ue_properties': ue()}}


def apply_sub6_delta(sub6: dict, host6_out_links: int) -> None:
    """装配子图 def:透明模式出口三处 delta(逐处幂等——v1 曾半途落盘,补齐)。"""
    if not any(o['name'] == '透明模式' for o in sub6['outputs']):
        sub6['outputs'].append({'id': SUB6_OUT_ID, 'name': '透明模式', 'type': 'BOOLEAN',
                                'linkIds': [SUB6_LINK], 'pos': [2900, 385]})
    if not any(l.get('id') == SUB6_LINK for l in sub6['links']):
        sub6['links'].append({'id': SUB6_LINK, 'origin_id': 4013, 'origin_slot': 2,
                              'target_id': -20, 'target_slot': 5, 'type': 'BOOLEAN'})
    inner4013 = next(n for n in sub6['nodes'] if n['id'] == 4013)
    outs = inner4013['outputs'][2]
    assert outs['name'] == '透明模式', 'inner 4013 出2 应为透明模式'
    if SUB6_LINK not in (outs.get('links') or []):
        outs.setdefault('links', []).append(SUB6_LINK)
    if 'state' in sub6 and isinstance(sub6['state'], dict):
        sub6['state']['lastLinkId'] = max(sub6['state'].get('lastLinkId', 0), SUB6_LINK)


def canon_no_id(sg: dict) -> str:
    return json.dumps({k: v for k, v in sg.items() if k != 'id'},
                      ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def main() -> int:
    dry = os.environ.get('DRY_RUN') == '1'
    doc = json.load(open(WF, encoding='utf-8'))
    nodes = {n['id']: n for n in doc['nodes']}

    # A. 卸 v1 平铺残留
    flat_present = any(i in nodes and nodes[i].get('type') != NEW_SG for i in FLAT_V1)
    if flat_present:
        doc['nodes'] = [n for n in doc['nodes']
                        if not (n['id'] in FLAT_V1 and n.get('type') != NEW_SG)]
        doc['links'] = [l for l in doc['links'] if l[0] not in V1_LINKS]
        doc['links'].append([OLD_WASH, 5, 0, 7500, 0, 'IMAGE'])
        nodes = {n['id']: n for n in doc['nodes']}
        nodes[5]['outputs'][0]['links'] = [OLD_WASH]
        nodes[7500]['inputs'][0]['link'] = OLD_WASH
        for nid, lid in ((1, 7907), (2, 7904), (3, 7905), (3, 7913)):
            ol = nodes[nid]['outputs'][0]['links']
            if lid in ol:
                ol.remove(lid)
        doc['last_link_id'] = 7900
        doc['last_node_id'] = 7510
        if isinstance(doc.get('state'), dict):
            doc['state']['lastLinkId'] = 7900
            doc['state']['lastNodeId'] = 7510
        print('[卸v1] 平铺 8100-8107 + 链 7901-7914 已撤,7468 复位')

    # 幂等:v3 宿主+色彩锚都在场?(v2 形无 8105 会先落 A2 段再进此闸)
    _sg2 = next((sg for sg in doc['definitions']['subgraphs']
                 if sg.get('name') == '道劫·二采精修子图'), None)
    _has_8105 = _sg2 is not None and any(n['id'] == 8105 for n in _sg2['nodes'])
    if any(n.get('type') == NEW_SG for n in doc['nodes']) and _has_8105:
        ok = nodes[7500]['inputs'][0]['link'] == ROOT_L['to_wash']
        print(f'[幂等] 二采宿主+色彩锚已在场,洗底入口已接: {ok}')
        return 0

    # A2. v3 幂等:已有 v2 形二采子图(8104 直出 -20)→ 插 8105 色彩锚
    sg2p = next((s for s in doc['definitions']['subgraphs']
                 if s.get('name') == '道劫·二采精修子图'), None)
    if sg2p is not None and not any(n['id'] == 8105 for n in sg2p['nodes']):
        n8105 = next(n for n in new_subgraph_def()['nodes'] if n['id'] == 8105)
        sg2p['nodes'].append(n8105)
        for lk in sub_links():
            if lk['id'] in (8215, 8216):
                sg2p['links'].append(lk)
        for lk in sg2p['links']:
            if lk['id'] == 8214:
                lk['origin_id'] = 8105
        n8104 = next(n for n in sg2p['nodes'] if n['id'] == 8104)
        n8104['outputs'][0]['links'] = [8215]
        for io in sg2p.get('inputs', []):
            if io['name'] == 'image':
                io['linkIds'] = sorted(set(io.get('linkIds', [])) | {8216})
        sg2p['outputs'][0]['pos'] = [2400, 240]
        sg2p.setdefault('state', {})['lastLinkId'] = 8216
        doc['last_link_id'] = max(doc.get('last_link_id', 0), 8216)
        if isinstance(doc.get('state'), dict):
            doc['state']['lastLinkId'] = max(doc['state'].get('lastLinkId', 0), 8216)
        print('[v3] 二采子图插 8105 色彩锚(8104→8105→出;reference=边界image)')

    # B. 装配子图透明模式出口
    sub6 = next(s for s in doc['definitions']['subgraphs'] if s.get('name') == SUB6_NAME)
    apply_sub6_delta(sub6, ROOT_L['rgba'])
    host6 = nodes[6]
    if any(o.get('name') == '透明模式' for o in host6['outputs']):
        for o in host6['outputs']:
            if o.get('name') == '透明模式':
                o['links'] = [ROOT_L['rgba']]
    else:
        host6['outputs'].append({'name': '透明模式', 'type': 'BOOLEAN',
                                 'links': [ROOT_L['rgba']], 'slot_index': 5})
    print('[子图] [6] 新出口 透明模式 ← inner 4013.出2(链348,含登记)')

    # C/D. 仅全新画布走(fresh);v3 在场升级只补 8105
    fresh = not any(s.get('id') == NEW_SG for s in doc['definitions']['subgraphs'])
    if fresh:
        doc['definitions']['subgraphs'].append(new_subgraph_def())
        print('[子图] 新增 道劫·二采精修子图(7内件+16内链,入5槽/出1槽)')

    # D. 宿主+挪位+根链
    if not fresh:
        print('[升级] v2→v3 完成,宿主/根链零改(仅子图内插 8105)')
    doc['nodes'].append(host_node()) if fresh else None
    if fresh:
        nodes[7500]['pos'] = [6300, 1980]
        nodes[8]['pos'] = [6620, 2400]
        doc['links'] = [l for l in doc['links'] if l[0] != OLD_WASH]
    if fresh:
        doc['links'].extend([
        [ROOT_L['image'], 5, 0, 8100, 0, 'IMAGE'],
        [ROOT_L['clip'], 2, 0, 8100, 1, 'CLIP'],
        [ROOT_L['vae'], 3, 0, 8100, 2, 'VAE'],
        [ROOT_L['model'], 1, 0, 8100, 3, 'MODEL'],
        [ROOT_L['rgba'], 6, 5, 8100, 4, 'BOOLEAN'],
        [ROOT_L['to_wash'], 8100, 0, 7500, 0, 'IMAGE'],
    ])
    if fresh:
        nodes[5]['outputs'][0]['links'] = [ROOT_L['image']]
        nodes[1]['outputs'][0]['links'].append(ROOT_L['model'])
        nodes[2]['outputs'][0]['links'].append(ROOT_L['clip'])
        nodes[3]['outputs'][0]['links'].append(ROOT_L['vae'])
        nodes[7500]['inputs'][0]['link'] = ROOT_L['to_wash']
        doc['last_link_id'] = max(ROOT_L['to_wash'], 8216)
        doc['last_node_id'] = 8107
        if isinstance(doc.get('state'), dict):
            doc['state']['lastLinkId'] = max(ROOT_L['to_wash'], 8216)
            doc['state']['lastNodeId'] = 8107
        print('[根图] 宿主[8100]@(5880,1500);7500→(6300,1980);8→(6620,2400);'
              '链 7920-7925;[7500].image←宿主出')
    else:
        doc['last_link_id'] = max(doc.get('last_link_id', 0), 8216)
        if isinstance(doc.get('state'), dict):
            doc['state']['lastLinkId'] = max(doc['state'].get('lastLinkId', 0), 8216)

    # E1. 装配蓝图同步 + 自检(canonical 除 id 全等)
    bp = json.load(open(BP_ASM, encoding='utf-8'))
    bp_sg = bp['definitions']['subgraphs'][0]
    assert bp_sg['name'] == SUB6_NAME
    apply_sub6_delta(bp_sg, ROOT_L['rgba'])

    def _canon(sg):
        return canon_no_id(sg)
    wf_sg = next(s for s in doc['definitions']['subgraphs'] if s.get('name') == SUB6_NAME)
    assert _canon(wf_sg) == _canon(bp_sg), '装配蓝图与画布 def canonical 不等!'
    print('[蓝图] 装配蓝图同步+canonical 自检通过')

    if dry:
        print('[DRY_RUN] 未写盘')
        return 0
    for path, payload in ((WF, doc), (BP_ASM, bp)):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'[写盘] {os.path.relpath(path, REPO)}')

    # E2. 二采蓝图整体重写(v3 在场态优先,独立文件结构镜像旧件)
    live = next((sg for sg in doc['definitions']['subgraphs']
                 if sg.get('name') == '道劫·二采精修子图'), None)
    sg_def = json.loads(json.dumps(live if live is not None else new_subgraph_def()))
    bp2 = {
        'revision': 1, 'last_node_id': 8107, 'last_link_id': 8214, 'version': 0.4,
        'info': {'name': '二采精修子图'},
        'nodes': [{'id': 1, 'type': NEW_SG, 'pos': [0, 0], 'size': [520, 420],
                   'flags': {}, 'order': 0, 'mode': 0,
                   'properties': {'subgraph': NEW_SG},
                   'inputs': [{'name': k['name'], 'type': k['type'], 'link': None}
                              for k in sg_def['inputs']],
                   'outputs': [{'name': 'image', 'type': 'IMAGE',
                                'slot_index': 0, 'links': None}]}],
        'definitions': {'subgraphs': [sg_def]},
    }
    with open(BP_2PASS, 'w', encoding='utf-8') as f:
        json.dump(bp2, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'[写盘] {os.path.relpath(BP_2PASS, REPO)}(Edit 形重写)')
    print('[下一步] python3 apps/build/scripts/qwen21_bridge_template_build.py '
          '--target t2i --object-info /tmp/mac_oi_1107.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
