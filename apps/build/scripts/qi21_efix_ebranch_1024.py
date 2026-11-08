#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 E混动臂插 Fix 件手术 1024(用户令「档3混动也要接 detail-fix;t2i/i2i 都改」)。

改动语义(四实例同刷:t2i/i2i 蓝图 my_nodes/subgraphs/ + t2i/i2i 画布内嵌):
  原:[7028 turbo LoRA] →(7040 LazyCache / 7041 BasicScheduler)
  新:[7028 turbo LoRA] → [新 7044 LoraLoaderModelOnly=detail-fix-2.0×1.0]
      →(7040 LazyCache / 7041 BasicScheduler)
  档0 Turbo 臂(7028→7029 直连)与档1 原生臂(7026→7010)零触碰。
  Fix 补丁链插在 LazyCache 之前=LoRA 补丁重算整段进缓存(步跳收益不丢)。

布局:7044 顶 7040 原位,E 臂四件右移让位;组框⑤随宽;i2i 避让 7029/7031。
     布局棘轮=内建自比(改前/改后 layout_check 八项逐键 counts 只降不升)。

fail-closed:任一前置断言失败=四件全零写入;两阶段(全内存改+验→统一落盘)。
用法:python3 qi21_efix_ebranch_1024.py [--dry]
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BC = REPO / "apps/backend/comfyui"
sys.path.insert(0, str(REPO / ".zcode/skills/node-graph/tools"))
import layout_check as _lc  # noqa: E402

FIX_FILE = "qwen2.1-detail-fix-2.0.safetensors"
FIX_ID = 7044
SG_UUID = {"t2i": "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e",
           "i2i": "b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b"}

FILES = {  # tag -> (蓝图, 画布)
    "t2i": (BC / "my_nodes/subgraphs/qi21-道劫-加速子图.json",
            BC / "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"),
    "i2i": (BC / "my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json",
            BC / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"),
}

# 每文件布防:7044(新位/尺寸) + E臂四件新位 + 组框(id,新bounding)
PLACE = {
    "t2i": {
        "fix": ([2860.0, 1350.0], [270.0, 148.0]),
        7040: [3340.0, 1350.0], 7041: [3340.0, 1650.0],
        7042: [3980.0, 1310.0], 7043: [4900.0, 1290.0],   # 原位不动(长线零变)
        "group": (95, [2830.0, 1240.0, 2440.0, 688.0]),
    },
    "i2i": {
        "fix": ([2600, 1208], [270, 130]),
        7040: [3420, 1330], 7041: [2880, 1590],
        7042: [4100, 1458], 7043: [4520, 1832],
        "group": (16, [1896, 1154, 2994, 935]),
    },
}

NOTE_OLD = "[7028 Turbo LoRA 出]→[7040 LazyCache"
NOTE_NEW = "[7028 Turbo LoRA 出]→[7044 Fix v2.0×1.0(1024令:E臂也吃细节件)]→[7040 LazyCache"
NOTE_APPEND = ("[7044] E臂Fix·detail-fix v2.0×1.0(1024 用户令「档3混动也要吃细节」:"
               "挂 [7028] turbo LoRA 后、[7040] LazyCache 前=补丁链整段入缓存;"
               "官方域 cfg>1 之外,效果以实弹对拍为准,强度热调在本件)")


def _fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


def _accel_sg(doc: dict, uuid: str) -> dict:
    hits = [s for s in doc.get("definitions", {}).get("subgraphs", [])
            if s.get("id") == uuid]
    if len(hits) != 1:
        _fail(f"加速子图 uuid={uuid} 命中 {len(hits)} 份(应恰1)")
    return hits[0]


def _model_link(sg: dict, o: int, t: int) -> dict:
    hits = [l for l in sg["links"]
            if l["type"] == "MODEL" and l["origin_id"] == o and l["target_id"] == t]
    if len(hits) != 1:
        _fail(f"MODEL 链 {o}->{t} 命中 {len(hits)} 条(应恰1)")
    return hits[0]


def _scope_counts(doc: dict) -> dict:
    out = {}
    for s in _lc.check_workflow(doc):
        out[s["name"]] = dict(s["counts"])
    return out


def transform(tag: str, path: Path) -> tuple[dict, bytes]:
    """载入→前置断言→改造→后置断言;返回(新doc,原bytes)。"""
    raw = path.read_bytes()
    doc = json.loads(raw)
    sg = _accel_sg(doc, SG_UUID[tag])
    nodes = {n["id"]: n for n in sg["nodes"]}
    place = PLACE[tag]

    # ── 前置断言(fail-closed)────────────────────────────
    if FIX_ID in nodes:
        _fail(f"{tag}: {FIX_ID} 已存在于加速子图")
    main_ids = {n["id"] for n in doc.get("nodes", [])}
    if FIX_ID in main_ids:
        _fail(f"{tag}: {FIX_ID} 与主图节点撞号(作用域∅断言)")
    for nid, want in ((7028, "LoraLoaderModelOnly"), (7034, "LoraLoaderModelOnly"),
                      (7040, "LazyCache"), (7041, "BasicScheduler"),
                      (7042, "BasicGuider"), (7043, "SamplerCustomAdvanced")):
        if nid not in nodes or nodes[nid]["type"] != want:
            _fail(f"{tag}: 节点 {nid} 缺失或型非 {want}")
    # 档0 直连在档(零触碰护栏)
    if _model_link(sg, 7028, 7029)["target_slot"] != 0:
        _fail(f"{tag}: 7028→7029 档0直连形态异常")
    if tag == "t2i" and _model_link(sg, 7026, 7010)["target_slot"] != 0:
        _fail("t2i: 7026→7010 原生臂形态异常")
    base_counts = _scope_counts(doc)
    # E 臂现位应与布防快照一致(防并行会话已动布局)
    for nid in (7040, 7041, 7042, 7043):
        cur = [float(v) for v in nodes[nid]["pos"]]
        if tag == "t2i":
            snap = {7040: [2860, 1350], 7041: [3180, 1720],
                    7042: [3980, 1310], 7043: [4900, 1290]}[nid]
        else:
            snap = {7040: [2600, 1208], 7041: [2600, 1500],
                    7042: [2950, 1458], 7043: [3300, 1832]}[nid]
        if any(abs(a - b) > 1 for a, b in zip(cur, snap)):
            _fail(f"{tag}: 节点 {nid} 现位 {cur} ≠ 快照 {snap}(并行改动?重核布防)")

    # ── 改造 ────────────────────────────────────────────
    l1 = _model_link(sg, 7028, 7040)   # 转由 7044 出
    l2 = _model_link(sg, 7028, 7041)   # 转由 7044 出
    new_link_id = max(l["id"] for l in sg["links"]) + 1

    # 1) 新节点 7044(克隆本件 7026(t2i)/7028(i2i) 结构)
    donor = nodes[7026] if tag == "t2i" else nodes[7028]
    fix_node = copy.deepcopy(donor)
    fix_node.update({
        "id": FIX_ID, "pos": list(place["fix"][0]), "size": list(place["fix"][1]),
        "order": max(n.get("order", 0) for n in sg["nodes"]) + 1,
        "title": f"[{FIX_ID}] E臂Fix",
        "inputs": [dict(donor["inputs"][0], link=new_link_id)],
        "outputs": [dict(donor["outputs"][0], links=[l1["id"], l2["id"]])],
        "widgets_values": [FIX_FILE, 1],
        "widgets_values_named": {"lora_name": FIX_FILE, "strength_model": 1},
    })

    # 2) 两条 E 臂 MODEL 线改由 7044 出
    for lk in (l1, l2):
        lk["origin_id"] = FIX_ID
        lk["origin_slot"] = 0
    # 3) 7028 出线账本:摘 l1/l2,添新线
    out28 = nodes[7028]["outputs"][0]
    out28["links"] = [i for i in out28["links"] if i not in (l1["id"], l2["id"])]
    out28["links"].append(new_link_id)
    # 4) 新线入 links 表
    sg["links"].append({"id": new_link_id, "origin_id": 7028, "origin_slot": 0,
                        "target_id": FIX_ID, "target_slot": 0, "type": "MODEL"})
    # 5) E 臂四件右移 + 7044 入册
    sg["nodes"].append(fix_node)
    for nid in (7040, 7041, 7042, 7043):
        nodes[nid]["pos"] = list(place[nid])
    # 6) 组框随宽
    gid, bbox = place["group"]
    grp = next((g for g in sg.get("groups", []) if g.get("id") == gid), None)
    if grp is None:
        _fail(f"{tag}: 组框 {gid} 不在")
    grp["bounding"] = list(bbox)
    # 7) last_* 抬高
    doc["last_node_id"] = max(int(doc.get("last_node_id", 0)), FIX_ID)
    doc["last_link_id"] = max(int(doc.get("last_link_id", 0)), new_link_id)
    # 8) Note 7016:⑤行改写+尾行补账(双写态:widgets_values/named 同步)
    note = nodes.get(7016)
    if note is None:
        _fail(f"{tag}: Note 7016 不在")
    for holder in (note.get("widgets_values") if isinstance(note.get("widgets_values"), list) else [],
                   [note["widgets_values_named"]["内容"]] if isinstance(note.get("widgets_values_named"), dict) and "内容" in note["widgets_values_named"] else []):
        for i, txt in enumerate(holder):
            if NOTE_OLD in txt:
                holder[i] = txt.replace(NOTE_OLD, NOTE_NEW, 1)
                if NOTE_APPEND not in holder[i]:
                    holder[i] = holder[i] + "\n" + NOTE_APPEND

    # ── 后置断言(内存态,全部过了才准落盘)──────────────
    if not any(NOTE_NEW in (t if isinstance(t, str) else "")
               for t in (note.get("widgets_values") or []) + (
                   [note.get("widgets_values_named", {}).get("内容")] if isinstance(note.get("widgets_values_named"), dict) else [])):
        _fail(f"{tag}: Note 7016 ⑤行改写未落")
    # 链路形态:7034→7028→7044→{7040,7041};档0/原生零变
    _model_link(sg, 7034, 7028)
    _model_link(sg, 7028, FIX_ID)
    _model_link(sg, FIX_ID, 7040)
    _model_link(sg, FIX_ID, 7041)
    _model_link(sg, 7028, 7029)
    if tag == "t2i":
        _model_link(sg, 7026, 7010)
    # 全表一致性:每条 link 两端账本对得上
    nn = {n["id"]: n for n in sg["nodes"]}
    for l in sg["links"]:
        if l["origin_id"] < 0 or l["target_id"] < 0:
            continue  # 边界线:端点=子图 interface(-10/-20),不入节点表
        o, t = nn.get(l["origin_id"]), nn.get(l["target_id"])
        if o is None or t is None:
            _fail(f"{tag}: link {l['id']} 端点悬空")
        if l["id"] not in o["outputs"][l["origin_slot"]].get("links", []):
            _fail(f"{tag}: link {l['id']} 缺于 {l['origin_id']} 出线账本")
        if t["inputs"][l["target_slot"]].get("link") != l["id"]:
            _fail(f"{tag}: link {l['id']} 缺于 {l['target_id']} 入线账本")
    # census:t2i 25 / i2i 24
    want_n = 25 if tag == "t2i" else 24
    if len(sg["nodes"]) != want_n:
        _fail(f"{tag}: 改后件数 {len(sg['nodes'])} ≠ {want_n}")
    # 布局棘轮:八项逐键只降不升;他 scope 全等
    new_counts = _scope_counts(doc)
    for scope, base in base_counts.items():
        got = new_counts.get(scope)
        if got is None:
            _fail(f"{tag}: scope {scope} 改后消失")
        if "道劫·加速" in scope:
            for k, v in base.items():
                if got[k] > v:
                    for s in _lc.check_workflow(doc):
                        if s["name"] == scope:
                            for vio in s["violations"]:
                                if vio["check"] == k:
                                    print(f"  [棘轮明细] {vio['message']}")
                    _fail(f"{tag}: 布局棘轮回涨 {scope}.{k}: {v}→{got[k]}")
        elif got != base:
            _fail(f"{tag}: scope {scope} 计数漂移 {base}→{got}")
    return doc, raw


def main() -> None:
    dry = "--dry" in sys.argv
    results = {}
    for tag, (bp, cv) in FILES.items():
        for path in (bp, cv):
            doc, raw = transform(tag, path)
            results[path] = (doc, raw)
            nfix = next(l for l in doc["definitions"]["subgraphs"]
                        if l["id"] == SG_UUID[tag])
            c = {n["id"]: n for n in nfix["nodes"]}[FIX_ID]
            print(f"[OK] {path.name}({tag}) 7044 就位 pos={c['pos']} "
                  f"组框={next(g['bounding'] for g in nfix['groups'] if g['id'] == PLACE[tag]['group'][0])}")
    if dry:
        print("[DRY] 全部断言通过,零写入")
        return
    for path, (doc, _) in results.items():
        tail = "\n" if path.read_bytes().endswith(b"}\n") else ""
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + tail,
                        encoding="utf-8")
        print(f"[WRITE] {path}")
    print("[DONE] 四实例落盘:E混动臂=7028→7044(Fix×1.0)→LazyCache;档0/原生零触碰")


if __name__ == "__main__":
    main()
