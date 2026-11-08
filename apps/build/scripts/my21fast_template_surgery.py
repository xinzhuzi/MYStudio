#!/usr/bin/env python3
"""my21fast-1025 序4:四靶模板手术(t2i 换类+级联删 4016 / i2i 双换类 / edit+镜像子图双换类)。

三模式:
  --dry-run   只核断言与终态特征,分类 [APPLY-READY / ALREADY-DONE / PARTIAL / BROKEN];
  --apply     逐字节备份进 apps/output/bak/my21fast-1025/surgery/(first-run-wins)→
              temp+os.replace 原子写;PARTIAL 拒 apply(提示先 --restore);
  --restore   从 surgery/ 备份逐字节还原(备份缺位=拒)。

硬约束(脚本内断言,fail-closed):
  · cfg=1 前置(定谳5):三画布含全部子图定义的 KSampler widgets_values[3]==1
    + 全仓 workflows/与 my_nodes/subgraphs 零 CFGGuider;不过即全局拒改;
  · 除目标 TE 节点外任何节点对象/连线字节级不动(canonical JSON 等价断言);
  · 目标 TE 节点标题保留;
  · 摘 4016 走通用级联删(定谳3):枚举 target_id==4016 全部入线(恰={209,4304},
    多/少即 fail-closed),从 origin.outputs 摘除+links 删除;
  · 术后逐文件 json.load 复验+打印 TE 前后对照与摘除连线账目。

预登记断言集(前轮亲验现值):
  t2i  :4015/4016 现型==TextEncodeQwenImage21;4016 入线集恰={209,4304};
        出线恰={17(→[7].in2)};4015.negative 现零接线;link17=(17,4016,0,7,2);
        [6].outputs 负向槽 links==[209,217];4204.outputs[0].links==[4304]。
  i2i  :4015 入线集恰={268,270,272,274,275,277,4410};171 入线集恰=
        {269,271,273,276,278,4411};仅双换类,4410/4411/280/282 全保留。
  edit :子图 def 6a0e2f81 内 4015/4016 双 TE 换类;子图 links(list[dict])
        数不变;宿主边界四出零改动。
  mirror:同 def 双 TE 换类;4013 等非 TE 节点零动;links 长度 26 不变。

幂等三态:未手术(断言全过→apply)/已手术(终态特征全中→already-done)/
半途 PARTIAL(部分中且部分断言败→打印明细拒 apply)。

api 两件(qwen21-道劫-{t2i,i2i}-api.json)不在本脚本;禁 git add/commit。
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
APP = REPO / "apps"
T2I = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
I2I = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
EDIT = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
MIRROR = APP / "backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json"
WORKFLOWS_DIR = APP / "backend/comfyui/workflows"
SUBGRAPH_DIR = APP / "backend/comfyui/my_nodes/subgraphs"
BAK_DIR = APP / "output/bak/my21fast-1025/surgery"

OFFICIAL = "TextEncodeQwenImage21"
FAST = "MyQi21FastEncode"
EDIT_SG_ID = "6a0e2f81-1a4b-4c2d-9e30-5b7c8d9e0f01"


def _flat(path: Path) -> str:
    return str(path.relative_to(REPO)).replace("/", "__")


def _load(path: Path) -> tuple[dict, str]:
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    # 字节风格钉:原文件必须能被 indent=2 往返复现(保字节风格的前提)
    dumped = json.dumps(doc, ensure_ascii=False, indent=2)
    assert dumped == raw or dumped + "\n" == raw, f"{path.name}: 非本脚本认定的字节风格"
    return doc, raw


def _dump_like(doc: dict, raw: str) -> str:
    s = json.dumps(doc, ensure_ascii=False, indent=2)
    return s + "\n" if raw.endswith("\n") else s


def _nodes_map(scope: dict) -> dict:
    return {n["id"]: n for n in scope["nodes"]}


def _sg_def(doc: dict, sg_id: str) -> dict:
    for sg in doc.get("definitions", {}).get("subgraphs", []):
        if sg["id"] == sg_id:
            return sg
    raise AssertionError(f"子图 def {sg_id} 缺席")


def _input_link_ids(node: dict) -> set:
    return {i["link"] for i in node.get("inputs", []) if i.get("link") is not None}


def _output_link_ids(node: dict) -> set:
    out = set()
    for o in node.get("outputs", []):
        out.update(o.get("links") or [])
    return out


# ——cfg=1 前置断言(定谳5;全局,不过即拒)———————————————————————————————

def assert_cfg_lock() -> None:
    canvases = {"t2i": T2I, "i2i": I2I, "edit": EDIT}
    for name, path in canvases.items():
        doc, _ = _load(path)
        scopes = [doc] + doc.get("definitions", {}).get("subgraphs", [])
        for scope in scopes:
            for n in scope.get("nodes", []):
                if n.get("type") == "KSampler":
                    wv = n.get("widgets_values")
                    assert isinstance(wv, list) and len(wv) > 3 and wv[3] == 1, \
                        f"cfg 前置败:{name} 节点 {n['id']} cfg={wv[3] if wv else None}≠1(定谳5 拒改)"
    hits = []
    for base in (WORKFLOWS_DIR, SUBGRAPH_DIR):
        for p in base.rglob("*.json"):
            if p.name.startswith("."):
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            if "CFGGuider" in text:
                hits.append(str(p.relative_to(REPO)))
    assert not hits, f"cfg 前置败:CFGGuider 消费面在场 {hits}(定谳5 拒改)"


# ——三态特征采集—————————————————————————————————————————————————————————

class Target:
    def __init__(self, key: str, path: Path):
        self.key = key
        self.path = path
        self.doc, self.raw = _load(path)
        self.pre_fail: list[str] = []      # 未手术态断言失败项
        self.done_fail: list[str] = []     # 终态特征失败项

    def state(self) -> str:
        if not self.pre_fail and not self.done_fail:
            return "BROKEN(前后态特征同时全中——不可态)"
        if not self.pre_fail:
            return "APPLY-READY"
        if not self.done_fail:
            return "ALREADY-DONE"
        return "PARTIAL"


# ——t2i———————————————————————————————————————————————————————————————————

def t2i_preconditions(t: Target) -> None:
    doc = t.doc
    nodes = _nodes_map(doc)
    links = {l[0]: l for l in doc["links"]}

    def need(cond: bool, msg: str):
        if not cond:
            t.pre_fail.append(msg)

    n15, n16 = nodes.get(4015), nodes.get(4016)
    need(n15 is not None and n15["type"] == OFFICIAL, "4015 缺席或现型≠官方 TE")
    need(n16 is not None and n16["type"] == OFFICIAL, "4016 缺席或现型≠官方 TE")
    if n15 is None or n16 is None:
        return
    need(_input_link_ids(n16) == {209, 4304}, f"4016 入线集≠{{209,4304}}: {_input_link_ids(n16)}")
    need(_output_link_ids(n16) == {17}, f"4016 出线≠{{17}}: {_output_link_ids(n16)}")
    need(17 in links and links[17] == [17, 4016, 0, 7, 2, "CONDITIONING"],
         f"link17 现值≠(17,4016,0,7,2): {links.get(17)}")
    need(n15["outputs"][1].get("links") == [], f"4015.negative 现非零接线: {n15['outputs'][1].get('links')}")
    host6 = nodes.get(6)
    need(host6 is not None and host6["outputs"][1].get("links") == [209, 217],
         f"[6].outputs 负向槽 links≠[209,217]: {host6['outputs'][1].get('links') if host6 else None}")
    n4204 = nodes.get(4204)
    need(n4204 is not None and n4204["outputs"][0].get("links") == [4304],
         f"4204.outputs[0].links≠[4304]: {n4204['outputs'][0].get('links') if n4204 else None}")
    # 摘除账目预登记:4016 全部入线恰两根(级联删 fail-closed 前置)
    incoming = [l for l in doc["links"] if l[3] == 4016]
    need(len(incoming) == 2, f"4016 入线枚举≠2(级联删前置败): {[l[0] for l in incoming]}")


def t2i_terminal(t: Target) -> None:
    doc = t.doc
    nodes = _nodes_map(doc)
    links = {l[0]: l for l in doc["links"]}

    def need(cond: bool, msg: str):
        if not cond:
            t.done_fail.append(msg)

    n15, n16 = nodes.get(4015), nodes.get(4016)
    need(n16 is None, f"4016 未删(仍在场: {n16['type'] if n16 else None})")
    need(n15 is not None and n15["type"] == FAST, "4015 未换类(缺或非 MyQi21FastEncode)")
    need(n15 is not None and n15.get("properties", {}).get("Node name for S&R") == FAST,
         "4015 properties['Node name for S&R'] 未随换类(搜索替换漂移)")
    need(209 not in links and 4304 not in links, f"links 209/4304 未删净: {[k for k in (209, 4304) if k in links]}")
    need(17 in links and links[17] == [17, 4015, 1, 7, 2, "CONDITIONING"],
         f"link17 终态≠(17,4015,1,7,2): {links.get(17)}")


def _swap_class(node: dict, account: dict, nid) -> None:
    """换类+随动 S&R 属性(properties['Node name for S&R'] 镜像类名;换类不随
    =画布搜索替换漂移)。标题保留。"""
    account["te_before"][nid] = node["type"]
    account["te_titles"][nid] = node.get("title")
    node["type"] = FAST
    props = node.get("properties")
    if isinstance(props, dict) and props.get("Node name for S&R") == OFFICIAL:
        props["Node name for S&R"] = FAST
        account.setdefault("sr_props_swapped", []).append(nid)


def t2i_operate(doc: dict) -> dict:
    """换类+级联删 4016+link17 复用改写;返回账目。"""
    nodes = _nodes_map(doc)
    n15, n16 = nodes[4015], nodes[4016]
    account = {"target": "t2i", "te_before": {}, "te_titles": {},
               "deleted_links": [], "rewritten_links": [], "pruned_origin_slots": []}
    _swap_class(n15, account, 4015)
    account["te_before"][4016] = n16["type"]  # 4016 亲读账(整节点将删)
    # 通用级联删(定谳3):枚举 4016 全部入线(恰 {209,4304},t2i_preconditions 已锁)
    incoming = {l[0]: l for l in doc["links"] if l[3] == 4016}
    assert set(incoming) == {209, 4304}, f"级联删入线集漂移: {set(incoming)}"
    for lid, l in incoming.items():
        origin = nodes[l[1]]
        slot = origin["outputs"][l[2]]
        kept = [x for x in (slot.get("links") or []) if x != lid]
        slot["links"] = kept
        account["pruned_origin_slots"].append({"link": lid, "origin": l[1], "slot": l[2], "kept": kept})
    doc["links"] = [l for l in doc["links"] if l[3] != 4016]
    account["deleted_links"] = sorted(incoming)
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != 4016]
    # link17 复用改写:origin 4016.s0 → 4015.s1(negative 出口;新类负面直通正向)
    for l in doc["links"]:
        if l[0] == 17:
            assert l == [17, 4016, 0, 7, 2, "CONDITIONING"], f"link17 意外形: {l}"
            l[1], l[2] = 4015, 1
            account["rewritten_links"].append({"17": [17, 4015, 1, 7, 2, "CONDITIONING"]})
    nodes[4015]["outputs"][1]["links"] = [17]
    return account


# ——i2i———————————————————————————————————————————————————————————————————

def i2i_preconditions(t: Target) -> None:
    nodes = _nodes_map(t.doc)

    def need(cond: bool, msg: str):
        if not cond:
            t.pre_fail.append(msg)

    n15, n171 = nodes.get(4015), nodes.get(171)
    need(n15 is not None and n15["type"] == OFFICIAL, "4015 缺席或现型≠官方 TE")
    need(n171 is not None and n171["type"] == OFFICIAL, "171 缺席或现型≠官方 TE")
    if n15 is None or n171 is None:
        return
    need(_input_link_ids(n15) == {268, 270, 272, 274, 275, 277, 4410},
         f"4015 入线集≠预期七线: {_input_link_ids(n15)}")
    need(_input_link_ids(n171) == {269, 271, 273, 276, 278, 4411},
         f"171 入线集≠预期六线: {_input_link_ids(n171)}")


def i2i_terminal(t: Target) -> None:
    nodes = _nodes_map(t.doc)

    def need(cond: bool, msg: str):
        if not cond:
            t.done_fail.append(msg)

    n15, n171 = nodes.get(4015), nodes.get(171)
    need(n15 is not None and n15["type"] == FAST, "4015 未换类")
    need(n171 is not None and n171["type"] == FAST, "171 未换类")
    for n in (n15, n171):
        need(n is not None and n.get("properties", {}).get("Node name for S&R") == FAST,
             f"{n['id'] if n else '?'} properties['Node name for S&R'] 未随换类")
    if n15 is None or n171 is None:
        return
    need(_input_link_ids(n15) == {268, 270, 272, 274, 275, 277, 4410}, "4015 终态入线集漂移(4410 应保留)")
    need(_input_link_ids(n171) == {269, 271, 273, 276, 278, 4411}, "171 终态入线集漂移(4411 应保留)")
    links = {l[0]: l for l in t.doc["links"]}
    for lid in (280, 282):
        need(lid in links, f"连线 {lid} 应原样保留(终态缺席)")


def i2i_operate(doc: dict) -> dict:
    nodes = _nodes_map(doc)
    account = {"target": "i2i", "te_before": {}, "te_titles": {},
               "deleted_links": [], "rewritten_links": [], "pruned_origin_slots": []}
    for nid in (4015, 171):
        _swap_class(nodes[nid], account, nid)
    return account


# ——edit / mirror(同 def 双换类;仅锚不同)———————————————————————————————

def sg_preconditions(t: Target) -> None:
    sg = _sg_def(t.doc, EDIT_SG_ID)
    nodes = _nodes_map(sg)

    def need(cond: bool, msg: str):
        if not cond:
            t.pre_fail.append(msg)

    for nid in (4015, 4016):
        n = nodes.get(nid)
        need(n is not None and n["type"] == OFFICIAL, f"子图 {nid} 缺席或现型≠官方 TE")
    need(isinstance(sg.get("links"), list) and len(sg["links"]) == 26,
         f"子图 links 数≠26: {len(sg.get('links', [])) if isinstance(sg.get('links'), list) else sg.get('links')}")
    if t.key == "mirror":
        n4013 = nodes.get(4013)
        need(n4013 is not None and n4013["type"] == "TextGenerate", "mirror 4013 缺席或型≠TextGenerate")


def sg_terminal(t: Target) -> None:
    sg = _sg_def(t.doc, EDIT_SG_ID)
    nodes = _nodes_map(sg)

    def need(cond: bool, msg: str):
        if not cond:
            t.done_fail.append(msg)

    for nid in (4015, 4016):
        n = nodes.get(nid)
        need(n is not None and n["type"] == FAST, f"子图 {nid} 未换类")
        need(n is not None and n.get("properties", {}).get("Node name for S&R") == FAST,
             f"子图 {nid} properties['Node name for S&R'] 未随换类")
    need(isinstance(sg.get("links"), list) and len(sg["links"]) == 26,
         f"子图 links 终态数≠26: {len(sg.get('links', []))}")
    if t.key == "mirror":
        n4013 = nodes.get(4013)
        need(n4013 is not None and n4013["type"] == "TextGenerate", "mirror 4013 终态被误动")


def sg_operate(doc: dict) -> dict:
    sg = _sg_def(doc, EDIT_SG_ID)
    nodes = _nodes_map(sg)
    account = {"target": "edit-sg", "te_before": {}, "te_titles": {},
               "deleted_links": [], "rewritten_links": [], "pruned_origin_slots": []}
    for nid in (4015, 4016):
        _swap_class(nodes[nid], account, nid)
    return account


TARGETS = {
    "t2i": (T2I, t2i_preconditions, t2i_terminal, t2i_operate),
    "i2i": (I2I, i2i_preconditions, i2i_terminal, i2i_operate),
    "edit": (EDIT, sg_preconditions, sg_terminal, sg_operate),
    "mirror": (MIRROR, sg_preconditions, sg_terminal, sg_operate),
}


# ——硬约束守卫:除目标 TE 外字节级不动———————————————————————————————————

def _canon(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)


def guard_byte_conservation(key: str, before: dict, after: dict, account: dict) -> None:
    """术后守卫:节点对象与连线除登记账目外逐位等价;标题保留。"""
    if key in ("t2i", "i2i"):
        b_nodes, a_nodes = _nodes_map(before), _nodes_map(after)
        if key == "t2i":
            te_ids, removed = {4015, 4016}, {4016}
            # 级联删登记账目的 origin 槽摘除(定谳3 唯一合法非 TE 连线面变化):
            # [6].outputs 负向槽 [209,217]→[217];4204.outputs[0] [4304]→[]
            lawful_prunes = {6: {1: ([209, 217], [217])}, 4204: {0: ([4304], [])}}
        else:
            te_ids, removed = {4015, 171}, set()
            lawful_prunes = {}
        for nid in b_nodes:
            if nid in te_ids:
                continue
            if nid in lawful_prunes:
                for f in b_nodes[nid]:
                    if f == "outputs":
                        continue
                    assert _canon(b_nodes[nid][f]) == _canon(a_nodes[nid].get(f)), f"{key}: 节点 {nid} 字段 {f} 漂移"
                for si, (bo, ao) in enumerate(zip(b_nodes[nid]["outputs"], a_nodes[nid]["outputs"])):
                    if si in lawful_prunes[nid]:
                        want_before, want_after = lawful_prunes[nid][si]
                        assert bo.get("links") == want_before and ao.get("links") == want_after, \
                            f"{key}: 节点 {nid} 出槽{si} 非登记变化 {bo.get('links')} → {ao.get('links')}"
                        bo_rest = {k: v for k, v in bo.items() if k != "links"}
                        ao_rest = {k: v for k, v in ao.items() if k != "links"}
                        assert _canon(bo_rest) == _canon(ao_rest), f"{key}: 节点 {nid} 出槽{si} 余字段漂移"
                    else:
                        assert _canon(bo) == _canon(ao), f"{key}: 节点 {nid} 出槽{si} 漂移"
                continue
            assert _canon(b_nodes[nid]) == _canon(a_nodes[nid]), f"{key}: 非 TE 节点 {nid} 字节漂移"
        assert set(a_nodes) == set(b_nodes) - removed, f"{key}: 节点集漂移 {set(a_nodes) ^ (set(b_nodes) - removed)}"
        for nid in te_ids - removed:
            assert a_nodes[nid].get("title") == b_nodes[nid].get("title"), f"{key}: TE {nid} 标题漂移"
            for f in ("inputs", "widgets_values", "pos", "size", "mode", "flags", "order", "shape", "properties"):
                if f not in b_nodes[nid]:
                    continue
                if f == "properties":
                    bp, ap = b_nodes[nid][f], a_nodes[nid].get(f, {})
                    assert bp.get("Node name for S&R") == OFFICIAL, \
                        f"{key}: TE {nid} S&R 前置非官方类({bp.get('Node name for S&R')})"
                    assert ap.get("Node name for S&R") == FAST, \
                        f"{key}: TE {nid} S&R 未随换类({ap.get('Node name for S&R')})"
                    b_rest = {k: v for k, v in bp.items() if k != "Node name for S&R"}
                    a_rest = {k: v for k, v in ap.items() if k != "Node name for S&R"}
                    assert _canon(b_rest) == _canon(a_rest), f"{key}: TE {nid} properties 余键漂移"
                    continue
                assert _canon(b_nodes[nid][f]) == _canon(a_nodes[nid].get(f)), f"{key}: TE {nid} 字段 {f} 漂移"
            # outputs 逐槽:t2i 4015.negative 槽唯一合法变化(承接复用 link17 []→[17]);
            # 其余槽(含 i2i 全部 TE 出口)字节级不动
            for si, (bo, ao) in enumerate(zip(b_nodes[nid]["outputs"], a_nodes[nid]["outputs"])):
                lawful = (key == "t2i" and nid == 4015 and si == 1)
                if lawful:
                    assert bo.get("links") == [] and ao.get("links") == [17], \
                        f"{key}: TE {nid} 出槽{si} 非登记变化 {bo.get('links')} → {ao.get('links')}"
                else:
                    assert _canon(bo) == _canon(ao), f"{key}: TE {nid} 出槽{si} 漂移"
            assert a_nodes[nid]["type"] == FAST, f"{key}: TE {nid} 未换类"
        # links:除删除/改写账目外逐位等价
        deleted = set(account["deleted_links"])
        rewritten = {17}
        b_links = {l[0]: l for l in before["links"]}
        a_links = {l[0]: l for l in after["links"]}
        for lid, l in b_links.items():
            if lid in deleted:
                assert lid not in a_links, f"{key}: link{lid} 未删净"
                continue
            assert lid in a_links, f"{key}: link{lid} 意外消失"
            if lid in rewritten:
                continue
            assert l == a_links[lid], f"{key}: link{lid} 意外改写 {l} → {a_links[lid]}"
        assert set(a_links) == set(b_links) - deleted, f"{key}: links 键集漂移"
        # 顶层其余键不动
        for k in before:
            if k in ("nodes", "links"):
                continue
            assert _canon(before[k]) == _canon(after[k]), f"{key}: 顶层键 {k} 漂移"
    else:  # edit / mirror:只动子图 def 内两个 TE 的 type;根节点/宿主边界/links 零动
        b_sg, a_sg = _sg_def(before, EDIT_SG_ID), _sg_def(after, EDIT_SG_ID)
        b_nodes, a_nodes = _nodes_map(b_sg), _nodes_map(a_sg)
        for nid in b_nodes:
            if nid in (4015, 4016):
                assert a_nodes[nid]["type"] == FAST, f"{key}: TE {nid} 未换类"
                assert a_nodes[nid].get("title") == b_nodes[nid].get("title"), f"{key}: TE {nid} 标题漂移"
                for f in b_nodes[nid]:
                    if f == "type":
                        continue
                    if f == "properties":
                        bp, ap = b_nodes[nid][f], a_nodes[nid].get(f, {})
                        assert bp.get("Node name for S&R") == OFFICIAL and \
                            ap.get("Node name for S&R") == FAST, \
                            f"{key}: TE {nid} S&R 未随换类({bp.get('Node name for S&R')}→{ap.get('Node name for S&R')})"
                        b_rest = {k: v for k, v in bp.items() if k != "Node name for S&R"}
                        a_rest = {k: v for k, v in ap.items() if k != "Node name for S&R"}
                        assert _canon(b_rest) == _canon(a_rest), f"{key}: TE {nid} properties 余键漂移"
                        continue
                    assert _canon(b_nodes[nid][f]) == _canon(a_nodes[nid].get(f)), f"{key}: TE {nid} 字段 {f} 漂移"
            else:
                assert _canon(b_nodes[nid]) == _canon(a_nodes[nid]), f"{key}: 子图非 TE 节点 {nid} 字节漂移"
        assert _canon(b_sg.get("links")) == _canon(a_sg.get("links")), f"{key}: 子图 links 漂移"
        assert _canon(b_sg.get("outputs")) == _canon(a_sg.get("outputs")), f"{key}: 宿主边界出漂移"
        assert _canon(b_sg.get("inputs")) == _canon(a_sg.get("inputs")), f"{key}: 子图边界入漂移"
        for k in before:
            if k == "definitions":
                continue
            assert _canon(before[k]) == _canon(after[k]), f"{key}: 顶层键 {k} 漂移"
        # def 内除 nodes 外的键零动
        for k in b_sg:
            if k == "nodes":
                continue
            assert _canon(b_sg[k]) == _canon(a_sg[k]), f"{key}: def 键 {k} 漂移"


# ——主流程—————————————————————————————————————————————————————————————————

def collect_states() -> dict[str, Target]:
    out = {}
    for key, (path, pre, done, _op) in TARGETS.items():
        t = Target(key, path)
        pre(t)
        done(t)
        out[key] = t
    return out


def cmd_dry_run() -> int:
    assert_cfg_lock()
    states = collect_states()
    rc = 0
    for key, t in states.items():
        print(f"[{key}] state={t.state()}")
        for m in t.pre_fail:
            print(f"    pre-fail: {m}")
        for m in t.done_fail:
            print(f"    done-fail: {m}")
        if t.state() != "APPLY-READY":
            rc = 1
    if rc == 0:
        print("[dry-run] 四靶断言全过(APPLY-READY)")
    else:
        print("[dry-run] 存在非 APPLY-READY 靶(见上);ALREADY-DONE=幂等已毕,PARTIAL=须先 --restore")
    return rc


def backup(t: Target) -> Path:
    BAK_DIR.mkdir(parents=True, exist_ok=True)
    dst = BAK_DIR / _flat(t.path)
    if dst.exists():  # first-run-wins:已手术后的复跑不覆盖首备份
        return dst
    dst.write_bytes(t.path.read_bytes())
    return dst


def cmd_apply(only: list[str] | None) -> int:
    assert_cfg_lock()
    states = collect_states()
    keys = only or list(states)
    any_applied = False
    for key in keys:
        t = states[key]
        st = t.state()
        if st == "ALREADY-DONE":
            print(f"[{key}] ALREADY-DONE(幂等跳过)")
            continue
        if st == "PARTIAL" or st.startswith("BROKEN"):
            print(f"[{key}] {st}:拒 apply(先 --restore 再 apply)。明细:")
            for m in t.pre_fail:
                print(f"    pre-fail: {m}")
            for m in t.done_fail:
                print(f"    done-fail: {m}")
            return 2
        # APPLY-READY
        bak = backup(t)
        print(f"[{key}] 备份 → {bak.relative_to(REPO)}")
        after = copy.deepcopy(t.doc)
        account = TARGETS[key][3](after)
        guard_byte_conservation(key, t.doc, after, account)
        json.loads(json.dumps(after))  # 写前可序列化复验
        tmp = t.path.with_suffix(".json.my21fast-tmp")
        tmp.write_text(_dump_like(after, t.raw), encoding="utf-8")
        os.replace(tmp, t.path)
        json.loads(t.path.read_text(encoding="utf-8"))  # 写后 json.load 复验
        print(f"[{key}] apply 完成:TE {account['te_before']} → {FAST}(标题保留 {account['te_titles']})")
        if account["deleted_links"]:
            print(f"[{key}] 摘除连线账目: 删 links={account['deleted_links']} origin 摘除={account['pruned_origin_slots']}")
        if account["rewritten_links"]:
            print(f"[{key}] 复用改写: {account['rewritten_links']}")
        any_applied = True
    # 终态复认
    for key in keys:
        t2 = Target(key, TARGETS[key][0])
        TARGETS[key][2](t2)
        assert not t2.done_fail, f"[{key}] 术后终态复认败: {t2.done_fail}"
        print(f"[{key}] 术后终态复认: ALREADY-DONE ✓")
    print("[apply] " + ("完成" if any_applied else "无改动(全幂等)"))
    return 0


def cmd_restore(only: list[str] | None) -> int:
    keys = only or list(TARGETS)
    for key in keys:
        path = TARGETS[key][0]
        bak = BAK_DIR / _flat(path)
        if not bak.exists():
            print(f"[{key}] 还原拒:备份缺位 {bak.relative_to(REPO)}")
            return 2
        path.write_bytes(bak.read_bytes())
        json.loads(path.read_text(encoding="utf-8"))
        print(f"[{key}] 已从备份逐字节还原 ← {bak.relative_to(REPO)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--restore", action="store_true")
    ap.add_argument("--target", choices=list(TARGETS) + ["all"], default="all")
    args = ap.parse_args()
    only = None if args.target == "all" else [args.target]
    if args.dry_run:
        return cmd_dry_run()
    if args.apply:
        return cmd_apply(only)
    if args.restore:
        return cmd_restore(only)
    ap.error("--dry-run / --apply / --restore 其一")


if __name__ == "__main__":
    sys.exit(main())
