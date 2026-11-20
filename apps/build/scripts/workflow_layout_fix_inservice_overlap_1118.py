#!/usr/bin/env python3
"""1118 画布布局役收尾:在役三件插入节点压线让位(纯 pos,拓扑/接线/组框零改)。

对象:
  - 固定线 960P/SolAttn 二件:加速节点 43/48 插入时压住采样列与装载列;
  - 3_声音/Yue2 yue2-翻唱-记谱版:PreviewAny 压住 SheetSage2AudioToABC。
判定=按存储 size 的非覆盖层节点两两相交归零(Reroute/Note/Primitive 等覆盖层不计)。

用法:
  python3 workflow_layout_fix_inservice_overlap_1118.py            # 手术写入
  python3 workflow_layout_fix_inservice_overlap_1118.py --check    # 幂等复验
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WF = ROOT / "apps/backend/comfyui/workflows"
OVERLAY = {"Reroute", "PrimitiveNode", "AddLabel", "Label (rgthree)", "GetNode",
           "SetNode", "Fast Groups Bypasser (rgthree)", "Bookmark (rgthree)",
           "Anything Everywhere", "MarkdownNote", "Note"}

PLANS = {
    "2_视频/H3视频/2_固定线/社区-480P生成-960P精修-SolAttn加速-960P直出.json": {
        48: ([1370, 5128], [1370, 4800]),    # T8块缓存 让出 UNET/CLIP 装载列
        43: ([2748.2578085907203, 5100.293966332052],
             [2748.2578085907203, 4640]),            # SolAttnPatch 让出采样列,上移贴组顶
    },
    "2_视频/H3视频/2_固定线/社区-480P生成-SolAttn加速-480P直出.json": {
        48: ([1370, 5128], [1370, 4800]),
    },
    "3_声音/Yue2/yue2-翻唱-记谱版.json": {
        14: ([712, 470], [820, 700]),                # PreviewAny 让出记谱节点
    },
}


def _dump(doc, ind, sep, nl):
    return json.dumps(doc, ensure_ascii=False, indent=ind, separators=sep) + nl


def _raw_and_fmt(path):
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    for ind in (1, 2, 4):
        for nl in ("", "\n"):
            if _dump(doc, ind, None, nl) == raw:
                return doc, ind, None, nl
    for sep in ((",", ":"), (",", ": ")):
        for nl in ("", "\n"):
            if _dump(doc, None, sep, nl) == raw:
                return doc, None, sep, nl
    raise AssertionError(f"{path.name}: 序列化往返不等价,格式不明")


def _rect(n, pos=None):
    x, y = pos if pos is not None else n["pos"]
    s = n.get("size") or [0, 0]
    return x, y, float(s[0]), float(s[1])


def _overlaps(nodes):
    hits = set()
    rs = [(n["id"], *_rect(n)) for n in nodes]
    rs = [r for r in rs if r[3] > 0 and r[4] > 0]  # 0 高/0 宽=退化矩形,无面积
    for i, (a, ax, ay, aw, ah) in enumerate(rs):
        for b, bx, by, bw, bh in rs[i + 1:]:
            if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                hits.add(tuple(sorted((a, b))))
    return hits


def _real_overlaps(nodes):
    keep = [n for n in nodes if n.get("type") not in OVERLAY]
    return _overlaps(keep)


def _group_overlaps(doc):
    bs = [(g.get("title"), *g["bounding"]) for g in doc.get("groups", [])
          if isinstance(g.get("bounding"), list) and len(g["bounding"]) == 4]
    hits = []
    for i, (ta, ax, ay, aw, ah) in enumerate(bs):
        for tb, bx, by, bw, bh in bs[i + 1:]:
            if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                hits.append((ta, tb))
    return hits


def plan_one(rel, plan, write):
    path = WF / rel
    doc, ind, sep, nl = _raw_and_fmt(path)
    by = {n["id"]: n for n in doc["nodes"]}
    changed = 0
    for nid, (old, new) in plan.items():
        p = by[nid]["pos"]
        if json.dumps(p) == json.dumps(list(new)):
            continue
        cur = [float(p[0]), float(p[1])]
        assert cur in ([float(old[0]), float(old[1])], [float(new[0]), float(new[1])]), \
            f"{path.name}: 节点{nid} 位置非 old-or-new: {p}"
        by[nid]["pos"] = list(new)
        changed += 1
    if not changed:
        print(f"done  {path.name}")
        return 0
    left = _real_overlaps(doc["nodes"])
    assert not left, f"{path.name}: 让位后仍有实节点互压 {sorted(left)}"
    assert not _group_overlaps(doc), f"{path.name}: 组框重叠 {_group_overlaps(doc)}"
    print(f"{'write' if write else 'plan '} {path.name}: moves={list(plan)}")
    if write:
        path.write_text(_dump(doc, ind, sep, nl), encoding="utf-8")
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
