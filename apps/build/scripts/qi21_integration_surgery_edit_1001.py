#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-edit [40]装配子图 Select 收编手术(2026-10-01,Trellis 10-01-qi21-i2i-edit-isomorphic
edit 主刀轮;映射表=.trellis/tasks/10-01-qi21-i2i-edit-isomorphic/research/map-edit.md 复核后版;
打法蓝本=archive/2026-10/10-01-qi21-assembly-blueprint design.md §10 接口+§10.9 依赖环裁定
(t2i 实战全部教训);t2i 终态参照=1_文生图/qi21-道劫-t2i.json 10 节两件式链)。

━━ 手术范围(map-edit §三收编映射,唯一收编件=MyQi21PromptSelect)━━━━━━━━━
  1. [15] ComfySwitchNode(指令开关) → [152] MyQi21PromptSelect(最终文本合成器),
     id=152 与 t2i 同构(映射表 §3.1 建议;避开子图已用 {6,15,21,23,24,25,26,27,43}
     与主图/加速子图 id 空间,执行展开安全零撞号)。子图 9→9 节点 25→25 线
     (件型升级非减数,link id 零新零删)。
  2. 端点改写恰 5 根(其余 20 根零动):
     link11 指令(-10槽4)→Select.装配全文槽5   (edit 语境:该槽=指令原文直写路真源)
     link12 PE开关(-10槽5)→Select.pe开关槽0   (宿主面板唯一真源,widget 位保留)
     link19 [27]正则出文→Select.PE出文槽6      (lazy 槽;[27] 唯一消费者=本线)
     link20 Select.最终文本→[6].prompt槽4      (双参考编码)
     link21 Select.最终文本→[43].prompt槽3     (单参考编码)
  3. Select 透明文本口悬空(edit 无 RGBA 编码件,机械双产出无消费者无副作用)。
  4. R2 同名统一(map-edit §六.2 同批过账):宿主 title「[40] 装配子图」→
     「[40] 提示词类型优化子图」;子图 name「[40] 道劫·装配子图(双击进入)」→
     「[40] 提示词类型优化子图(双击进入)」(与 t2i 一致)。
  5. 文案随批勘:子图 groups 两处标题 + 宿主 [11] Note 三处 [15] 表述。
  6. 计数器抬位(只加不减):顶层 last_node_id 59→152、子图 state.lastNodeId 43→152
     (契约 TestCanvasDiscipline.test_id_counters_not_below_actual_max 真值锚)。

━━ 不引入件(map-edit §四证据,不为凑件改文)━━━━━━━━━━━━━━━━━━━━━━
  Assembly 不引入:edit 无三层装配链;[24] StringFormat {a}{b}{c} 零分隔直拼与
    Assembly 三段换行拼不同构,禁改 my_nodes 下不可逐字复刻。
  WhSuggest 不引入:edit 画幅随输入图,子图内零画幅链零 wh_ratio 消费。

━━ 懒执行红利(map-edit §3.2,R4 实弹另轮取证)━━━━━━━━━━━━━━━━━━━━
  Select.check_lazy_status(pe关)→[]:PE出文 不请求→[27] 零消费(唯一消费者=link19)
  →[26] TextGenerate 不进执行图→[25][24][21][23] 随链不进→宿主 [12] PE
  CLIPLoader(仅经 40.pe_clip→link13→[26] 消费)零装载。edit 无 WhSuggest 无
  联动开关,成立条件比 t2i 更宽(pe关即成立,无「×联动关」合取)。

━━ 防环(map-edit §3.3+design §10.9)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  新链 [27]→Select→[6][43] 不回喂 PE 链,无环。verify 内置引擎 validate_inputs
  同款递归环检(lazy 边计入,无豁免——t2i S8 教训在档)作落盘前守门。

━━ 固定句账(map-edit §五:不迁移,原 widget 留住防误伤)━━━━━━━━━━━━━━
  [21] chatml system 段 17756 字 sha16=47771cbd03887c8a、[23] 尾段 41 字
  sha16=6e15548abe3a54a8:手术后此二锚应不变(误伤即红)。
  Select 三固定句(头/尾/W1)=t2i [152] 工作流值程序提取(禁手敲),并与
  my_qi21_prompt_select.py 源码 default 双源 SHA256 对拍。

━━ 边界与波及纪律 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  只改 edit.json 与本脚本(并行会话点名文件边界);禁改 my_nodes;禁手工编辑
  工作流 JSON;子图边界 IO(7入4出)与宿主面板(指令/PE开关两控)零变化;
  顶层除 [40].title(R2)/[11] Note(文案三处)/last_node_id(抬位)外零变化。
  契约测试锁旧锚(ASG_IDS 含 15/旧命名)的预期红由测试轮单点串行收口
  (PRD R2:测试文件单点串行改,防并行冲突),本脚本不越界改测试。

手术三件套:apps/output/qi21-integration-surgery-edit-1001/
  {before.json, after.json, assertions.txt}
铁律:fail-closed,断言不过不落盘。

用法:python3 apps/build/scripts/qi21_integration_surgery_edit_1001.py --step all|verify
  输入态识别:9件25线且[15]在场=可手术 / 9件25线且[152]在场=已手术(转
  verify-only) / 其它=拒(2)。
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
T2I = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
NODES_DIR = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes"
SG_UUID = "6a0e2f81-1a4b-4c2d-9e30-5b7c8d9e0f01"
SNAP_DIR = ROOT / "apps/output/qi21-integration-surgery-edit-1001"

SEL_ID = 152   # MyQi21PromptSelect(新)
OLD_ID = 15    # ComfySwitchNode(gone,唯一)

# 术前固定句锚(map-edit §五;误伤即红)
FIXED_ANCHORS = {21: ("47771cbd03887c8a", 17756), 23: ("6e15548abe3a54a8", 41)}

# ── 术前全 25 线端点表(map-edit §一实查;前置锚=漂移态上跑即拒)──────────
PRE_LINKS = {
    1: (-10, 0, 6, 0, "CLIP"), 2: (-10, 0, 43, 0, "CLIP"),
    3: (-10, 1, 6, 2, "VAE"), 4: (-10, 1, 43, 2, "VAE"),
    5: (-10, 2, 6, 1, "IMAGE"), 6: (-10, 2, 43, 1, "IMAGE"),
    7: (-10, 2, 25, 0, "IMAGE"), 8: (-10, 3, 6, 3, "IMAGE"),
    9: (-10, 3, 25, 1, "IMAGE"), 10: (-10, 4, 24, 1, "STRING"),
    11: (-10, 4, OLD_ID, 0, "STRING"), 12: (-10, 5, OLD_ID, 2, "BOOLEAN"),
    13: (-10, 6, 26, 0, "CLIP"),
    14: (21, 0, 24, 0, "STRING"), 15: (23, 0, 24, 2, "STRING"),
    16: (24, 0, 26, 4, "STRING"), 17: (25, 0, 26, 1, "IMAGE"),
    18: (26, 0, 27, 0, "STRING"), 19: (27, 0, OLD_ID, 1, "STRING"),
    20: (OLD_ID, 0, 6, 4, "STRING"), 21: (OLD_ID, 0, 43, 3, "STRING"),
    22: (6, 0, -20, 0, "CONDITIONING"), 23: (6, 1, -20, 1, "CONDITIONING"),
    24: (6, 2, -20, 2, "LATENT"), 25: (43, 0, -20, 3, "CONDITIONING"),
}
# 术后端点改写恰 5 根(11/12/19/20/21),其余 20 根端点逐字不变
REDIRECT = {
    11: (-10, 4, SEL_ID, 5, "STRING"),    # 指令→装配全文槽(pe关=直写真源)
    12: (-10, 5, SEL_ID, 0, "BOOLEAN"),   # PE开关→pe开关槽(widget 位保留)
    19: (27, 0, SEL_ID, 6, "STRING"),     # [27]出文→PE出文(lazy;[27]唯一消费者)
    20: (SEL_ID, 0, 6, 4, "STRING"),      # 最终文本→[6].prompt
    21: (SEL_ID, 0, 43, 3, "STRING"),     # 最终文本→[43].prompt
}
POST_LINKS = {**PRE_LINKS, **REDIRECT}

# ── R2 同名统一(t2i 口径)────────────────────────────────────────────
HOST_TITLE_OLD, HOST_TITLE_NEW = "[40] 装配子图", "[40] 提示词类型优化子图"
SG_NAME_OLD, SG_NAME_NEW = ("[40] 道劫·装配子图(双击进入)",
                            "[40] 提示词类型优化子图(双击进入)")

# ── 文案随批勘(子图 groups 两处+宿主 [11] Note 三处;old 串精确唯一)─────
GROUP_EDITS = [
    ("[27]正则→[15]开关;", "[27]正则→[152]最终文本合成器;"),
    ("词源同 [15])", "词源同 [152])"),
]
NOTE11_EDITS = [
    ("词源与 [6] 同源=[15] PE 开关)。",
     "词源与 [6] 同源=[152] PE 路选择)。"),
    ("→ [15] ComfySwitch(false=[22] 原始用户词/true=PE 结果;switch=宿主面板「PE开关」外露)。",
     "→ [152] MyQi21PromptSelect 最终文本合成器(pe关=装配全文槽=[22] 原始用户词直写/"
     "pe开=PE 出文;pe开关=宿主面板「PE开关」外露;1001 edit 同构收编=ComfySwitch 退役)。"),
    ("(ComfySwitchNode 懒执行,PE 模型不加载)",
     "(MyQi21PromptSelect.PE出文 lazy+check_lazy_status,PE 模型不加载;1001 同构收编后=真懒执行)"),
]

SELECT_TITLE = ("最终文本合成器(pe开=PE出文/pe关=指令直写;edit 同构收编,"
                "透明文本悬空=无 RGBA 编码件)")
SELECT_POS, SELECT_SIZE = [3360, 2360], [380, 260]   # 原 [15] 位;右缘3740<[6].x3760 零重叠


def sha16(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def load_module(fname: str):
    spec = importlib.util.spec_from_file_location(fname, NODES_DIR / fname)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def assert_acyclic(sg):
    """引擎 validate_inputs 同款环检(全部连线输入递归,lazy 边计入无豁免;
    t2i S8 教训=queuePrompt 验证层拒环,执行层豁免救不了)。落盘前守门。"""
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
    """引用一致性:零悬空零反向+边界 IO linkIds 逐项登记(t2i 同款)。"""
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
    """按 links 真值重建节点 input.link/output.links 与边界 IO linkIds。"""
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
    """[152] MyQi21PromptSelect 节点(槽序=INPUT_TYPES 定义,与 t2i [152] 同构;
    wv=[pe开关,透明模式,头,尾,W1] 5 项,固定句=程序提取值禁手敲)。"""
    return {
        "id": SEL_ID, "type": "MyQi21PromptSelect",
        "title": SELECT_TITLE,
        "pos": list(SELECT_POS), "size": list(SELECT_SIZE),
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


def t2i_select_fixed_strings() -> list:
    """三固定句从 t2i [152] 工作流值程序提取(禁手敲),并与源码 default 对拍。"""
    t2i = json.loads(T2I.read_text())
    sel = next(n for n in t2i["definitions"]["subgraphs"][0]["nodes"]
               if n["id"] == 152 and n["type"] == "MyQi21PromptSelect")
    wv = sel["widgets_values"]
    assert len(wv) == 5 and wv[0] is True and wv[1] is False, \
        f"t2i [152] widgets 形态漂移:{[type(v).__name__ for v in wv]}"
    mod = load_module("my_qi21_prompt_select.py")
    for got, want, name in ((wv[2], mod._RGBA_HEAD, "RGBA官方头句"),
                            (wv[3], mod._RGBA_TAIL, "RGBA官方尾句"),
                            (wv[4], mod._W1_TAIL, "W1收束句")):
        assert sha16(got) == sha16(want), \
            f"双源漂移:t2i 工作流值 != 源码 default({name})"
    return list(wv)


def pre_anchors(d):
    """前置锚:输入态必须=映射表实查态,漂移即拒(fail-closed)。"""
    sg = d["definitions"]["subgraphs"][0]
    assert sg["id"] == SG_UUID, "子图 uuid 漂移,拒绝手术"
    assert len(sg["nodes"]) == 9 and len(sg["links"]) == 25, \
        f"前置锚:应 9件25线(映射表 §一),得 {len(sg['nodes'])}件{len(sg['links'])}线"
    nodes = {n["id"]: n for n in sg["nodes"]}
    assert OLD_ID in nodes and SEL_ID not in nodes, "前置锚:[15] 应在场/[152] 应未占用"
    old = nodes[OLD_ID]
    assert old["type"] == "ComfySwitchNode", f"[15] 应 ComfySwitchNode,得 {old['type']}"
    assert [i["name"] for i in old["inputs"]] == ["on_false", "on_true", "switch"], \
        "[15] 输入槽序漂移"
    assert [i.get("link") for i in old["inputs"]] == [11, 19, 12], "[15] 三线位漂移"
    assert old["outputs"][0]["links"] == [20, 21], "[15] 双扇出漂移"
    links = {l["id"]: l for l in sg["links"]}
    assert set(links) == set(PRE_LINKS), \
        f"link id 集漂移:多{set(links)-set(PRE_LINKS)} 少{set(PRE_LINKS)-set(links)}"
    for lid, want in PRE_LINKS.items():
        l = links[lid]
        got = (l["origin_id"], l["origin_slot"], l["target_id"],
               l["target_slot"], l["type"])
        assert got == want, f"术前 link{lid} 端点 {got} != 实查锚 {want}(输入态漂移)"
    for nid, (want_sha, want_len) in FIXED_ANCHORS.items():
        v = nodes[nid]["widgets_values"][0]
        assert len(v) == want_len and sha16(v) == want_sha, \
            f"术前固定句锚 [{nid}] 漂移:len={len(v)} sha16={sha16(v)}"
    host = next(n for n in d["nodes"] if n["id"] == 40)
    assert host["title"] == HOST_TITLE_OLD, f"宿主 title 前置锚漂移:{host.get('title')!r}"
    assert sg["name"] == SG_NAME_OLD, f"子图 name 前置锚漂移:{sg['name']!r}"


def do_surgery(d, report):
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}

    # ① 三固定句双源提取(t2i 工作流值==源码 default,禁手敲)
    wv = t2i_select_fixed_strings()
    report.append(f"① 三固定句双源 SHA256 对拍 ✓ 头={sha16(wv[2])} "
                  f"尾={sha16(wv[3])} W1={sha16(wv[4])}(t2i[152]==源码 default)")

    # ② 删 [15] 立 [152](沿原 order=6/原位坐标)
    order = nodes[OLD_ID]["order"]
    sg["nodes"] = [n for n in sg["nodes"] if n["id"] != OLD_ID]
    sg["nodes"].append(make_select(order, wv))

    # ③ 端点改写恰 5 根
    links = {l["id"]: l for l in sg["links"]}
    for lid, (o, os_, t, ts, ty) in REDIRECT.items():
        links[lid].update(origin_id=o, origin_slot=os_,
                          target_id=t, target_slot=ts, type=ty)

    # ④ R2 同名统一(宿主 title+子图 name)
    host = next(n for n in d["nodes"] if n["id"] == 40)
    host["title"] = HOST_TITLE_NEW
    sg["name"] = SG_NAME_NEW

    # ⑤ 文案随批勘(groups 两处:恰命中1处才替换;[11] Note 三处:old 不在场即红)
    for old, new in GROUP_EDITS:
        hits = [g for g in sg["groups"] if old in g["title"]]
        assert len(hits) == 1, \
            f"groups 文案锚命中 {len(hits)} 处(应恰1,账漂移):{old[:30]}…"
        hits[0]["title"] = hits[0]["title"].replace(old, new)
    n11 = next(n for n in d["nodes"] if n["id"] == 11)
    content = n11["widgets_values"][0]
    for old, new in NOTE11_EDITS:
        assert old in content, f"[11] Note 文案锚不在场(账漂移):{old[:40]}…"
        content = content.replace(old, new)
    n11["widgets_values"][0] = content

    # ⑥ 计数器抬位(只加不减;id 分配器真值锚)
    d["last_node_id"] = max(d.get("last_node_id", 0), SEL_ID)
    sg["state"]["lastNodeId"] = max(sg["state"].get("lastNodeId", 0), SEL_ID)

    # ⑦ 引用重建
    rebuild_refs(sg)
    return {}


def verify(d, carried, report):
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}

    # A. 节点 9 件成员集(15 位被 Select 顶替,件型升级非减数)
    assert len(sg["nodes"]) == 9, f"节点数应 9,得 {len(sg['nodes'])}"
    want_ids = sorted([6, 21, 23, 24, 25, 26, 27, 43, SEL_ID])
    assert sorted(nodes) == want_ids, f"成员集漂移:{sorted(nodes)}"
    assert OLD_ID not in nodes, "[15] 应已退役"
    assert nodes[SEL_ID]["type"] == "MyQi21PromptSelect"
    assert nodes[6]["type"] == nodes[43]["type"] == "TextEncodeQwenImage21"
    assert nodes[26]["type"] == "TextGenerate" and nodes[27]["type"] == "RegexExtract"
    report.append(f"A 节点:9→9 ✓(15 ComfySwitch→152 MyQi21PromptSelect)成员={want_ids}")

    # B. links 25 条零新零删+端点逐条对拍(20 承接+5 改写)
    assert len(sg["links"]) == 25 and set(links) == set(POST_LINKS), \
        f"link id 集漂移:{sorted(links)}"
    for lid, want in POST_LINKS.items():
        l = links[lid]
        got = (l["origin_id"], l["origin_slot"], l["target_id"],
               l["target_slot"], l["type"])
        assert got == want, f"link{lid} 端点 {got} != {want}"
    report.append("B links:25→25 ✓ 零新零删;端点逐条对拍 ✓(20 承接+5 改写"
                  " 11/12/19/20/21)")

    # C. 无环断言(引擎 validate_inputs 同款,lazy 边计入)
    assert_acyclic(sg)
    report.append("C 无环断言(引擎同款递归,lazy 边计入)✓ "
                  "——新链 [27]→[152]→[6][43] 无回边,不触发 §10.9 环检")

    # D. 固定句:[21][23] 原锚不变(防误伤)+[152] 三固定句双源
    for nid, (want_sha, want_len) in FIXED_ANCHORS.items():
        v = nodes[nid]["widgets_values"][0]
        assert len(v) == want_len and sha16(v) == want_sha, \
            f"术后固定句锚 [{nid}] 误伤:len={len(v)} sha16={sha16(v)}"
    report.append(f"D 固定句 ✓ [21] sha16={FIXED_ANCHORS[21][0]} / "
                  f"[23] sha16={FIXED_ANCHORS[23][0]} 不变(chatml 两段原 widget 留住)")
    wv = nodes[SEL_ID]["widgets_values"]
    assert len(wv) == 5 and wv[0] is True and wv[1] is False, \
        f"[152] widgets 形态漂移:{wv[:2]}"
    if carried.get("check_dual_source", True):
        mod = load_module("my_qi21_prompt_select.py")
        for got, want, name in ((wv[2], mod._RGBA_HEAD, "RGBA官方头句"),
                                (wv[3], mod._RGBA_TAIL, "RGBA官方尾句"),
                                (wv[4], mod._W1_TAIL, "W1收束句")):
            assert sha16(got) == sha16(want), \
                f"[152] {name} 与源码 default 漂移:{sha16(got)}!={sha16(want)}"
        report.append(f"  [152] 三固定句==源码 default ✓ 头={sha16(wv[2])} "
                      f"尾={sha16(wv[3])} W1={sha16(wv[4])}")

    # E. Select 接口面(槽名序/口名序/接线位)
    sel = nodes[SEL_ID]
    assert [i["name"] for i in sel["inputs"]] == \
        ["pe开关", "透明模式", "RGBA官方头句", "RGBA官方尾句", "W1收束句",
         "装配全文", "PE出文"], "Select 输入槽名序漂移"
    assert [o["name"] for o in sel["outputs"]] == ["最终文本", "透明文本"], \
        "Select 输出口名序漂移"
    assert [i.get("link") for i in sel["inputs"]] == [12, None, None, None, None, 11, 19], \
        "Select 七槽接线位漂移(pe开关←12/装配全文←11/PE出文←19,余 widget)"
    assert sel["outputs"][0]["links"] == [20, 21], "最终文本口应双扇出 [6][43]"
    assert sel["outputs"][1]["links"] == [], "透明文本口应悬空(edit 无 RGBA 件)"
    report.append("E Select 接口面 ✓ 7槽(3接线:12/11/19)+两口(最终文本→20/21,"
                  "透明文本悬空)")

    # F. 懒执行静态取证(实弹 R4 另轮):[27] 唯一消费者=Select.PE出文
    r27 = nodes[27]
    assert r27["outputs"][0]["links"] == [19], \
        f"[27] 输出消费者应唯一线19(Select.PE出文),得 {r27['outputs'][0]['links']}"
    mod = load_module("my_qi21_prompt_select.py")
    inst = mod.MyQi21PromptSelect()
    assert inst.check_lazy_status(pe开关=False, PE出文=None) == [], \
        "pe关应零请求(PE 链不进执行图)"
    assert inst.check_lazy_status(pe开关=True, PE出文=None) == ["PE出文"], \
        "pe开且未求值应请求 PE出文"
    assert inst.check_lazy_status(pe开关=True, PE出文="已求值") == [], \
        "已求值应放行"
    report.append("F 懒执行静态取证 ✓ [27]唯一消费者=152.PE出文;源码实调 "
                  "check_lazy_status(pe关)→[] ⇒ pe关时 [26]/[25]/[24]/[21]/[23] "
                  "整链不进执行图,宿主 [12] PE CLIPLoader 零装载(edit 无联动开"
                  "关,成立条件宽于 t2i)")

    # G. 语义等价取证(compose 实调,≡原 [15] switch 双路)
    final_on, _ = inst.compose(pe开关=True, 透明模式=False,
                               装配全文="指令X", PE出文="PE结果Y")
    final_off, _ = inst.compose(pe开关=False, 透明模式=False,
                                装配全文="指令X", PE出文=None)
    assert final_on == "PE结果Y" and final_off == "指令X", \
        f"compose 语义漂移:pe开={final_on!r} pe关={final_off!r}"
    report.append("G 语义等价取证 ✓ compose(pe开)=PE出文≡原[15].on_true;"
                  "compose(pe关)=装配全文槽值=指令原文≡原[15].on_false 零改写")

    # H. 引用一致性(零悬空零反向+IO linkIds 逐项)
    errs = consistency(d)
    assert errs == [], errs
    report.append("H 引用一致性 ✓ 零悬空零反向;-10/-20 linkIds 逐项登记")

    # I. 边界 IO 零变化(7入4出:name/type/pos/linkIds 全等;收编只在子图内部)
    want_in = [("clip", "CLIP"), ("vae", "VAE"), ("image_1", "IMAGE"),
               ("image_2", "IMAGE"), ("指令", "STRING"), ("PE开关", "BOOLEAN"),
               ("pe_clip", "CLIP")]
    want_out = [("positive", "CONDITIONING"), ("negative", "CONDITIONING"),
                ("latent", "LATENT"), ("positive_single", "CONDITIONING")]
    assert [(i["name"], i["type"]) for i in sg["inputs"]] == want_in, "入槽漂移"
    assert [(o["name"], o["type"]) for o in sg["outputs"]] == want_out, "出槽漂移"
    for slot, io in enumerate(sg["inputs"]):
        want = sorted(l["id"] for l in sg["links"]
                      if l["origin_id"] == -10 and l["origin_slot"] == slot)
        assert sorted(io["linkIds"]) == want, f"入槽{slot}({io['name']}) linkIds 漂移"
    for slot, io in enumerate(sg["outputs"]):
        want = sorted(l["id"] for l in sg["links"]
                      if l["target_id"] == -20 and l["target_slot"] == slot)
        assert sorted(io["linkIds"]) == want, f"出槽{slot}({io['name']}) linkIds 漂移"
    report.append("I 边界 IO 零变化 ✓ 7入4出逐字;linkIds 归集不变"
                  "(线11/12 origin(-10,槽4/5) 未动)")

    # J. 宿主面板零变化(指令/PE开关两控;契约 L1185-1197 口径)
    host = next(n for n in d["nodes"] if n["id"] == 40)
    assert host["widgets_values"] == [
        "Put the light blue denim shirt from <image2> on the character in <image1>,"
        " keep everything else unchanged", True], "宿主 widgets_values 漂移"
    assert host.get("widgets_values_named") == {
        "指令": host["widgets_values"][0], "PE开关": True}, "具名镜像漂移"
    assert sg["widgets"] == host["widgets_values"], "sg.widgets 双写漂移"
    pe_sw = next(i for i in host["inputs"] if i["name"] == "PE开关")
    assert pe_sw.get("link") is None and "widget" in pe_sw, "PE开关应纯面板控件"
    report.append("J 宿主面板零变化 ✓ widgets 双写同值;PE开关纯面板控件")

    # K. R2 同名统一生效(t2i 口径)
    assert host["title"] == HOST_TITLE_NEW, f"宿主 title 应={HOST_TITLE_NEW!r}"
    assert sg["name"] == SG_NAME_NEW, f"子图 name 应={SG_NAME_NEW!r}"
    report.append(f"K R2 同名统一 ✓ 宿主 title「{HOST_TITLE_NEW}」/子图 name"
                  f"「{SG_NAME_NEW}」(契约旧名断言=预期红,测试轮收口)")

    # L. 计数器真值锚(只加不减;顶层含子图空间)
    max_nid = max([n["id"] for n in d["nodes"]]
                  + [n["id"] for n in sg["nodes"]]
                  + [n["id"] for s in d["definitions"]["subgraphs"]
                     for n in s["nodes"]])
    assert d["last_node_id"] >= max_nid, \
        f"last_node_id={d['last_node_id']} < 实存最大 {max_nid}(id 分配器将撞车)"
    assert d["last_node_id"] == SEL_ID, "last_node_id 应恰抬至 152"
    assert sg["state"]["lastNodeId"] == SEL_ID, "子图 state.lastNodeId 应=152"
    assert d["last_link_id"] == 69, "顶层 last_link_id 应 69(零新线)"
    assert sg["state"]["lastLinkId"] == 25, "子图 lastLinkId 应 25(零新线)"
    report.append(f"L 计数器 ✓ 顶层 last_node_id 59→152/子图 state.lastNodeId "
                  f"43→152;last_link_id 69/25 不变(零新线零新节点外 id)")

    # M. 顶层零变化:除 [40].title(R2)/[11].Note(文案)/last_node_id(抬位)
    #    外 nodes/links/groups 逐字相等(K 项断言在 caller 侧对 before 快照做)
    top_ids = sorted(n["id"] for n in d["nodes"])
    assert top_ids == sorted([1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 16, 17, 18, 19,
                              20, 22, 28, 29, 40, 58]), f"主图 census 漂移:{top_ids}"
    report.append("M 主图 census 20 件零变化 ✓(契约 MAIN_IDS 口径)")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all", choices=["all", "verify"])
    a = ap.parse_args()
    raw = WF.read_text()
    d = json.loads(raw)
    sg = d["definitions"]["subgraphs"][0]
    ids = {n["id"] for n in sg["nodes"]}
    if len(sg["nodes"]) == 9 and len(sg["links"]) == 25 and SEL_ID in ids \
            and a.step == "all":
        print("输入态=已手术(9件25线且[152]在场):转 verify-only")
        a.step = "verify"
    elif a.step == "all":
        pre_anchors(d)   # 9件25线且[15]在场=可手术;否则 assert 拒(fail-closed)
    SNAP_DIR.mkdir(parents=True, exist_ok=True)

    if a.step == "verify":
        report = ["(verify-only:术前锚与顶层零变化对拍已在 all 模式执行)"]
        errs = verify(d, {"check_dual_source": True}, report)
        print("\n".join(report))
        sys.exit(1 if errs else 0)

    SNAP_DIR.joinpath("before.json").write_text(raw)
    top_before = {k: copy.deepcopy(v) for k, v in d.items() if k != "definitions"}
    report = ["=" * 72,
              "qi21-edit Select 收编手术断言账(map-edit §三;唯一收编件=MyQi21PromptSelect)",
              "=" * 72]
    do_surgery(d, report)

    # 顶层零变化对拍(白名单外逐字相等;白名单=[40].title(R2)/[11].wv(文案)/
    # last_node_id(抬位))
    top_after = {k: copy.deepcopy(v) for k, v in d.items() if k != "definitions"}
    assert top_after["links"] == top_before["links"], "顶层 links 应零变化"
    assert top_after["groups"] == top_before["groups"], "顶层 groups 应零变化"
    assert len(top_after["nodes"]) == len(top_before["nodes"])
    for nb, na in zip(top_before["nodes"], top_after["nodes"]):
        assert nb["id"] == na["id"], "顶层节点序漂移"
        if nb["id"] in (40, 11):
            continue
        assert nb == na, f"顶层 node{nb['id']} 漂移"
    n11 = next(n for n in d["nodes"] if n["id"] == 11)
    for token in ("MyQi21PromptSelect", "[152]", "最终文本合成器", "真懒执行"):
        assert token in n11["widgets_values"][0], f"[11] Note 缺新锚 token:{token}"
    for gone in ("[15] ComfySwitch(", "=[15] PE 开关", "ComfySwitchNode 懒执行"):
        assert gone not in n11["widgets_values"][0], f"[11] Note 残留旧表述:{gone}"
    report.append("N 顶层零变化 ✓ 唯 [40].title(R2)/[11] Note(三处文案)/"
                  "last_node_id(59→152);links/groups/其余 18 节点逐字相等")

    errs = verify(d, {}, report)
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
