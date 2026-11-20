#!/usr/bin/env python3
"""1118 画布布局役批次③续:负区清零(纯平移,拓扑/接线/相对几何零改)。

对象:
  - qwen21-charcard-t2i.json(手改件,无生成器归属);
  - 3_声音/Yue2 yue2-翻唱-记谱版.json(社区原件,PrimitiveNode 带在 y=-745、LoadAudio 在 x=-310)。
口径:画布宪法节点 pos >= 80;整图平移使 min 恰落 80,组框同步平移。

用法:
  python3 workflow_layout_fix_negative_region_1118.py           # 手术写入
  python3 workflow_layout_fix_negative_region_1118.py --check   # 只核不改(幂等复验)
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PLANS = {
    "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/5_角色设定卡/qwen21-charcard-t2i.json": {
        "dx": 1340,  # min node x = -1260 -> 80
        "dy": 0,     # min node y = 100, 已达标
        # 说明贴片原置 TE 节点右半(1910..2210 × 120..460 压 node 5),下移至空带
        "moves": {708: ([1910, 120], [1790, 700])},
    },
    "apps/backend/comfyui/workflows/3_声音/Yue2/yue2-翻唱-记谱版.json": {
        "dx": 390,   # min node x = -310 -> 80
        "dy": 825,   # min node y = -745 -> 80
    },
}
MIN_POS = 80


def _dump(doc, ind, nl):
    return json.dumps(doc, ensure_ascii=False, indent=ind) + nl


def _raw_and_fmt(path):
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    for ind in (1, 2, 4):
        for nl in ("", "\n"):
            if _dump(doc, ind, nl) == raw:
                return raw, doc, ind, nl
    raise AssertionError(f"{path.name}: 序列化往返不等价,格式不明")


def _pos_min(doc):
    xs = [n["pos"][0] for n in doc["nodes"]]
    ys = [n["pos"][1] for n in doc["nodes"]]
    return min(xs), min(ys)


def _geom_free(doc):
    strip = json.loads(json.dumps(doc))
    for n in strip["nodes"]:
        n.pop("pos", None)
        n.pop("size", None)
    for g in strip.get("groups", []):
        g.pop("bounding", None)
    return strip


def _overlaps(doc, dx=0, dy=0):
    rects = [(n["id"], n["pos"][0] + dx, n["pos"][1] + dy,
              n.get("size", [0, 0])[0], n.get("size", [0, 0])[1])
             for n in doc["nodes"]]
    hits = set()
    for i, (a, ax, ay, aw, ah) in enumerate(rects):
        for b, bx, by, bw, bh in rects[i + 1:]:
            if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                hits.add(tuple(sorted((a, b))))
    return hits


def _group_overlaps(doc, dx=0, dy=0):
    bs = [(g.get("title"), g["bounding"][0] + dx, g["bounding"][1] + dy,
           g["bounding"][2], g["bounding"][3])
          for g in doc.get("groups", [])
          if isinstance(g.get("bounding"), list) and len(g["bounding"]) == 4]
    hits = []
    for i, (ta, ax, ay, aw, ah) in enumerate(bs):
        for tb, bx, by, bw, bh in bs[i + 1:]:
            if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                hits.append((ta, tb))
    return hits


def plan_one(rel, plan, write):
    path = ROOT / rel
    raw, doc, ind, nl = _raw_and_fmt(path)
    dx, dy = plan["dx"], plan["dy"]
    by = {n["id"]: n for n in doc["nodes"]}
    changed = 0
    minx, miny = _pos_min(doc)
    if minx < MIN_POS or miny < MIN_POS:
        assert minx + dx >= MIN_POS and miny + dy >= MIN_POS, (minx, miny, dx, dy)
        for n in doc["nodes"]:
            n["pos"] = [n["pos"][0] + dx, n["pos"][1] + dy]
        for g in doc.get("groups", []):
            if isinstance(g.get("bounding"), list) and len(g["bounding"]) == 4:
                b = g["bounding"]
                g["bounding"] = [b[0] + dx, b[1] + dy, b[2], b[3]]
        changed += 1
    for nid, (old, new) in plan.get("moves", {}).items():
        p = by[nid]["pos"]
        if list(p) == list(new):
            continue
        assert list(p) == list(old), f"{path.name}: 节点{nid} 位置非 old-or-new: {p}"
        by[nid]["pos"] = list(new)
        changed += 1
    if not changed:
        print(f"done  {path.name}")
        return 0
    before_ov = _overlaps(doc)
    assert not _group_overlaps(doc), f"{path.name}: 组框重叠 {_group_overlaps(doc)}"
    assert before_ov == set(), f"{path.name}: 平移/让位后仍有实节点互压 {before_ov}"
    assert _pos_min(doc)[0] >= MIN_POS and _pos_min(doc)[1] >= MIN_POS

    print(f"{'write' if write else 'plan '} {path.name}: dx={dx} dy={dy} "
          f"moves={list(plan.get('moves', {}))} min=({minx},{miny}) -> {_pos_min(doc)}")
    if write:
        path.write_text(_dump(doc, ind, nl), encoding="utf-8")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    for rel, plan in PLANS.items():
        plan_one(rel, plan, write=not args.check)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
