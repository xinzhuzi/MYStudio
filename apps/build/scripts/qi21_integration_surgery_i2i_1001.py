#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-道劫-i2i [40]装配子图同构集成手术(2026-10-01,Trellis 10-01-qi21-i2i-edit-isomorphic;
打法蓝本=archive/2026-10/10-01-qi21-assembly-blueprint design §10+§10.9(t2i 全部教训);
映射表=research/map-i2i.md 复核后版;t2i 终态参照=1_文生图/qi21-道劫-t2i.json 10节点两件式链)。

━━ i2i 与 t2i 的关键结构差异(手术据此裁形,勿照搬)━━━━━━━━━━━━━━━
  1. PE 链:i2i 是 6 件自拼 LLM 看图改写链([21]system+[23]后缀+[24]拼装+[25]双图批
     +[26]TextGenerate+[27]抽取),**吃 -10槽4 裸指令,绝不吃装配全文**
     (Edit Prompt Enhancer 语义=改写用户编辑指令,喂装配全文=语义破坏+造环)。
     ⇒ t2i 的「装配全文喂 PE」(Q1=B+)在 i2i 不可搬运;选择器挪到装配上游择「主体句」
     ——恰与 i2i 现拓扑 [15] 开关位置一致,数据流方向零改动。
  2. 画幅联动链不存在([150] W/H links=null,宿主 4 控件无画幅项)
     ⇒ 不带 MyQi21WhSuggest,子图 9 入 5 出零变化。
  3. 双参考图分线在编码层(双图线 [142][143][144] + 单图线 [171][172][173]),
     两线共享同一装配文本 ⇒ 新装配段出口必须同时喂四个 prompt 槽。
  4. 防环红线(map §六;§10.9 教训=验证层环检无 lazy 豁免):装配全文([141]口0/
     [153] 两口)禁入 PE 链([24]/[26] 任何输入);PE 链输入只许 -10槽4 裸指令
     +[21][23] 常量+[25] 图批+pe_clip。本手术拓扑全单向,verify 机械断言把关。

━━ 手术内容(主案=双 Select 链,map §5)━━━━━━━━━━━━━━━━━━━━━
  1. 删收编 8 件:[15](→Select①[152])[110][130][131](→Assembly[141])
     [160][161][162][163](→Select②[153]);Reroute 消化 6 件([170][174][181]
     [182][183][184],t2i 终态子图内零 Reroute,改直连)。28→17 节点。
  2. 立三件(id 沿 map §5.1:Assembly=141/Select①=152/Select②=153):
     [152] Select①「择文合成器」替 [15]:pe开关←-10槽7/装配全文槽←-10槽4 裸指令
       /PE出文(lazy)←[27]/透明模式←[180].rgba_on(纯同构占位);
       出=最终文本(pe开=PE抽取文/pe关=裸指令)→[141].主体句;透明文本口不接
       (其 pe 开路=剥离+W1,与 i2i 透明路语义不符)。
     [141] Assembly(照 t2i [141] 单口形态):主体句←[152].最终文本/BASE←[150].BASE/
       锁层A全文=参数槽(迁 [110] 现值逐字);出=装配全文 四路扇出
       →[142].prompt(槽4)/[171].prompt(槽3)/-20槽4 prompt/[153].装配全文。
     [153] Select②「透明包裹器」替 [162][163][160][161],恒 pe 关=纯包裹:
       pe开关=widget False(不接线);装配全文←[141];透明模式←[180].rgba_on;
       出=透明文本(口1)=头句+" "+装配全文+" "+尾句 ≡ 原[162]+[163] 逐字
       →[143].prompt(槽4)+[172].prompt(槽3);最终文本口(口0)不接。
  3. 连线账:58 线 → 49 线(保留 31 不动+改写 10+删 17+新增 8:link60-67)。
  4. 固定句值迁参数槽逐件 SHA256(锁层A→[141].wv[1];头/尾→[153].wv[2]/[3];
     与 my_nodes 件内 default 三方对拍,禁手敲)。
  5. R2 更名:宿主[40] title+子图 name →「[40] 提示词类型优化子图」口径
     (子图含「(双击进入)」,照 t2i);顺带补 category=「漫影」(t2i 对齐项)。
  6. 横向四带布局(严格右向:每线 tx > ox,含 IO 圆点):
     带0 PE源行/带1 PE主体+Select①/带2 装配主链/带3 编码区(双图+单图两行)。
  7. 端到端逻辑等价对拍:原拓扑拼接公式(术前 JSON 实读 delimiter+固定句)
     vs 三件 Python 实调(importlib 载入 my_nodes 件),pe开/pe关两路逐字对拍。
  8. 依赖环自查:引擎同款 DFS(全部连线输入递归,lazy 边计入,§10.9 口径)
     +PE 链入边白名单机械断言(红线 1 落地)。

手术三件套:apps/output/qi21-integration-i2i-1001/{before,after,assertions}
铁律:禁手工编辑JSON;断言不过=fail-closed 不落盘;只改 i2i.json+本脚本两文件。

用法:python3 apps/build/scripts/qi21_integration_surgery_i2i_1001.py --step all|verify
  输入态识别:28件58线=原始态(可手术)/17件49线=已手术(verify)/其他=拒绝。
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
NODES_DIR = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes"
SG_UUID = "d47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d"  # i2i 宿主内嵌定义 uuid(S5 前形态,本手术不换宿主)
SNAP_DIR = ROOT / "apps/output/qi21-integration-i2i-1001"

ASM_ID, SEL1_ID, SEL2_ID = 141, 152, 153  # id 沿 map §5.1(i2i 子图当前空闲,184>153 合法)
GONE_IDS = [15, 110, 130, 131, 160, 161, 162, 163]          # 删收编 8 件
REROUTE_IDS = [170, 174, 181, 182, 183, 184]                 # Reroute 消化 6 件
PE_CHAIN = [21, 23, 24, 25, 26, 27]                          # PE 链 6 件全保留(禁改 my_nodes)

# ── 连线账 ─────────────────────────────────────────────────────────────
# 改写 10 根(端点重导向;原端点见 map §三,脚本内 do_surgery 逐根断言原值)
REDIRECT = {  # link_id: (origin_id, origin_slot, target_id, target_slot, type)
    15: (ASM_ID, 0, 142, 4, "STRING"),    # [131].装配全文→[142].prompt ⇒ [141].装配全文(替 link15)
    31: (ASM_ID, 0, 171, 3, "STRING"),    # [131]→[171].prompt(槽3,单图线) ⇒ [141]
    25: (ASM_ID, 0, -20, 4, "STRING"),    # [131]→IO槽4 prompt ⇒ [141]
    20: (SEL2_ID, 1, 143, 4, "STRING"),   # [163].透明文本→[143].prompt ⇒ [153].透明文本(口1)
    35: (SEL2_ID, 1, 172, 3, "STRING"),   # [163]→[172].prompt(槽3,单图线) ⇒ [153].透明文本
    27: (143, 0, 144, 1, "CONDITIONING"), # [143].positive→[170]中继→[144].on_true ⇒ 直连
    57: (142, 0, 144, 0, "CONDITIONING"), # [142].positive→[183]中继→[144].on_false ⇒ 直连
    33: (171, 0, 173, 0, "CONDITIONING"), # [171].positive→[174]中继→[173].on_false ⇒ 直连
    58: (180, 0, 144, 2, "BOOLEAN"),      # [180].rgba_on→[182]中继→[144].switch ⇒ 直连
    55: (150, 4, 180, 1, "BOOLEAN"),      # [150].rgba_default→[181]→[184]双中继→[180].rgba_hint ⇒ 直连
}
REDIRECT_ORIG = {  # 改写前原端点(do_surgery 前置断言,防输入态漂移)
    15: (131, 0, 142, 4, "STRING"), 31: (131, 0, 171, 3, "STRING"),
    25: (131, 0, -20, 4, "STRING"), 20: (163, 0, 143, 4, "STRING"),
    35: (163, 0, 172, 3, "STRING"), 27: (170, 0, 144, 1, "CONDITIONING"),
    57: (183, 0, 144, 0, "CONDITIONING"), 33: (174, 0, 173, 0, "CONDITIONING"),
    58: (182, 0, 144, 2, "BOOLEAN"), 55: (150, 4, 181, 0, "BOOLEAN"),
}
DEL_LINKS = [54, 12, 14, 13, 16, 17, 18, 19,        # 装配段 8 线(随 [15][110][130][131][160][161][162][163] 删)
             43, 44, 53,                            # [15] 三入(替为 61/62/63)
             21, 22, 32, 9, 59, 56]                 # Reroute 消化 6 线(改直连后旧线退役)
NEW_LINKS = {  # ★新增 7 根(显式列名)
    60: (SEL1_ID, 0, ASM_ID, 0, "STRING"),   # [152].最终文本→[141].主体句(替 link54 语义,择文上位)
    61: (-10, 7, SEL1_ID, 0, "BOOLEAN"),     # PE开关→[152].pe开关(替 link44)
    62: (-10, 4, SEL1_ID, 5, "STRING"),      # 指令→[152].装配全文槽(替 link43;pe关路=直用指令)
    63: (27, 0, SEL1_ID, 6, "STRING"),       # [27].PE抽取文→[152].PE出文(lazy;替 link53;pe关=[26]整链不进执行图)
    64: (180, 0, SEL1_ID, 1, "BOOLEAN"),     # [180].rgba_on→[152].透明模式(纯同构占位,不参与文本计算)
    65: (150, 0, ASM_ID, 2, "STRING"),       # [150].BASE→[141].BASE(替 link12)
    66: (ASM_ID, 0, SEL2_ID, 5, "STRING"),   # [141].装配全文→[153].装配全文(透明包裹器真源)
    67: (180, 0, SEL2_ID, 1, "BOOLEAN"),     # [180].rgba_on→[153].透明模式(纯同构占位)
}

# ── 横向四带布局(17 件;严格右向=每线 tx > ox,IO 圆点 pos 计入)──────────
LAYOUT = {  # id: (pos, size|None=保留原值)
    # 带0 PE源行 y≈140
    23: ([80, 140], None), 21: ([580, 140], None), 25: ([1140, 140], None),
    # 带1 PE主体+Select① y≈580
    24: ([840, 580], None), 26: ([1600, 580], None), 27: ([2250, 580], None),
    SEL1_ID: ([2900, 580], [380, 260]),
    # 带2 装配主链(180 过渡件+141/153 中轴+150 左下)
    180: ([2750, 950], None), ASM_ID: ([3650, 1150], [520, 420]),
    SEL2_ID: ([4550, 1150], [380, 260]), 150: ([2600, 1600], None),
    # 带3 编码区(双图线 y≈1550 / 单图线 y≈2200)
    142: ([5400, 1550], None), 143: ([6500, 1550], None), 144: ([7400, 1550], None),
    171: ([5400, 2200], None), 172: ([6500, 2200], None), 173: ([7400, 2200], None),
}
# IO 圆点 pos 联动(照 t2i 口径:圆点随消费点就近散布;image_1/2 双消费=[25]+编码区,
# 圆点放 [25] 近侧沿走廊拉长线,与原工作流形态一致;指令圆点=[24]/[152] 双消费左近)
IO_POS = {
    "clip": [5360, 1380], "vae": [5350, 1460],
    "image_1": [1050, 80], "image_2": [1080, 240],
    "指令": [820, 420], "型选择": [2550, 1520], "RGBA透明": [2700, 880],
    "PE开关": [2850, 650], "pe_clip": [1550, 510],
    "positive": [9500, 1500], "negative": [9500, 1600], "latent": [9500, 1700],
    "positive_single": [9500, 2300], "prompt": [9500, 1200],
}
NEW_GROUPS = [
    {"id": 1, "title": "PE看图改写链(带0/1):[23]后缀+[21]system→[24]拼装→[26]TextGenerate(吃-10槽4裸指令,装配全文禁入=防环红线)→[27]抽取→[152]择文合成器①",
     "bounding": [50, 60, 3260, 1010], "color": "#4a7a3f", "flags": {}},
    {"id": 2, "title": "装配主链(带2):[150]底座+[180]三态→[141]装配全文件(择文+BASE+锁层A)→[153]透明包裹器②(恒pe关=头句+装配全文+尾句)",
     "bounding": [2550, 880, 2430, 950], "color": "#a1309b", "flags": {}},
    {"id": 3, "title": "双图编码线(带3上):[142]主编码/[143]透明编码(image_1+image_2)→[144]RGBA开关→positive",
     "bounding": [5350, 1480, 2480, 430], "color": "#886", "flags": {}},
    {"id": 4, "title": "单图编码线(带3下·黑图修复正源铁则):[171]/[172](仅image_1)→[173]→positive_single",
     "bounding": [5350, 2130, 2480, 430], "color": "#3f789e", "flags": {}},
]
NEW_STATE = {"lastGroupId": 4, "lastNodeId": 184, "lastLinkId": 67, "lastRerouteId": 2}

# ── 术前 delimiter 实读锚([130][131]=\\n;[162][163]=空格;map §二 widgets 摘要)──
D_ASM1, D_ASM2, D_RGBA1, D_RGBA2 = "\n", "\n", " ", " "

HOST_TITLE_NEW = "[40] 提示词类型优化子图"
SG_NAME_NEW = "[40] 提示词类型优化子图(双击进入)"
SG_CATEGORY = "漫影"


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def load_module(fname: str):
    spec = importlib.util.spec_from_file_location(fname, NODES_DIR / fname)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def assert_acyclic(sg):
    """引擎 validate_inputs 同款环检(全部连线输入递归,lazy 边计入;§10.9 教训)。"""
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


def sel_node(nid: int, title: str, order: int, wv: list) -> dict:
    """MyQi21PromptSelect 节点形态(照 t2i [152];7 槽两口 wv5)。"""
    return {
        "id": nid, "type": "MyQi21PromptSelect", "title": title,
        "pos": list(LAYOUT[nid][0]), "size": list(LAYOUT[nid][1]),
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


def equivalence(sg, asm_mod, sel_mod, report, source: str, carried: dict):
    """端到端逻辑等价对拍:原拓扑拼接公式 vs 三件 Python 实调,pe开/关两路逐字。

    原侧真源:all=carried 术前实读值([110]/[160]/[161] widgets,do_surgery 收);
    verify=件内 default(SHA256 已与术前值对拍,锚见 assertions)。
    BASE/指令/PE出文=符号样例(两边同值)。
    """
    if source == "pre":
        lock_a, head, tail = carried["lock_a"], carried["head"], carried["tail"]
    else:
        lock_a, head, tail = asm_mod._LOCK_A, sel_mod._RGBA_HEAD, sel_mod._RGBA_TAIL
    base = "『BASE样例·九型底座·符号值』"
    instr = "Put the light blue denim shirt from <image2> on the character in <image1>, keep everything else unchanged"
    pe_out = "『PE抽取文样例·rewritten_prompt 符号值』"
    report.append(f"L 端到端逻辑等价对拍(原侧真源={source}):")
    for pe in (True, False):
        # 原拓扑模拟:[15]择文→[130]+[131] 装配→[162]+[163] 透明包裹(delimiter 术前实读)
        zh_old = pe_out if pe else instr
        asm_old = ((zh_old + D_ASM1 + base) + D_ASM2 + lock_a)
        trans_old = ((head + D_RGBA1 + asm_old) + D_RGBA2 + tail)
        # 新拓扑实调:Select①→Assembly→Select②(恒pe关)
        sel1, asm, sel2 = sel_mod.MyQi21PromptSelect(), asm_mod.MyQi21PromptAssembly(), sel_mod.MyQi21PromptSelect()
        f1, _t1 = sel1.compose(pe开关=pe, 透明模式=False,
                               装配全文=instr, PE出文=pe_out if pe else None)
        (asm_new,) = asm.assemble(主体句=f1, 锁层A全文=lock_a, BASE=base)
        f2, trans_new = sel2.compose(pe开关=False, 透明模式=False,
                                     RGBA官方头句=head, RGBA官方尾句=tail,
                                     装配全文=asm_new)
        assert f1 == zh_old, f"Select① 择文漂移(pe={pe})"
        assert asm_new == asm_old, f"装配全文漂移(pe={pe})"
        assert trans_new == trans_old, f"透明文本漂移(pe={pe})"
        assert f2 == asm_new, "Select② 最终文本应=装配全文(pe关直写)"
        tag = "pe开(择文=PE抽取文)" if pe else "pe关(择文=裸指令)"
        report.append(f"  {tag}: 择文/装配全文/透明文本 逐字等价 ✓"
                      f"(sha16 装配全文={sha(asm_new)[:16]} 透明文本={sha(trans_new)[:16]})")


def do_surgery(d, report):
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}
    assert len(sg["nodes"]) == 28 and len(sg["links"]) == 58, \
        f"前置锚:应原始态 28件58线,得 {len(sg['nodes'])}件{len(sg['links'])}线"
    # 固定句术前实读(迁参数槽的零改字锚)
    lock_a = nodes[110]["widgets_values"][0]
    head, tail = nodes[160]["widgets_values"][0], nodes[161]["widgets_values"][0]
    instr_example = sg["widgets"][0]  # i2i 指令例文(宿主面板 wv[0] 同值)

    # ① 立三件(wv:Select① 头尾W1=default(不消费);Select② 头尾=现值逐字迁;Assembly 锁层A=现值逐字迁)
    sel_mod = load_module("my_qi21_prompt_select.py")
    asm_mod = load_module("my_qi21_prompt_assembly.py")
    sg["nodes"].append(sel_node(
        SEL1_ID, "择文合成器①(i2i:pe开=[27]PE抽取文/pe关=裸指令;替原[15];出文喂[141]主体句位)",
        6, [True, False, sel_mod._RGBA_HEAD, sel_mod._RGBA_TAIL, sel_mod._W1_TAIL]))
    sg["nodes"].append({
        "id": ASM_ID, "type": "MyQi21PromptAssembly",
        "title": "装配全文件(择文+BASE+锁层A→装配全文;i2i 版唯一真源,不喂PE链)",
        "pos": list(LAYOUT[ASM_ID][0]), "size": list(LAYOUT[ASM_ID][1]),
        "flags": {}, "order": 7, "mode": 0,
        "inputs": [
            {"name": "主体句", "type": "STRING", "widget": {"name": "主体句"}, "link": None},
            {"name": "锁层A全文", "type": "STRING", "widget": {"name": "锁层A全文"}, "link": None},
            {"name": "BASE", "type": "STRING", "shape": 7, "link": None},
        ],
        "outputs": [{"name": "装配全文", "type": "STRING", "links": []}],
        "widgets_values": [instr_example, lock_a],
        "properties": {"Node name for S&R": "MyQi21PromptAssembly"},
    })
    sg["nodes"].append(sel_node(
        SEL2_ID, "透明包裹器②(恒pe关=头句+装配全文+尾句;替原[162][163][160][161];i2i透明路无剥离无W1)",
        8, [False, False, head, tail, sel_mod._W1_TAIL]))

    # ② 连线:改写 10(先断言原端点)+删 17+新增 7
    for lid, want in REDIRECT_ORIG.items():
        l = links[lid]
        got = (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"])
        assert got == want, f"link{lid} 原端点漂移:{got} != {want}(输入态与映射表不符,停手)"
    for lid, (o, os_, t, ts, ty) in REDIRECT.items():
        links[lid].update(origin_id=o, origin_slot=os_, target_id=t, target_slot=ts, type=ty)
    sg["links"] = [l for l in sg["links"] if l["id"] not in DEL_LINKS]
    for lid, (o, os_, t, ts, ty) in NEW_LINKS.items():
        sg["links"].append({"id": lid, "origin_id": o, "origin_slot": os_,
                            "target_id": t, "target_slot": ts, "type": ty})

    # ③ 删收编 8+Reroute 6
    sg["nodes"] = [n for n in sg["nodes"]
                   if n["id"] not in set(GONE_IDS) and n["id"] not in set(REROUTE_IDS)]

    # ④ 布局+组框+IO 圆点+state+order 重排(按 x 升序 0..16)
    for n in sg["nodes"]:
        if n["id"] in LAYOUT:
            pos, size = LAYOUT[n["id"]]
            n["pos"] = list(pos)
            if size:
                n["size"] = list(size)
    sg["groups"] = copy.deepcopy(NEW_GROUPS)
    sg["state"] = dict(NEW_STATE)
    for s in sg["inputs"] + sg["outputs"]:
        if s["name"] in IO_POS:
            s["pos"] = list(IO_POS[s["name"]])
    for i, n in enumerate(sorted(sg["nodes"], key=lambda x: x["pos"][0])):
        n["order"] = i

    # ⑤ R2 更名:宿主 title+子图 name+category 对齐 t2i
    host40 = next(n for n in d["nodes"] if n["id"] == 40)
    assert host40["title"] == "[40] 装配子图", "宿主 title 前置锚漂移"
    host40["title"] = HOST_TITLE_NEW
    assert sg["name"] == "[40] 道劫·装配子图(双击进入)", "子图 name 前置锚漂移"
    sg["name"] = SG_NAME_NEW
    sg["category"] = SG_CATEGORY

    # ⑥ 引用重建(节点/IO 双侧)
    rebuild_refs(sg)
    return {"lock_a": lock_a, "head": head, "tail": tail}


def verify(d, carried, report):
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}

    # A. 节点 17/成员/类型(主案双Select+去Reroute)
    assert len(sg["nodes"]) == 17, f"节点数应 17,得 {len(sg['nodes'])}"
    want_ids = sorted(PE_CHAIN + [142, 143, 144, 150, 171, 172, 173, 180,
                                  ASM_ID, SEL1_ID, SEL2_ID])
    assert sorted(nodes) == want_ids, f"成员集漂移:{sorted(nodes)}"
    for nid in GONE_IDS + REROUTE_IDS:
        assert nid not in nodes, f"待删件 {nid} 仍在场"
    assert nodes[ASM_ID]["type"] == "MyQi21PromptAssembly"
    assert nodes[SEL1_ID]["type"] == nodes[SEL2_ID]["type"] == "MyQi21PromptSelect"
    assert not any(n["type"] == "Reroute" for n in sg["nodes"]), "子图内应零 Reroute(t2i 终态口径)"
    report.append(f"A 节点:28→17 ✓(删收编8+Reroute6+立3;PE链6件全保留)成员={want_ids}")

    # B. links 49 + 端点全表逐条对拍(保留31+改写10+新增8)
    assert len(sg["links"]) == 49, f"links 应 49,得 {len(sg['links'])}"
    KEEP = {
        1: (-10, 0, 142, 0, "CLIP"), 2: (-10, 0, 143, 0, "CLIP"),
        3: (-10, 1, 142, 2, "VAE"), 4: (-10, 1, 143, 2, "VAE"),
        5: (-10, 2, 142, 1, "IMAGE"), 6: (-10, 3, 142, 3, "IMAGE"),
        7: (-10, 2, 143, 1, "IMAGE"), 8: (-10, 3, 143, 3, "IMAGE"),
        10: (-10, 5, 150, 0, "COMBO"), 11: (-10, 6, 180, 0, "COMBO"),
        23: (144, 0, -20, 0, "CONDITIONING"), 24: (142, 1, -20, 1, "CONDITIONING"),
        26: (142, 2, -20, 2, "LATENT"), 28: (-10, 0, 171, 0, "CLIP"),
        29: (-10, 1, 171, 2, "VAE"), 30: (-10, 2, 171, 1, "IMAGE"),
        34: (172, 0, 173, 1, "CONDITIONING"), 36: (-10, 0, 172, 0, "CLIP"),
        37: (-10, 1, 172, 2, "VAE"), 38: (-10, 2, 172, 1, "IMAGE"),
        39: (180, 0, 173, 2, "BOOLEAN"), 40: (173, 0, -20, 3, "CONDITIONING"),
        42: (-10, 4, 24, 1, "STRING"), 45: (-10, 8, 26, 0, "CLIP"),
        46: (-10, 2, 25, 0, "IMAGE"), 47: (-10, 3, 25, 1, "IMAGE"),
        48: (21, 0, 24, 0, "STRING"), 49: (23, 0, 24, 2, "STRING"),
        50: (24, 0, 26, 4, "STRING"), 51: (25, 0, 26, 1, "IMAGE"),
        52: (26, 0, 27, 0, "STRING"),
    }
    want_eps = {**KEEP, **REDIRECT, **NEW_LINKS}
    assert set(links) == set(want_eps), \
        f"link id 集漂移:多{set(links)-set(want_eps)} 少{set(want_eps)-set(links)}"
    for lid, want in want_eps.items():
        l = links[lid]
        got = (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"])
        assert got == want, f"link{lid} 端点 {got} != {want}"
    report.append("B links:58→49 ✓ 全 49 条端点逐条对拍(保留31+改写10+新增8)"
                  ";\n  ★新增8根(显式列名):60 择文→[141].主体句/61 PE开关→[152]①/"
                  "62 指令→[152]①.装配全文槽/63 [27]抽取文→[152]①.PE出文(lazy)/"
                  "64 rgba_on→[152]①.透明模式/65 BASE→[141]/66 [141]装配全文→[153]②/"
                  "67 rgba_on→[153]②.透明模式")

    # C. 依赖环自查(引擎同款,lazy 边计入;§10.9)
    assert_acyclic(sg)
    report.append("C 无环断言 ✓(引擎 validate_inputs 同款递归,lazy 边计入)"
                  "——数据流:-10槽4→[24]→[26]→[27]→[152]①→[141]→{[142]/[171]/"
                  "-20槽4/[153]②→[143]/[172]},全单向无回边")

    # C2. 防环红线机械断言(map §六红线1/2:装配段出文禁入 PE 链/禁回喂装配段)
    for pe_nid in PE_CHAIN:
        for l in sg["links"]:
            if l["target_id"] == pe_nid:
                assert l["origin_id"] not in (ASM_ID, SEL1_ID, SEL2_ID), \
                    f"红线1违例:装配段件 {l['origin_id']} 喂进 PE 链 node{pe_nid}"
    asm_fanout = {l["target_id"] for l in sg["links"] if l["origin_id"] == ASM_ID}
    sel2_fanout = {l["target_id"] for l in sg["links"] if l["origin_id"] == SEL2_ID}
    sel1_fanout = {l["target_id"] for l in sg["links"] if l["origin_id"] == SEL1_ID}
    assert asm_fanout == {142, 171, -20, SEL2_ID}, f"装配全文消费者漂移:{asm_fanout}"
    assert sel2_fanout == {143, 172}, f"透明文本消费者漂移:{sel2_fanout}"
    assert sel1_fanout == {ASM_ID}, f"Select① 出文消费者漂移:{sel1_fanout}"
    report.append("C2 防环红线 ✓:PE链([21][23][24][25][26][27])入边零装配段件;"
                  "装配全文消费者={[142][171]-20槽4[153]②}/透明文本消费者={[143][172]}/"
                  "择文消费者={[141]}")

    # D. 固定句值迁参数槽逐件 SHA256(术前值→新件槽,链式+default 三方)
    asm, sel1, sel2 = nodes[ASM_ID], nodes[SEL1_ID], nodes[SEL2_ID]
    asm_mod = load_module("my_qi21_prompt_assembly.py")
    sel_mod = load_module("my_qi21_prompt_select.py")
    report.append("D 固定句迁参数槽逐件 SHA256(链式(术前→术后)+件内 default 三方对拍):")
    pairs = [("锁层A [110]→[141].wv[1]", carried["lock_a"], asm["widgets_values"][1], asm_mod._LOCK_A),
             ("RGBA头句 [160]→[153].wv[2]", carried["head"], sel2["widgets_values"][2], sel_mod._RGBA_HEAD),
             ("RGBA尾句 [161]→[153].wv[3]", carried["tail"], sel2["widgets_values"][3], sel_mod._RGBA_TAIL)]
    for name, pre, post, default in pairs:
        if pre is not None:
            assert sha(pre) == sha(post), f"{name} 链式迁移漂移!"
            assert sha(pre) == sha(default), f"{name} 与件内 default 不符!"
            report.append(f"  {name}:sha256={sha(post)} ✓(零改字)")
        else:
            assert sha(post) == sha(default), f"{name} 与件内 default 不符!"
            report.append(f"  {name}:sha256={sha(post)} ✓(verify-only:default 对拍,链式已在 all 模式留痕)")
    assert sel1["widgets_values"][0] is True, "Select① pe开关摆设值应 True(与原[15]一致)"
    assert sel2["widgets_values"][0] is False, "Select② pe开关必须恒 False(纯包裹器语义锚)"
    report.append("  Select① wv[0]=True(原[15]口径)/Select② wv[0]=False(恒pe关)✓")

    # E. 三件接口面(槽名序/口名序/wv 位序;照 t2i 终态形态)
    assert [i["name"] for i in asm["inputs"]] == ["主体句", "锁层A全文", "BASE"]
    assert [o["name"] for o in asm["outputs"]] == ["装配全文"]
    assert len(asm["widgets_values"]) == 2
    for sel in (sel1, sel2):
        assert [i["name"] for i in sel["inputs"]] == \
            ["pe开关", "透明模式", "RGBA官方头句", "RGBA官方尾句", "W1收束句", "装配全文", "PE出文"]
        assert [o["name"] for o in sel["outputs"]] == ["最终文本", "透明文本"]
        assert len(sel["widgets_values"]) == 5
    report.append("E 三件接口面([141]=3槽单口wv2/[152][153]=7槽两口wv5,照t2i形态)✓")

    # F. 关键接线抽验(语义位)
    g = lambda nid: {i["name"]: i.get("link") for i in nodes[nid].get("inputs", [])}
    assert g(24)["values.b"] == 42 and links[42]["origin_id"] == -10 and links[42]["origin_slot"] == 4, \
        "[24].values.b 必须仍吃 -10槽4 裸指令(PE 语义锚,禁装配全文)"
    assert nodes[27]["outputs"][0]["links"] == [63], "[27] 抽取文应单路喂 [152].PE出文(lazy 懒链锚)"
    assert g(SEL1_ID)["PE出文"] == 63 and g(SEL1_ID)["装配全文"] == 62
    assert g(SEL1_ID)["pe开关"] == 61 and g(SEL1_ID)["透明模式"] == 64
    assert g(ASM_ID)["主体句"] == 60 and g(ASM_ID)["BASE"] == 65
    assert g(SEL2_ID)["装配全文"] == 66 and g(SEL2_ID)["透明模式"] == 67
    assert g(SEL2_ID)["pe开关"] is None, "Select② pe开关不接线(恒 widget False)"
    assert g(SEL2_ID)["PE出文"] is None, "Select② PE出文不接线(pe关永不请求,无懒违)"
    assert nodes[SEL1_ID]["outputs"][0]["links"] == [60], "Select① 最终文本单路喂 [141]"
    assert nodes[SEL1_ID]["outputs"][1]["links"] == [], "Select① 透明文本口不接(语义不符)"
    assert nodes[SEL2_ID]["outputs"][0]["links"] == [], "Select② 最终文本口不接(冗余)"
    assert nodes[SEL2_ID]["outputs"][1]["links"] == [20, 35], "Select② 透明文本双喂 [143]/[172]"
    assert sorted(nodes[ASM_ID]["outputs"][0]["links"]) == [15, 25, 31, 66], "装配全文四路扇出"
    report.append("F 关键接线抽验:PE吃裸指令锚/[27]单路lazy喂①/[141]四扇出/[153]②恒pe关双喂 ✓")

    # G. 懒执行语义(静态):Select② check_lazy_status 恒空名单(pe关)
    sel2_inst = sel_mod.MyQi21PromptSelect()
    assert sel2_inst.check_lazy_status(pe开关=False, PE出文=None) == [], "Select② pe关应空名单"
    sel1_inst = sel_mod.MyQi21PromptSelect()
    assert sel1_inst.check_lazy_status(pe开关=False, PE出文=None) == [], "Select① pe关应空名单([26]整链不进执行图)"
    assert sel1_inst.check_lazy_status(pe开关=True, PE出文=None) == ["PE出文"], "Select① pe开应请求 PE出文"
    report.append("G 懒语义静态取证:pe关→[](PE链6件零执行零LLM调用)/pe开→['PE出文'] ✓")

    # H. 引用一致性(零悬空零反向+IO linkIds)
    errs = consistency(d)
    assert errs == [], errs
    report.append("H 引用一致性:零悬空零反向;IO linkIds 逐项登记 ✓")

    # I. 严格右向(塔测试口径:每线 tx > ox,边界线以 IO 槽 pos 计)
    for l in sg["links"]:
        ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 \
            else nodes[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 \
            else nodes[l["target_id"]]["pos"][0]
        assert tx > ox, f"左向/竖塔线 link{l['id']}:ox={ox} tx={tx}"
    report.append("I 严格右向(每线 tx > ox,含 IO 圆点 pos)✓")

    # J. 宿主面板+IO 面零变化(map §5.4.2)
    assert len(sg["inputs"]) == 9 and len(sg["outputs"]) == 5
    assert [s["name"] for s in sg["inputs"]] == \
        ["clip", "vae", "image_1", "image_2", "指令", "型选择", "RGBA透明", "PE开关", "pe_clip"]
    assert [s["name"] for s in sg["outputs"]] == \
        ["positive", "negative", "latent", "positive_single", "prompt"]
    assert len(sg["widgets"]) == 4, "宿主 widgets 4 值零变化(i2i 无画幅联动控件)"
    host40 = next(n for n in d["nodes"] if n["id"] == 40)
    assert len(host40["widgets_values"]) == 4
    assert host40["widgets_values"] == sg["widgets"], "sg.widgets 与宿主 wv 双写一致"
    report.append("J 宿主面板:子图 IO 9入5出/sg.widgets 4值/宿主wv 4值 零变化且双写一致 ✓")

    # K. R2 更名口径
    assert host40["title"] == HOST_TITLE_NEW
    assert sg["name"] == SG_NAME_NEW and sg.get("category") == SG_CATEGORY
    report.append(f"K 更名:宿主 title={HOST_TITLE_NEW!r}/子图 name={SG_NAME_NEW!r}"
                  f"/category={SG_CATEGORY!r}(照 t2i 口径)✓")

    # L. 端到端逻辑等价对拍(all=术前实读原侧;verify=件内 default 原侧)
    equivalence(sg, asm_mod, sel_mod, report,
                "pre" if carried.get("lock_a") is not None else "default", carried)
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
    if state == (17, 49):
        if a.step == "all":
            print("输入态=17件49线(已手术):转 verify-only")
            a.step = "verify"
    elif state != (28, 58):
        print(f"输入态={state[0]}件{state[1]}线:既非原始态(28件58线)也非术后态(17件49线),拒绝"
              "(映射表与实物不符即停手;如需重做请 git checkout -- 工作流文件后重跑)")
        sys.exit(2)
    SNAP_DIR.mkdir(parents=True, exist_ok=True)

    if a.step == "verify":
        carried = {"lock_a": None, "head": None, "tail": None}
        report = ["=" * 72, "qi21-i2i 同构集成手术 verify-only(术后态断言)", "=" * 72]
        errs = verify(d, carried, report)
        print("\n".join(report))
        sys.exit(1 if errs else 0)

    SNAP_DIR.joinpath("before.json").write_text(raw)
    top_before = {k: copy.deepcopy(v) for k, v in d.items() if k != "definitions"}
    report = ["=" * 72, "qi21-i2i [40]装配子图同构集成手术断言账(主案=双Select链,map §5)",
              "  28件58线 → 17件49线(删收编8+Reroute消化6+立3件)", "=" * 72]
    carried = do_surgery(d, report)

    # 顶层零变化(唯宿主[40] title 更名=R2 点名项)
    top_after = {k: copy.deepcopy(v) for k, v in d.items() if k != "definitions"}
    assert top_after["links"] == top_before["links"], "顶层 links 应零变化"
    assert top_after["groups"] == top_before["groups"], "顶层 groups 应零变化"
    assert len(top_after["nodes"]) == len(top_before["nodes"])
    for nb, na in zip(top_before["nodes"], top_after["nodes"]):
        if nb["id"] == 40:
            continue
        assert nb == na, f"顶层 node{nb['id']} 漂移"
    report.append("M 顶层零变化(唯宿主[40] title 更名=R2 点名)✓")

    errs = verify(d, carried, report)
    report += ["=" * 72, "全绿:手术成立,落盘", "=" * 72]
    out = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    SNAP_DIR.joinpath("after.json").write_text(out)
    SNAP_DIR.joinpath("assertions.txt").write_text("\n".join(report) + "\n")
    if errs:
        print("\n".join(report))
        print("断言红,拒绝落盘:", errs)
        sys.exit(1)
    WF.write_text(out)
    print("\n".join(report))
    print(f"已落盘 {WF}")
    print(f"三件套: {SNAP_DIR}/(before.json / after.json / assertions.txt)")


if __name__ == "__main__":
    main()
