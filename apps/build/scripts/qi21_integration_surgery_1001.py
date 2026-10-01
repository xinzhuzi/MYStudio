#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-道劫-t2i [40]装配子图 R7 集成手术 v2(2026-10-01,Trellis 10-01-qi21-assembly-blueprint
implement.md S8 步骤 7 / L2-1;design.md §10;**主对话裁定 A 拆件形态**)。

━━ 裁定 A 缘起(在档,勿回潮)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
v1 一件式形态(装配器三口:[141] 同时吞装配+选择)下,钦定白名单线
「[141].装配全文→[140].prompt」与既有线「[140].positive_prompt→[141].PE出文」
构成数据环。引擎验证层实测拒绝:execution.validate_inputs 对全部连线输入递归
环检,**lazy 边无豁免**(graph.py:169-170 执行图虽豁免 lazy,验证不过=
queuePrompt 直接拒);最小同构环引擎 venv 实测=「Dependency cycle detected」
valid=False。主对话裁定 A=装配器拆两件成链,环变链,Q1=B+ 语义零损:

  [141] MyQi21PromptAssembly 装配全文件(上游,单口)
      装配全文 = 主体句+\\n+BASE+\\n+锁层A → 喂 [140].prompt(白名单线1)+[152]
  [140] QwenImage21_T2IPromptRewrite(官方件保留)
  [152] MyQi21PromptSelect 最终文本合成器(下游,两口,lazy 钩子在此)
      最终文本 = PE出文 if pe开关 else 装配全文 → [142].prompt + IO槽4
      透明文本 = 头句+" "+(剥离(PE出文)+" "+W1 if pe开关 else 装配全文)+" "+尾句
               → [143].prompt

━━ 手术范围(v2,从 v1 一件式术后态续做;v1 已役:28件/53线→9件/28线)━━━━
  1. [141] 改型:三口一件式 → 单口装配全文件(inputs 3 槽:主体句0/锁层A全文1/
     BASE2;widgets_values 2 项=pos0 主体句例文+pos1 锁层A,链式迁自 v1 wv[0]/wv[3])
  2. 立件2 [152](id 取原画幅链已删 id;inputs 7 槽:pe开关0/透明模式1/头句2/
     尾句3/W1收束句4(widget 型)/装配全文5/PE出文6(纯槽);widgets_values 5 项=
     [True, False, 头, 尾, W1],链式迁自 v1 wv[1][2][4][5][6])
  3. 连线端点改 6 根(8/66/23/62/45/57 → 152 各槽;9 的 BASE 槽位 7→2)
     + 白名单新增第 3 根 link67 [152].装配全文←[141].装配全文(拆件内部链)
     → 9 节点 28 线 → 10 节点 29 线
  4. ★新接线白名单(v2 全量 3 条,显式列名):
     link65 [140].prompt ← [141].装配全文(Q1=B+ 根治 link=None 种子文;
       [140] 种子文 widget 已于 v1 清空+Note[250] 注明)
     link66 [152].透明模式 ← [210].rgba_on(Q2 按型自动链;机械双产出模式输入)
     link67 [152].装配全文 ← [141].装配全文(裁定 A 拆件链:上游真源双扇出)
  5. 布局:三横带重排 10 件(带0=[143];带1 主链=[150][141][142][144];
     带2=[210][140][152][250Note][151])+组框 3 框重立
  6. 顶层 [10] Note 速查卡 v2 句替(一件式表述→两件链表述)
  7. 断言全家:固定句 SHA256 链式对拍(件内迁移零损)/接口面/引用一致性/
     **无环断言(引擎 validate_inputs 同款递归,lazy 边计入=实弹前置守门)**/
     严格右向(塔测试口径)/宿主面板零变化(design §10.7)

手术三件套(v2):apps/output/qi21-integration-surgery-1001/{before-v2,after-v2,
assertions-v2.txt}(v1 三件套 before/after/assertions.* 同目录存史)
铁律:禁手工编辑JSON;断言不过=fail-closed 不落盘。

用法:python3 apps/build/scripts/qi21_integration_surgery_1001.py --step all|verify
  输入态识别:28件53线=原始态(拒,提示 v1 已役)/9件28线一件式=v2 可手术/
  10件29线两件式=已手术(verify)。
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
NODES_DIR = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes"
SG_UUID = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"
SNAP_DIR = ROOT / "apps/output/qi21-integration-surgery-1001"

ASM_ID, SEL_ID, WH_ID, NOTE_ID = 141, 152, 151, 250
# v1 已删 22 件(id 141/151 由新件沿用;152 本轮复用为合成器)
GONE_IDS = [110, 130, 131, 140 + 0, 160, 161, 162, 163, 206, 207, 208, 209, 215, 216,
            151, 152, 153, 154, 155, 156, 157, 158, 141]  # 140 保留(此表仅历史档案)

# v1 已役映射账(28件53线→9件28线;档=assertions.txt):RETAIN 13/REDIRECT 13/
# ABSORBED 3/CONST_TO_PARAM 6/INTERNALIZED 18 + 白名单 65/66。v2 在其上续做。

# ── v2 端点改写(6 根,一件式术后端点 → 两件链端点)────────────────────
REDIRECT_V2 = {  # link_id: (origin_id, origin_slot, target_id, target_slot, type)
    9:  (150, 0, ASM_ID, 2, "STRING"),    # BASE 槽位 7→2(件1 改型后新槽序)
    8:  (-10, 5, SEL_ID, 0, "BOOLEAN"),   # PE开关→[152].pe开关
    66: (210, 0, SEL_ID, 1, "BOOLEAN"),   # 透明模式→[152].透明模式(端点自141改152)
    23: (140, 0, SEL_ID, 6, "STRING"),    # PE出文→[152].PE出文
    62: (SEL_ID, 0, 142, 3, "STRING"),    # [152].最终文本→[142].prompt
    45: (SEL_ID, 0, -20, 4, "STRING"),    # [152].最终文本→IO 最终文本
    57: (SEL_ID, 1, 143, 3, "STRING"),    # [152].透明文本→[143].prompt
}
# v1 态不动线(28 线中除上 7 根外全部保留;65 白名单线1 端点不变)
WHITELIST_V2 = {
    65: (ASM_ID, 0, 140, 1, "STRING"),      # [140].prompt←[141].装配全文(端点不变,存档列名)
    66: (210, 0, SEL_ID, 1, "BOOLEAN"),     # (已入 REDIRECT_V2,端点改写)
    67: (ASM_ID, 0, SEL_ID, 5, "STRING"),   # ★新增:[152].装配全文←[141].装配全文
}

# ── 三横带布局(10 件;塔测试口径=严格 tx > ox 全通过)──────────────────
LAYOUT = {
    143: ([4850, 560], None),               # 带0:RGBA 透明编码支路
    150: ([100, 1160], None),               # 带1 主链
    ASM_ID: ([900, 1060], [520, 420]),      # 件1 装配全文件(2 widget 参数面)
    142: ([4900, 1100], None),
    144: ([5380, 1200], None),
    210: ([1250, 2250], None),              # 带2:三态
    140: ([1450, 1850], None),              # PE改写(140.x=1450 > 141.x=900:右向 ✓)
    SEL_ID: ([2000, 1850], [380, 260]),     # 件2 合成器(140 右侧成链)
    NOTE_ID: ([2450, 2260], [420, 110]),
    WH_ID: ([2600, 1900], [380, 260]),      # WhSuggest(不动)
}
NEW_GROUPS = [
    {"id": 1, "title": "RGBA 透明编码支路(上带):[152].透明文本→[143] RGBA编码",
     "bounding": [4820, 520, 480, 400], "color": "#886", "flags": {}},
    {"id": 2, "title": "主链(中轴):[150]底座九选一→[141]装配全文件→[142]主编码→[144]RGBA开关",
     "bounding": [70, 1000, 5920, 760], "color": "#a1309b", "flags": {}},
    {"id": 3, "title": "PE改写+合成+画幅联动(下带):[140]PE改写→[152]合成器;[151]画幅建议;[210]三态",
     "bounding": [1220, 1810, 2270, 640], "color": "#4a7a3f", "flags": {}},
]
NEW_STATE = {"lastGroupId": 3, "lastNodeId": NOTE_ID, "lastLinkId": 67, "lastRerouteId": 10}

NOTE_TEXT = ("[140] 输入=装配全文件·装配全文(1001 S8 Q1=B+ 裁定 / 裁定A拆件):"
             "prompt 槽接 [141] MyQi21PromptAssembly 输出口0「装配全文」"
             "(主体句+BASE+锁层A),种子文 widget 已退役清空——PE=装配全文的优化器;"
             "路选择在 [152] MyQi21PromptSelect(pe开=PE出文/pe关=装配全文直写)")

# ── IO 圆点 pos 联动(IO 圆点就近散布口径:槽 pos 随消费点迁;其余零动)──
IO_POS_V2 = {
    "RGBA透明": [1150, 2330],      # →210(新 x1250,原 3980)
    "PE开关": [1900, 1860],        # →152(新 x2000,原 141 x2000 巧合不动亦可,挪 y 贴带)
    "画幅联动开关": [2500, 2090],  # →151(新 x2600,原 x2150)
}

# ── 顶层 [10] Note v2 句替(在 v1 已写入的一件式表述上续替)─────────────
NOTE10_EDITS_V2 = [
    ("**[141] 装配器一件**(MyQi21PromptAssembly,14合1:锁层/头尾句/W1 参数面+换行拼接+PE 开关+RGBA 公式包裹+词族剥离)+PE 改写+双路编码+**[151] 画幅联动建议器**(MyQi21WhSuggest,8合1);三行流水=源行→装配→编码,提示词从装配到编码全程子图内;1001 S8 集成轮:28→9 节点)",
     "**[141] 装配全文件+[[152]] 最终文本合成器** 两件链(MyQi21PromptAssembly+MyQi21PromptSelect,裁定A拆件破数据环:装配全文→喂 [140] PE改写→PE路选择+透明包裹)+双路编码+**[151] 画幅联动建议器**(MyQi21WhSuggest,8合1);提示词从装配到编码全程子图内;1001 S8 集成轮:28→10 节点(裁定A)"),
    ("子图内 **[141] 装配器**(MyQi21PromptAssembly)把 [24] 主体句 + [150] 当前型 BASE + 锁层A全文(③层,库首节全文,全九型恒挂不随型;装配器参数面大框可编辑)逐层接成**装配全文**;pe开关=开(**默认 PE 改写**,0926 裁定1)时 PE出文为最终文本,关=直写=装配全文按图选配——最终文本子图内直喂主编码 [142].prompt,并经 [40]「最终文本」输出到主画布 [27] 装配预览过目。**pe开关在 [40] 面板=「PE开关」控件**(默认开,照「型选择」combo 同款暴露;装配器三口=装配全文(专喂 [140])/最终文本/透明文本)。",
     "子图内 **[141] 装配全文件**(MyQi21PromptAssembly)把 [24] 主体句 + [150] 当前型 BASE + 锁层A全文(③层,库首节全文,全九型恒挂不随型;参数面大框可编辑)逐层接成**装配全文**→直喂 [140].prompt(Q1=B+);**[152] 最终文本合成器**(MyQi21PromptSelect)做路选择:pe开关=开(**默认 PE 改写**,0926 裁定1)时 PE出文为最终文本,关=直写=装配全文按图选配——最终文本子图内直喂主编码 [142].prompt,并经 [40]「最终文本」输出到主画布 [27] 装配预览过目。**pe开关在 [40] 面板=「PE开关」控件**(默认开,照「型选择」combo 同款暴露;两件两口=[141]装配全文(专喂 [140])+[152]最终文本/透明文本)。"),
    ("PE 开路走透明时=[141] 装配器内置一段:PE出文→背景句剥离(词族黑名单,词边界匹配,真源=my-nodes/nodes/qi21_strip_lexicon.json 单源现读)→+W1收束句(0930 宪法改写轮S10·型盲静态,句身=05库§一0930条款,收束句在剥离之后拼接=对词族结构性免疫)→官方头尾包裹=透明文本(装配器口2)→[143] RGBA编码;RGBA 关+PE 开=装配器口1 最终文本直喂 [142] 主编码吃带背景完整文(禁剥离)",
     "PE 开路走透明时=[152] 合成器内置一段:PE出文→背景句剥离(词族黑名单,词边界匹配,真源=my-nodes/nodes/qi21_strip_lexicon.json 单源现读)→+W1收束句(0930 宪法改写轮S10·型盲静态,句身=05库§一0930条款,收束句在剥离之后拼接=对词族结构性免疫)→官方头尾包裹=透明文本(合成器口1)→[143] RGBA编码;RGBA 关+PE 开=合成器口0 最终文本直喂 [142] 主编码吃带背景完整文(禁剥离)"),
    ("**1001 Q1=B+ 裁定:[140] 输入=装配器·装配全文**(prompt 槽接 [141] 装配器输出口0,种子文 widget 退役清空——写死的种子文被旁路问题就此根治,PE=装配全文的优化器)",
     "**1001 Q1=B+ 裁定:[140] 输入=装配全文件·装配全文**(prompt 槽接 [141] MyQi21PromptAssembly 输出口0,种子文 widget 退役清空——写死的种子文被旁路问题就此根治,PE=装配全文的优化器)"),
]


def sha16(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def load_module(fname: str):
    spec = importlib.util.spec_from_file_location(fname, NODES_DIR / fname)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def assert_acyclic(sg):
    """引擎 validate_inputs 同款环检(全部连线输入递归,lazy 边计入)。

    裁定 A 存在性证明=本断言绿;若未来接线改动引入环,此处在落盘前即红
    (否则实弹 queuePrompt 验证拒:Dependency cycle detected)。
    """
    upstream = {}
    for l in sg["links"]:
        if l["target_id"] != -20:
            upstream.setdefault(l["target_id"], []).append(l["origin_id"])
    state = {}

    def visit(nid, path):
        if state.get(nid) == 1:
            return
        if state.get(nid) == 0:
            raise AssertionError(
                "依赖环实测(引擎同款算法,lazy 边计入):"
                + " -> ".join(map(str, path + [nid])))
        state[nid] = 0
        for org in upstream.get(nid, []):
            if org != -10:
                visit(org, path + [nid])
        state[nid] = 1

    for n in sg["nodes"]:
        visit(n["id"], [])


def consistency(d):
    errs = []
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}
    for nid, n in nodes.items():
        for i in n.get("inputs", []) or []:
            lid = i.get("link")
            if lid is not None and lid not in links:
                errs.append(f"node {nid} input {i.get('name')} 悬空 link {lid}")
            if lid is not None and links[lid]["target_id"] != nid:
                errs.append(f"node {nid} input {i.get('name')} link {lid} 反向指向")
        for o in n.get("outputs", []) or []:
            for lid in (o.get("links") or []):
                if lid not in links:
                    errs.append(f"node {nid} output {o.get('name')} 悬空 link {lid}")
                elif links[lid]["origin_id"] != nid:
                    errs.append(f"node {nid} output {o.get('name')} link {lid} 反向源")
    for arr, tag, oid in ((sg.get("inputs", []), "sg.input", -10),
                          (sg.get("outputs", []), "sg.output", -20)):
        for slot, s in enumerate(arr):
            for lid in s.get("linkIds", []):
                if lid not in links:
                    errs.append(f"{tag} {s['name']} 悬空 linkId {lid}")
                elif (tag == "sg.input" and links[lid]["origin_id"] != oid) or \
                     (tag == "sg.output" and links[lid]["target_id"] != oid):
                    errs.append(f"{tag} {s['name']} linkId {lid} 端点不符")
    for l in links.values():
        if l["origin_id"] not in nodes and l["origin_id"] != -10:
            errs.append(f"link {l['id']} 源节点 {l['origin_id']} 不存在")
        if l["target_id"] not in nodes and l["target_id"] != -20:
            errs.append(f"link {l['id']} 目标节点 {l['target_id']} 不存在")
    return errs


def rebuild_refs(sg):
    for n in sg["nodes"]:
        for i in n.get("inputs", []) or []:
            i["link"] = None
        for o in n.get("outputs", []) or []:
            o["links"] = []
        for l in sg["links"]:
            if l["target_id"] == n["id"]:
                inputs = n.get("inputs") or []
                assert l["target_slot"] < len(inputs), \
                    f"link{l['id']} target_slot {l['target_slot']} 越界 node{n['id']}"
                inputs[l["target_slot"]]["link"] = l["id"]
            if l["origin_id"] == n["id"]:
                outs = n["outputs"]
                assert l["origin_slot"] < len(outs), \
                    f"link{l['id']} origin_slot {l['origin_slot']} 越界 node{n['id']}"
                outs[l["origin_slot"]].setdefault("links", []).append(l["id"])
    for slot, s in enumerate(sg["inputs"]):
        s["linkIds"] = [l["id"] for l in sg["links"]
                        if l["origin_id"] == -10 and l["origin_slot"] == slot]
    for slot, s in enumerate(sg["outputs"]):
        s["linkIds"] = [l["id"] for l in sg["links"]
                        if l["target_id"] == -20 and l["target_slot"] == slot]


def make_select(order: int, wv: list) -> dict:
    return {
        "id": SEL_ID, "type": "MyQi21PromptSelect",
        "title": "最终文本合成器(pe开=PE出文/pe关=装配全文;透明文本=RGBA包裹+词族剥离)",
        "pos": list(LAYOUT[SEL_ID][0]), "size": list(LAYOUT[SEL_ID][1]),
        "flags": {}, "order": order, "mode": 0,
        "inputs": [
            {"name": "pe开关", "type": "BOOLEAN", "widget": {"name": "pe开关"}, "link": None},
            {"name": "透明模式", "type": "BOOLEAN", "widget": {"name": "透明模式"}, "link": None},
            {"name": "RGBA官方头句", "type": "STRING", "widget": {"name": "RGBA官方头句"}, "link": None},
            {"name": "RGBA官方尾句", "type": "STRING", "widget": {"name": "RGBA官方尾句"}, "link": None},
            {"name": "W1收束句", "type": "STRING", "widget": {"name": "W1收束句"}, "link": None},
            {"name": "装配全文", "type": "STRING", "shape": 7, "link": None},
            {"name": "PE出文", "type": "STRING", "shape": 7, "link": None},
        ],
        "outputs": [
            {"name": "最终文本", "type": "STRING", "links": []},
            {"name": "透明文本", "type": "STRING", "links": []},
        ],
        "widgets_values": wv,
        "properties": {"Node name for S&R": "MyQi21PromptSelect"},
    }


def do_surgery_v2(d, report):
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    assert len(sg["nodes"]) == 9 and len(sg["links"]) == 28, \
        f"v2 前置锚:应一件式术后态(9件28线),得 {len(sg['nodes'])}件{len(sg['links'])}线"
    asm = nodes[ASM_ID]
    assert asm["type"] == "MyQi21PromptAssembly" and len(asm["outputs"]) == 3, \
        "v2 前置锚:[141] 应为一件式三口形态"
    old_wv = asm["widgets_values"]  # [主体句, pe开关, 透明模式, 锁层A, 头, 尾, W1]
    assert len(old_wv) == 7

    # ① [141] 改型=单口装配全文件(widgets_values 链式迁移:wv[0]主体句+wv[3]锁层A)
    asm["title"] = "装配全文件(主体句+BASE+锁层A→装配全文;Q1=B+ 唯一真源)"
    asm["inputs"] = [
        {"name": "主体句", "type": "STRING", "widget": {"name": "主体句"}, "link": None},
        {"name": "锁层A全文", "type": "STRING", "widget": {"name": "锁层A全文"}, "link": None},
        {"name": "BASE", "type": "STRING", "shape": 7, "link": None},
    ]
    asm["outputs"] = [{"name": "装配全文", "type": "STRING", "links": []}]
    asm["widgets_values"] = [old_wv[0], old_wv[3]]
    asm["pos"], asm["size"] = list(LAYOUT[ASM_ID][0]), list(LAYOUT[ASM_ID][1])

    # ② 立件2 [152](wv 链式迁移:pe开关wv[1]/透明模式wv[2]/头wv[4]/尾wv[5]/W1wv[6])
    sel_wv = [old_wv[1], old_wv[2], old_wv[4], old_wv[5], old_wv[6]]
    sg["nodes"].append(make_select(25, sel_wv))

    # ③ links 端点改写+新增 67
    links = {l["id"]: l for l in sg["links"]}
    for lid, (o, os_, t, ts, ty) in REDIRECT_V2.items():
        assert lid in links, f"v1 线 {lid} 不在(前置态漂移)"
        links[lid].update(origin_id=o, origin_slot=os_, target_id=t, target_slot=ts, type=ty)
    sg["links"].append({"id": 67, "origin_id": ASM_ID, "origin_slot": 0,
                        "target_id": SEL_ID, "target_slot": 5, "type": "STRING"})

    # ④ 布局+组框+state+Note250
    for n in sg["nodes"]:
        if n["id"] in LAYOUT and n["id"] not in (ASM_ID, SEL_ID, WH_ID):
            pos, size = LAYOUT[n["id"]]
            n["pos"] = list(pos)
            if size:
                n["size"] = list(size)
    sg["groups"] = copy.deepcopy(NEW_GROUPS)
    sg["state"] = dict(NEW_STATE)
    for s in sg["inputs"]:
        if s["name"] in IO_POS_V2:
            s["pos"] = list(IO_POS_V2[s["name"]])
    note = nodes[NOTE_ID]
    note["widgets_values"] = [NOTE_TEXT]
    note["pos"], note["size"] = list(LAYOUT[NOTE_ID][0]), list(LAYOUT[NOTE_ID][1])
    note["title"] = "[250] [140] 输入=装配全文件·装配全文"

    # ⑤ 引用重建
    rebuild_refs(sg)

    # ⑥ 顶层 [10] Note v2 句替
    note10 = next(n for n in d["nodes"] if n["id"] == 10)
    content = note10["widgets_values"][0]
    for old, new in NOTE10_EDITS_V2:
        assert old in content, f"[10] Note v1 一件式句不在场(v2 句替清单漂移):{old[:50]}…"
        content = content.replace(old, new)
    note10["widgets_values"][0] = content
    # id 分配器真值锚(契约 test_id_counters_not_below_actual_max):Note250 入图
    # 须抬顶层计数器(计数器≥max 合法,只加不减)
    d["last_node_id"] = max(d.get("last_node_id", 0), NOTE_ID)
    return {"old_wv": old_wv}


def verify(d, carried, report):
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}

    # A. 节点 10/成员/类型
    assert len(sg["nodes"]) == 10, f"节点数应 10(裁定A),得 {len(sg['nodes'])}"
    want_ids = sorted([140, 142, 143, 144, 150, 210, ASM_ID, SEL_ID, WH_ID, NOTE_ID])
    assert sorted(nodes) == want_ids, f"成员集漂移:{sorted(nodes)}"
    assert nodes[ASM_ID]["type"] == "MyQi21PromptAssembly"
    assert nodes[SEL_ID]["type"] == "MyQi21PromptSelect"
    assert nodes[WH_ID]["type"] == "MyQi21WhSuggest"
    assert nodes[NOTE_ID]["type"] == "MarkdownNote"
    report.append(f"A 节点:9(一件式)→10(裁定A两件链)✓ 成员={sorted(nodes)}")

    # B. links 29 + 白名单 3
    assert len(sg["links"]) == 29, f"links 应 29,得 {len(sg['links'])}"
    wl = ("  ★白名单(显式列名,恰3条):\n"
          "    link65 [140].prompt ← [141].装配全文(Q1=B+;种子文 widget 已清空+Note[250])\n"
          "    link66 [152].透明模式 ← [210].rgba_on(Q2 按型自动链)\n"
          "    link67 [152].装配全文 ← [141].装配全文(裁定A拆件链,上游真源双扇出)")
    report.append("B links:28→29 ✓\n" + wl)
    for lid, (o, os_, t, ts, ty) in {65: (ASM_ID, 0, 140, 1, "STRING"),
                                     66: (210, 0, SEL_ID, 1, "BOOLEAN"),
                                     67: (ASM_ID, 0, SEL_ID, 5, "STRING")}.items():
        l = links[lid]
        assert (l["origin_id"], l["origin_slot"], l["target_id"],
                l["target_slot"], l["type"]) == (o, os_, t, ts, ty), f"白名单线 link{lid} 漂移"

    # C. 裁定A存在性:无环(引擎同款,lazy 边计入)
    assert_acyclic(sg)
    report.append("C 无环断言(引擎 validate_inputs 同款递归,lazy 边计入)✓ "
                  "——一件式 lazy 环已破:150→141→140→152 链式,无回边")

    # D. 固定句链式 SHA256(件内迁移零损:old_wv → 新件 widgets_values)
    asm, sel = nodes[ASM_ID], nodes[SEL_ID]
    old_wv = carried["old_wv"]
    pairs = [("锁层A全文", asm["widgets_values"][1], old_wv[3]),
             ("RGBA官方头句", sel["widgets_values"][2], old_wv[4]),
             ("RGBA官方尾句", sel["widgets_values"][3], old_wv[5]),
             ("W1收束句", sel["widgets_values"][4], old_wv[6])]
    report.append("D 固定句链式迁移对拍(v1 wv → 两件新槽):")
    if any(v is None for v in old_wv):
        report.append("  (verify-only:无术前 wv,链式双向对拍已在 all 模式执行;"
                      "终态四句 sha16 见 assertions-v2.txt 存档)")
    else:
        for name, new, old in pairs:
            assert sha16(new) == sha16(old), f"{name} 链式迁移漂移!"
            report.append(f"  {name} sha16={sha16(new)} ✓")
        assert asm["widgets_values"][0] == old_wv[0], "主体句例文迁移漂移"
    assert sel["widgets_values"][0] is True and sel["widgets_values"][1] is False, \
        "pe开关 True/透明模式 False 语义漂移"

    # E. 两件接口面(槽名序/口名序/wv 位序)
    assert [i["name"] for i in asm["inputs"]] == ["主体句", "锁层A全文", "BASE"]
    assert [o["name"] for o in asm["outputs"]] == ["装配全文"]
    assert len(asm["widgets_values"]) == 2
    assert [i["name"] for i in sel["inputs"]] == \
        ["pe开关", "透明模式", "RGBA官方头句", "RGBA官方尾句", "W1收束句", "装配全文", "PE出文"]
    assert [o["name"] for o in sel["outputs"]] == ["最终文本", "透明文本"]
    assert len(sel["widgets_values"]) == 5
    report.append("E 两件接口面(141=3槽单口/152=7槽两口)✓")

    # F. 端到端接线抽验(全 29 条端点清单)
    want_eps = {
        1: (-10, 0, 142, 0, "CLIP"), 2: (-10, 0, 143, 0, "CLIP"),
        3: (-10, 1, 142, 2, "VAE"), 4: (-10, 1, 143, 2, "VAE"),
        5: (-10, 2, ASM_ID, 0, "STRING"), 6: (-10, 3, 150, 0, "COMBO"),
        7: (-10, 4, 210, 0, "COMBO"), 8: (-10, 5, SEL_ID, 0, "BOOLEAN"),
        46: (-10, 6, 140, 0, "CLIP"), 47: (-10, 7, WH_ID, 1, "BOOLEAN"),
        9: (150, 0, ASM_ID, 2, "STRING"),
        17: (142, 0, 144, 0, "CONDITIONING"), 19: (143, 0, 144, 1, "CONDITIONING"),
        20: (144, 0, -20, 0, "CONDITIONING"), 21: (142, 1, -20, 1, "CONDITIONING"),
        23: (140, 0, SEL_ID, 6, "STRING"),
        25: (140, 2, WH_ID, 0, "STRING"),
        37: (150, 1, WH_ID, 2, "INT"), 41: (150, 2, WH_ID, 3, "INT"),
        42: (WH_ID, 0, -20, 2, "INT"), 43: (WH_ID, 1, -20, 3, "INT"),
        45: (SEL_ID, 0, -20, 4, "STRING"),
        57: (SEL_ID, 1, 143, 3, "STRING"),
        59: (210, 0, 144, 2, "BOOLEAN"), 61: (150, 4, 210, 1, "BOOLEAN"),
        62: (SEL_ID, 0, 142, 3, "STRING"),
        65: (ASM_ID, 0, 140, 1, "STRING"), 66: (210, 0, SEL_ID, 1, "BOOLEAN"),
        67: (ASM_ID, 0, SEL_ID, 5, "STRING"),
    }
    assert set(links) == set(want_eps), \
        f"link id 集漂移:多{set(links)-set(want_eps)} 少{set(want_eps)-set(links)}"
    for lid, want in want_eps.items():
        l = links[lid]
        got = (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"])
        assert got == want, f"link{lid} 端点 {got} != {want}"
    report.append("F 全 29 条端点逐条对拍 ✓(26 承接+3 白名单)")

    # G. [140] 接线态+种子文清空(v1 已做,复验)
    pe = nodes[140]
    assert pe["inputs"][1]["name"] == "prompt" and pe["inputs"][1]["link"] == 65
    assert pe["widgets_values"][0] == ""
    report.append("G [140].prompt←link65 装配全文;种子文 widget 空 ✓")

    # H. 引用一致性(零悬空零反向+IO linkIds)
    errs = consistency(d)
    assert errs == [], errs
    report.append("H 引用一致性:零悬空零反向;IO linkIds 逐项登记 ✓")

    # I. 严格右向(塔测试口径:节点间线 tx > ox;边界线以 IO 槽 pos 计)
    for l in sg["links"]:
        if l["origin_id"] == -10:
            ox = sg["inputs"][l["origin_slot"]]["pos"][0]
        else:
            ox = nodes[l["origin_id"]]["pos"][0]
        if l["target_id"] == -20:
            tx = sg["outputs"][l["target_slot"]]["pos"][0]
        else:
            tx = nodes[l["target_id"]]["pos"][0]
        assert tx > ox, f"左向/竖塔线 link{l['id']}:ox={ox} tx={tx}"
    report.append("I 严格右向(每线 tx > ox,含 65/23/67 环变链三线)✓")

    # J. 宿主面板零变化(design §10.7)
    assert len(sg["inputs"]) == 8 and len(sg["outputs"]) == 5
    assert len(sg["widgets"]) == 5
    report.append("J 宿主面板:子图 IO 8入5出/sg.widgets 5 值零变化 ✓")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all", choices=["all", "verify"])
    a = ap.parse_args()
    raw = WF.read_text()
    d = json.loads(raw)
    assert d["definitions"]["subgraphs"][0]["id"] == SG_UUID, "子图uuid漂移,拒绝手术"
    sg = d["definitions"]["subgraphs"][0]
    state = (len(sg["nodes"]), len(sg["links"]))
    if state == (28, 53):
        print("输入态=原始 28件53线:v1 手术已役(档=assertions.txt),本脚本 v2 只从"
              " 一件式 9件28线 态续做;回滚请 git checkout -- 工作流文件后先跑 v1 "
              "(历史形态,勿重造)")
        sys.exit(2)
    if state == (10, 29) and a.step == "all":
        print("输入态=两件式 10件29线(已手术):转 verify-only")
        a.step = "verify"
    SNAP_DIR.mkdir(parents=True, exist_ok=True)

    if a.step == "verify":
        carried = {"old_wv": [None] * 7}
        report = ["(verify-only:链式 SHA 对拍已在 all 模式执行)"]
        errs = verify(d, carried, report)
        print("\n".join(report))
        sys.exit(1 if errs else 0)

    SNAP_DIR.joinpath("before-v2.json").write_text(raw)
    top_before = {k: copy.deepcopy(v) for k, v in d.items() if k != "definitions"}
    report = ["=" * 72, "qi21 集成手术 v2 断言账(裁定A拆件:一件式→两件链)", "=" * 72]
    carried = do_surgery_v2(d, report)

    # 顶层零变化(唯 [10] Note 4 处 v2 句替 + last_node_id 抬到 250=计数器真值锚)
    top_after = {k: copy.deepcopy(v) for k, v in d.items() if k != "definitions"}
    assert top_after["links"] == top_before["links"], "顶层 links 应零变化"
    assert top_after["groups"] == top_before["groups"], "顶层 groups 应零变化"
    assert len(top_after["nodes"]) == len(top_before["nodes"])
    for nb, na in zip(top_before["nodes"], top_after["nodes"]):
        if nb["id"] == 10:
            continue
        assert nb == na, f"顶层 node{nb['id']} 漂移"
    note10 = next(n for n in d["nodes"] if n["id"] == 10)
    for token in ("MyQi21PromptAssembly", "MyQi21PromptSelect", "MyQi21WhSuggest",
                  "qi21_strip_lexicon.json", "从库刷参数", "28→10 节点", "裁定A"):
        assert token in note10["widgets_values"][0], f"[10] Note 缺 v2 锚 token:{token}"
    for gone_ref in ("装配器一件", "装配器三口", "装配器口1", "装配器口2",
                     "装配器内置", "装配器·装配全文", "28→9 节点"):
        assert gone_ref not in note10["widgets_values"][0], \
            f"[10] Note 残留一件式表述:{gone_ref}"
    report.append("K 顶层零变化(唯 [10] Note 4 处 v2 句替)✓")

    errs = verify(d, carried, report)
    report += ["=" * 72, "全绿:v2 手术成立,落盘", "=" * 72]
    out = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    SNAP_DIR.joinpath("after-v2.json").write_text(out)
    SNAP_DIR.joinpath("assertions-v2.txt").write_text("\n".join(report) + "\n")
    if errs:
        print("\n".join(report))
        print("断言红,拒绝落盘:", errs)
        sys.exit(1)
    WF.write_text(out)
    print("\n".join(report))
    print(f"已落盘 {WF}")
    print(f"三件套(v2): {SNAP_DIR}/(before-v2.json / after-v2.json / assertions-v2.txt;"
          " v1 三件套同目录存史)")


if __name__ == "__main__":
    main()
