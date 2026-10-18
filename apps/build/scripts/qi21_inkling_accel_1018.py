#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 加速子图入口单挂水墨风格 LoRA [7034]×0.3(役号 1018inkling;1018anime 同位复挂)。

背景(1018 用户令「Inklingv2 下载下来,替代那个动漫的位置,在加速子图里面」):
  - 动漫件已判死清退(1018animerem),本刀在同位(加速子图 model 入口单挂 [7034])
    挂 Inklingv2 水墨笔刷件(civitai 2977039 v1.0/版本 3374270,Qwen 2.1 底座,
    触发词 Inklingv2 卡片自标);强度沿用槽位 0.3。
  - 配方与 1018anime 完全同款:四扇出原线保 id 改 origin(-10:0→7034:0),入针
    新发一线,三支路共吃;组框铁律(t2i ④共用控制/i2i 共享输入/edit ④组改名扩罩);
    守卫(术前锚/恒向右/零重叠/组框规则/悬空线)+备份+原子写+回读终验。

用法:python3 qi21_inkling_accel_1018.py [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/engines/comfyui"
BAK_ROOT = REPO / "apps/output/bak/qi21-inkling-accel-1018"

SG_NAME = "道劫·加速子图"
NEW_ID = 7034
LORA_FILE = "Inklingv2-qwen21_c1-st6000.safetensors"
STRENGTH = 0.3
TITLE = "[7034] 水墨风格LoRA·Inklingv2(×0.3)"
NOTE_LINE = ("[7034] 水墨风格LoRA·Inklingv2 ×0.3(1018 用户令:替代动漫件同位复挂——model 边界→[7034]"
             "→四扇出 Turbo[7028]/viggle[7011]/段B底模[7022]/原生臂,三支路共吃;"
             "civitai 2977039 v1.0=3374270;触发词 Inklingv2 卡片自标,词法未加候试;强度沿用槽位 0.3)")

W = BASE / "workflows/1_图片/Q2-1图像"
B = BASE / "my_nodes/subgraphs"
FILES = [
    ("t2i", W / "1_文生图/qi21-道劫-t2i.json"),
    ("i2i", W / "2_图生图/qi21-道劫-i2i.json"),
    ("edit", W / "2_图生图/qi21-edit.json"),
    ("t2i", B / "qi21-道劫-加速子图.json"),
    ("i2i", B / "qi21-道劫-加速子图-i2i.json"),
    ("edit", B / "qi21-道劫-加速子图-edit.json"),
]
TARGETS = {
    "t2i": {(7026, 0), (7022, 0), (7011, 0), (7028, 0)},
    "i2i": {(7010, 0), (7022, 0), (7011, 0), (7028, 0)},
    "edit": {(7010, 0), (7022, 0), (7011, 0), (7028, 0)},
}
TYPES = {7026: "LoraLoaderModelOnly", 7010: "KSampler", 7022: "BasicGuider",
         7011: "ViggleTurboLora", 7028: "LoraLoaderModelOnly"}
POS_CANDIDATES = {
    "t2i": [[300, 500], [300, 700], [300, 900], [600, 500], [600, 700]],
    "i2i": [[1400, 760], [1400, 1000], [1100, 760], [1400, 1300], [1100, 1000]],
    "edit": [[45, 520], [45, 700]],
}
EDIT_GROUP_OLD = "④seed 单源"
EDIT_GROUP_NEW = "④共用控制(seed 单源 · 风格LoRA)"
SHARED_GROUP = {"t2i": "④共用控制", "i2i": "共享输入", "edit": EDIT_GROUP_NEW}
NODE_SIZE = [270, 130]
MARGIN = 10


class PostFail(Exception):
    pass


def fail(msg: str) -> None:
    print(f"[1018inkling] FAIL: {msg}")
    sys.exit(1)


def _sg(doc: dict) -> dict:
    hits = [s for s in doc.get("definitions", {}).get("subgraphs", []) if s.get("name") == SG_NAME]
    if len(hits) != 1:
        raise PostFail(f"加速子图应恰 1 份,得 {len(hits)}")
    return hits[0]


def _node(nodes, nid):
    for n in nodes:
        if n["id"] == nid:
            return n
    raise KeyError(nid)


def _all_ids(doc):
    ids = {n["id"] for n in doc.get("nodes", [])}
    for s in doc["definitions"]["subgraphs"]:
        ids |= {n["id"] for n in s["nodes"]}
    return ids


def _all_link_ids(doc):
    ids = {l[0] for l in doc.get("links", [])}
    for s in doc["definitions"]["subgraphs"]:
        ids |= {l["id"] for l in s["links"]}
    return ids


def _rect(pos, size):
    return (pos[0] - MARGIN, pos[1] - MARGIN, pos[0] + size[0] + MARGIN, pos[1] + size[1] + MARGIN)


def _overlap(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _inside(a, b):
    return b[0] <= a[0] and a[2] <= b[2] and b[1] <= a[1] and a[3] <= b[3]


def _group_rects(sg):
    out = []
    for g in sg.get("groups", []):
        bx = g.get("bounding")
        if bx:
            out.append((g.get("title"), (bx[0], bx[1], bx[0] + bx[2], bx[1] + bx[3])))
    return out


def _placement_ok(sg, form, pos, exclude_id=None):
    r = _rect(pos, NODE_SIZE)
    bare = (pos[0], pos[1], pos[0] + NODE_SIZE[0], pos[1] + NODE_SIZE[1])
    for n in sg["nodes"]:
        if n["id"] == exclude_id:
            continue
        if _overlap(r, _rect(n["pos"], n.get("size") or NODE_SIZE)):
            return False
    want = SHARED_GROUP[form]
    in_want = False
    for title, gr in _group_rects(sg):
        if _inside(bare, gr):
            if title == want:
                in_want = True
            elif want is not None:
                return False
        elif _overlap(bare, gr):
            return False
    return in_want if want is not None else True


def _pick_pos(sg, form):
    pin_x = sg["inputs"][0].get("pos", [0, 0])[0]
    tgt_x = min(_node(sg["nodes"], t)["pos"][0] for t, _ in TARGETS[form])
    cands = list(POS_CANDIDATES[form])
    # 兜底:目标组内系统扫描(布局役会重算组框,死坐标候选可能全在组外;
    # x 自 80 起=零负区硬口径,步 40 保证窄组(如 edit ④列宽 320)也能命中)
    want = SHARED_GROUP[form]
    for title, gr in _group_rects(sg):
        if title == want:
            for gy in range(int(gr[1]) + 40, int(gr[3]) - NODE_SIZE[1] - 9, 60):
                for gx in range(max(80, int(gr[0]) + 30), int(gr[2]) - NODE_SIZE[0] - 9, 40):
                    cands.append([gx, gy])
            break
    seen = set()
    for cand in cands:
        key = (cand[0], cand[1])
        if key in seen:
            continue
        seen.add(key)
        if pin_x < cand[0] < tgt_x and cand[0] >= 80 and cand[1] >= 80 \
                and _placement_ok(sg, form, cand):
            return list(cand)
    raise PostFail(f"{form}: 无合法落位")


def verify_pre(doc, form):
    sg = _sg(doc)
    if NEW_ID in _all_ids(doc):
        fail(f"{form}: 节点 id {NEW_ID} 已占用(非未施态)")
    mi = sg["inputs"][0]
    if mi["name"] != "model" or mi["type"] != "MODEL":
        fail(f"{form}: inputs[0] 非 model")
    L = {l["id"]: l for l in sg["links"]}
    lids = mi.get("linkIds") or []
    if len(lids) != 4:
        fail(f"{form}: model 入针 linkIds 应恰 4,得 {lids}")
    got = set()
    for lid in lids:
        l = L.get(lid)
        if not l or (l["origin_id"], l["origin_slot"]) != (-10, 0):
            fail(f"{form}: 线 {lid} 非 -10:0")
        got.add((l["target_id"], l["target_slot"]))
    if got != TARGETS[form]:
        fail(f"{form}: 扇出目标集 {sorted(got)} ≠ {sorted(TARGETS[form])}")
    for tid, _ in TARGETS[form]:
        n = _node(sg["nodes"], tid)
        if n["type"] != TYPES[tid] or n["inputs"][0].get("link") not in lids:
            fail(f"{form}: [{tid}] 锚失")
    n7016 = next((n for n in sg["nodes"] if n["id"] == 7016), None)
    if n7016 is not None and NOTE_LINE in (n7016.get("widgets_values") or [""])[0]:
        fail(f"{form}: Note 已含 1018inkling 行(半态)")
    want_title = EDIT_GROUP_OLD if form == "edit" else SHARED_GROUP[form]
    if len([g for g in sg.get("groups", []) if g.get("title") == want_title]) != 1:
        fail(f"{form}: 共用组「{want_title}」应恰 1")


def surgery(doc, form):
    sg = _sg(doc)
    mi = sg["inputs"][0]
    L = {l["id"]: l for l in sg["links"]}
    old_ids = list(mi["linkIds"])
    new_link = max(_all_link_ids(doc) | {doc.get("last_link_id") or 0,
                                         (sg.get("state") or {}).get("lastLinkId") or 0}) + 1
    tmpl = _node(sg["nodes"], 7028)
    if form == "edit":
        g = next(g for g in sg["groups"] if g.get("title") == EDIT_GROUP_OLD)
        g["title"] = EDIT_GROUP_NEW
        # 扩组高度到 y≥880:容 [7034] 落 x=80 列且与 [7014] est 高度域拉开 ≥80
        need_h = (880 + NODE_SIZE[1] + 20) - g["bounding"][1]
        g["bounding"][3] = max(g["bounding"][3], need_h)
    pos = _pick_pos(sg, form)
    node = {
        "id": NEW_ID, "type": "LoraLoaderModelOnly", "pos": pos, "size": list(NODE_SIZE),
        "flags": {}, "order": tmpl.get("order", 0), "mode": 0,
        "inputs": [{"name": "model", "type": "MODEL", "localized_name": "模型", "link": new_link}],
        "outputs": [{"localized_name": "模型", "name": "MODEL", "type": "MODEL", "links": old_ids}],
        "properties": json.loads(json.dumps(tmpl.get("properties", {}), ensure_ascii=False)),
        "widgets_values": [LORA_FILE, STRENGTH],
        "widgets_values_named": {"lora_name": LORA_FILE, "strength_model": STRENGTH},
        "title": TITLE,
    }
    for lid in old_ids:
        L[lid]["origin_id"] = NEW_ID
        L[lid]["origin_slot"] = 0
    sg["links"].append({"id": new_link, "origin_id": -10, "origin_slot": 0,
                        "target_id": NEW_ID, "target_slot": 0, "type": "MODEL"})
    mi["linkIds"] = [new_link]
    sg["nodes"].append(node)
    st = sg.setdefault("state", {})
    st["lastNodeId"] = max(st.get("lastNodeId") or 0, NEW_ID)
    st["lastLinkId"] = max(st.get("lastLinkId") or 0, new_link)
    doc["last_node_id"] = max(doc.get("last_node_id") or 0, NEW_ID)
    doc["last_link_id"] = max(doc.get("last_link_id") or 0, new_link)
    n7016 = next((n for n in sg["nodes"] if n["id"] == 7016), None)
    if n7016 is not None and isinstance((n7016.get("widgets_values") or [None])[0], str):
        n7016["widgets_values"][0] = n7016["widgets_values"][0].rstrip("\n") + "\n" + NOTE_LINE
        named = n7016.get("widgets_values_named")
        if isinstance(named, dict) and isinstance(named.get("text"), str):
            named["text"] = named["text"].rstrip("\n") + "\n" + NOTE_LINE


def verify_post(doc, form):
    ok = []

    def chk(cond, label):
        if not cond:
            raise PostFail(label)
        ok.append(label)

    sg = _sg(doc)
    nodes = {n["id"]: n for n in sg["nodes"]}
    L = {l["id"]: l for l in sg["links"]}
    chk(NEW_ID in nodes, "A: [7034] 在册")
    n = nodes[NEW_ID]
    chk(n["type"] == "LoraLoaderModelOnly" and n["mode"] == 0 and n["title"] == TITLE, "A: 类型/激活/标题")
    chk(n["widgets_values"] == [LORA_FILE, STRENGTH]
        and n["widgets_values_named"] == {"lora_name": LORA_FILE, "strength_model": STRENGTH},
        "A: wv=[Inklingv2, 0.3] 双写")
    mi = sg["inputs"][0]
    chk(len(mi["linkIds"]) == 1, "B: 入针恰一线")
    nl = L[mi["linkIds"][0]]
    chk((nl["origin_id"], nl["origin_slot"], nl["target_id"], nl["target_slot"]) == (-10, 0, NEW_ID, 0)
        and n["inputs"][0]["link"] == nl["id"], "B: -10:0→7034:0 回指")
    outs = n["outputs"][0]["links"]
    chk(len(outs) == 4 and len(set(outs)) == 4, "C: 扇出恰四线")
    got = set()
    for lid in outs:
        l = L[lid]
        chk((l["origin_id"], l["origin_slot"]) == (NEW_ID, 0), f"C: 线{lid} 起点")
        got.add((l["target_id"], l["target_slot"]))
        chk(nodes[l["target_id"]]["inputs"][l["target_slot"]].get("link") == lid, f"C: 目标回指{lid}")
    chk(got == TARGETS[form], "C: 扇出目标集逐字")
    chk(not any((l["origin_id"], l["origin_slot"]) == (-10, 0) and l["target_id"] != NEW_ID
                for l in sg["links"]), "C: 边界 model 零旁路")
    pin_x = mi.get("pos", [0, 0])[0]
    chk(pin_x < n["pos"][0] < min(nodes[t]["pos"][0] for t, _ in TARGETS[form]), "D: 恒向右")
    chk(_placement_ok(sg, form, n["pos"], exclude_id=NEW_ID), "D: 落位合规")
    grs = _group_rects(sg)
    chk(not any(_overlap(a[1], b[1]) for i, a in enumerate(grs) for b in grs[i + 1:]), "D: 组框两两不交")
    if form == "edit":
        chk(sum(1 for t, _ in grs if t == EDIT_GROUP_NEW) == 1, "D: edit 组名已换")
    st = sg.get("state") or {}
    chk((st.get("lastNodeId") or 0) >= NEW_ID and (st.get("lastLinkId") or 0) >= nl["id"]
        and (doc.get("last_node_id") or 0) >= NEW_ID, "E: 计数器同抬")
    n7016 = nodes.get(7016)
    if n7016 is not None:
        wv0 = (n7016.get("widgets_values") or [""])[0]
        named = (n7016.get("widgets_values_named") or {}).get("text")
        chk(wv0.count(NOTE_LINE) == 1 and (named is None or named.count(NOTE_LINE) == 1), "F: Note 恰一次")
    sids = set(L)
    nids = set(nodes) | {-10, -20}
    bad = [(m["id"], i.get("link")) for m in sg["nodes"] for i in m.get("inputs", [])
           if isinstance(i.get("link"), int) and i["link"] not in sids]
    bad += [(l["id"]) for l in sg["links"] if l["origin_id"] not in nids or l["target_id"] not in nids]
    chk(not bad, "V: 无悬空")
    return ok


def process(path, form):
    raw = path.read_bytes()
    doc = json.loads(raw)
    digest0 = hashlib.md5(raw).hexdigest()
    try:
        verify_post(doc, form)
        return "applied"
    except PostFail:
        pass
    verify_pre(doc, form)
    mtime0 = path.stat().st_mtime
    surgery(doc, form)
    try:
        verify_post(doc, form)
    except PostFail as exc:
        fail(f"{path.name}: 内存态验未过({exc})")
    blob = (json.dumps(doc, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode()
    json.loads(blob)
    bak = BAK_ROOT / path.relative_to(REPO)
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(path, bak)
    if hashlib.md5(bak.read_bytes()).hexdigest() != digest0:
        fail(f"{path.name}: 备份损坏")
    if path.stat().st_mtime != mtime0:
        fail(f"{path.name}: mtime 守卫触发")
    tmp = path.with_name(path.name + ".tmp-1018inkling")
    tmp.write_bytes(blob)
    tmp.replace(path)
    for line in verify_post(json.loads(path.read_bytes()), form):
        print(f"[1018inkling] {path.name}: PASS {line}")
    print(f"[1018inkling] {path.name}: 术前md5={digest0}")
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    states = {}
    for form, p in FILES:
        if not p.exists():
            fail(f"缺文件 {p}")
        if args.check:
            try:
                verify_post(json.loads(p.read_bytes()), form)
                states[p.name] = "已施"
            except PostFail:
                states[p.name] = "未施"
        else:
            states[p.name] = process(p, form)
    if args.check:
        print(f"[1018inkling] --check: {states}")
        vals = set(states.values())
        return 3 if vals == {"已施"} else 0
    vals = set(states.values())
    if len(vals) > 1:
        fail(f"六件半批:{states}")
    if vals == {"applied"}:
        print("[1018inkling] 幂等复跑:六件均已施,exit 3")
        return 3
    print("[1018inkling] 手术完成:三主件+三蓝图(随刀须重建契约 style_lora 与 fire 两件)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
