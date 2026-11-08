#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1108 用户裁定:二采 Edit 路线退役,t2i 只留一采——自研件-qi21-道劫-t2i.json 撤链还原。

撤除清单(与 qi21_twopass_edit_canvas_1107.py 的落点逐项互逆):
A. 根图:二采宿主[8100]删除;链 7920-7925 删除;恢复 [5]→[7500] 直连(新链 7930);
   [1]/[2]/[3] 出口撤 7921/7922/7923 扇出;[7500]/[8] 挪回原位
B. 装配子图[6]:撤「透明模式」出口(接口+链348+inner 4013 登记)——与装配蓝图同步双刷+canonical 自检
C. definitions:删「道劫·二采精修子图」定义
(二采蓝图文件 qi21-道劫-二采精修子图.json 留库不删——节点库资产,「停用=留原位」纪律;
 MyQi21ColorAnchor/MyQi21LatentUpscale 节点注册保留同理。)
幂等:宿主不在场即视为已撤。DRY_RUN=1 只报不写。
"""
from __future__ import annotations

import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
WF = os.path.join(REPO, 'apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/自研件-qi21-道劫-t2i.json')
BP_ASM = os.path.join(REPO, 'apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json')

SUB6_NAME = '[6] 文本提示词类型优化子图'
TWOPASS_NAME = '道劫·二采精修子图'
TWOPASS_SG = 'a1e5c9d2-1107-4f21-9c3b-2e7d8f5a4b6c'
SUB6_OUT_ID = 'b2f3a4c5-0007-4b07-8f07-3c5f81b56b07'
SUB6_LINK = 348
V3_LINKS = (7920, 7921, 7922, 7923, 7924, 7925)
RESTORE_LINK = 7930  # [5]→[7500] 恢复直连


def _strip_sub6_delta(sub6: dict) -> bool:
    """撤透明模式出口三处 delta;返回是否有改动。"""
    changed = False
    outs = [o for o in sub6.get('outputs', []) if o.get('id') != SUB6_OUT_ID]
    if len(outs) != len(sub6.get('outputs', [])):
        sub6['outputs'] = outs
        changed = True
    links = [l for l in sub6.get('links', []) if l.get('id') != SUB6_LINK]
    if len(links) != len(sub6.get('links', [])):
        sub6['links'] = links
        changed = True
    inner = next((n for n in sub6['nodes'] if n['id'] == 4013), None)
    if inner is not None:
        outs2 = inner.get('outputs') or []
        if len(outs2) > 2 and SUB6_LINK in (outs2[2].get('links') or []):
            outs2[2]['links'] = [x for x in (outs2[2].get('links') or []) if x != SUB6_LINK]
            changed = True
    return changed


def main() -> int:
    dry = os.environ.get('DRY_RUN') == '1'
    doc = json.load(open(WF, encoding='utf-8'))
    nodes = {n['id']: n for n in doc['nodes']}

    if not any(n.get('type') == TWOPASS_SG for n in doc['nodes']):
        ok = nodes[7500]['inputs'][0]['link'] is not None
        print(f'[幂等] 二采宿主已不在场,洗底入口连接态: {ok}')
        return 0

    # A. 根图撤链
    doc['nodes'] = [n for n in doc['nodes'] if n.get('type') != TWOPASS_SG]
    doc['links'] = [l for l in doc['links'] if l[0] not in V3_LINKS]
    doc['links'].append([RESTORE_LINK, 5, 0, 7500, 0, 'IMAGE'])
    nodes = {n['id']: n for n in doc['nodes']}
    nodes[5]['outputs'][0]['links'] = [RESTORE_LINK]
    nodes[7500]['inputs'][0]['link'] = RESTORE_LINK
    for nid, lid in ((1, 7923), (2, 7921), (3, 7922)):
        ol = nodes[nid]['outputs'][0]['links']
        if lid in ol:
            ol.remove(lid)
    host6 = nodes[6]
    host6['outputs'] = [o for o in host6['outputs'] if o.get('name') != '透明模式']
    nodes[7500]['pos'] = [5850, 1980]
    nodes[8]['pos'] = [6010.239280551246, 2400]
    print('[根图] 宿主[8100]+链7920-7925 撤;[5]→[7500] 直连恢复(链7930);7500/8 归位')

    # B. 装配子图撤透明模式出口 + 蓝图同步
    sub6 = next(s for s in doc['definitions']['subgraphs'] if s.get('name') == SUB6_NAME)
    if _strip_sub6_delta(sub6):
        print('[子图] [6] 撤「透明模式」出口(接口/链348/inner登记)')

    before = len(doc['definitions']['subgraphs'])
    doc['definitions']['subgraphs'] = [
        s for s in doc['definitions']['subgraphs'] if s.get('name') != TWOPASS_NAME]
    print(f'[定义] 撤「{TWOPASS_NAME}」({before}→{len(doc["definitions"]["subgraphs"])})')

    bp = json.load(open(BP_ASM, encoding='utf-8'))
    bp_sg = bp['definitions']['subgraphs'][0]
    _strip_sub6_delta(bp_sg)

    def _canon(sg):
        return json.dumps({k: v for k, v in sg.items() if k != 'id'},
                          ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    assert _canon(sub6) == _canon(bp_sg), '装配蓝图与画布 def canonical 不等!'
    print('[蓝图] 装配蓝图同步+canonical 自检通过')

    if dry:
        print('[DRY_RUN] 未写盘')
        return 0
    with open(WF, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    with open(BP_ASM, 'w', encoding='utf-8') as f:
        json.dump(bp, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'[写盘] {os.path.relpath(WF, REPO)} + 装配蓝图')
    print('[下一步] qwen21_bridge_template_build.py --target t2i --object-info /tmp/mac_oi_1107b.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
