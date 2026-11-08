#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 加速子图布局定点修复(node-graph 技能口径,役号 1018layout)。

背景(1018 用户令「使用 node-graph 技能针对加速子图进行布局优化」):
  - 全量带式重排两轮实测均劣于现值(现布局=历役手调局部最优,27>21 交叉)→
    改**定点修复**:只挪肇事节点,基座布局零扰动。
  - 待修清单(layout_check 实测):三件 [7034] 扇出线遮(t2i3/i2i1/edit1)+
    edit est重叠[7014]×[7034]+负区(pos45)+edit 遗留线遮2(4405/4406:7017/7018
    →7031 穿 Turbo 臂)+edit 遗留 est间距6(Turbo 臂挤压)。
  - 契约:加速子图内部坐标未钉死;约束=组框罩全+两两不交+恒向右+pos≥80+est 制。

做法(六件同刀;搜索=纯函数确定性→幂等):
  A 定点搜索节点(逐件坐标下降,候选=区域网格,步长 60/80):
      t2i/i2i:[7034];edit:[7034,7017,7018,7029,7030,7031]。
  B 增量评分器(复用 layout_check 原语 _wire/_seg_int/_slot_pt/_est_box/_occl_box,
    交叉=动线×静线+动线×动线,遮挡=动线×全盒+静线×动盒,est=动点×全点)——
    与 check_scope 同数学,只重算变化量(全量评估 0.2-1s/次不可承受)。
  C est 间距微调道:真 check_scope 报的 same-row/same-column 违规对,右/下让位
    (需要量+20);组框只对含移动节点的组按立宪公式重算。
守卫:拓扑零改动对拍+真 check_scope 终验(增量评分仅用于搜索)+四守卫
  (pos≥80/组框两两不交+罩全/恒向右)+术前 md5 锚+备份
  apps/output/bak/qi21-accel-layout-1018/+原子写+回读终验。
用法:python3 qi21_accel_layout_1018.py [--check]
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import itertools
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui"
BAK_ROOT = REPO / "apps/output/bak/qi21-accel-layout-1018"
sys.path.insert(0, str(REPO / ".agents/skills/node-graph/tools"))
import layout_check as lc  # noqa: E402
import workflow_layout as wl  # noqa: E402

CAMPAIGN = "1018layout"
SG_NAME = "道劫·加速子图"
W = BASE / "workflows/1_图片/Q2-1图像"
B = BASE / "my_nodes/subgraphs"
KEYS = lc.CHECK_KEYS
NOTE_POS = {"t2i": [300, 80], "i2i": [300, 80]}   # Note 若被挤动则回锚位

# 定点搜索节点与候选区域 {form: {nid: (x0,x1,y0,y1)}}
SEARCH = {
    "t2i": {7034: (150, 1090, 150, 2750)},
    "i2i": {7034: (150, 1400, 150, 3600)},
    # edit 只修 1018anime 自有债([7034]:线遮/est重叠/负区);7017/7018/Turbo 臂
    # 遗留债(4405/4406 线遮+est间距6)试挪实测反把 occl 3→4(遗留纠缠,窗口解不动)
    # ——不碰不恶化,候后续专项役
    "edit": {7034: (80, 96, 640, 1600)},
}
STEP_X, STEP_Y = 60, 80


def fail(msg):
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def _sg(doc):
    hits = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    if len(hits) != 1:
        raise KeyError("加速子图应恰1")
    return hits[0]


def _members(sg, g):
    bx = g["bounding"]
    x0, y0, x1, y1 = bx[0], bx[1], bx[0] + bx[2], bx[1] + bx[3]
    return sorted(n["id"] for n in sg["nodes"]
                  if x0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= x1
                  and y0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= y1)


def snap_members(sg):
    return {g["title"]: _members(sg, g) for g in sg["groups"]}


def real_score(sg):
    c = lc.check_scope("sub", sg["nodes"], list(lc._iter_links(sg["links"])), sg)["counts"]
    return tuple(c[k] for k in KEYS)


# ══════════ 增量评分器(与 check_scope 同数学,只算变化量)══════════
class Fast:
    def __init__(self, sg):
        self.sg = sg
        self.nodes = {n["id"]: n for n in sg["nodes"]}
        self.links = [tuple(l) for l in lc._iter_links(sg["links"])]
        self.ios_in = [io.get("pos") or [0, 0] for io in sg["inputs"]]
        self.ios_out = [io.get("pos") or [0, 0] for io in sg["outputs"]]

    def _slot(self, nid, slot, side):
        if nid == -10:
            return tuple(map(float, self.ios_in[slot]))
        if nid == -20:
            return tuple(map(float, self.ios_out[slot]))
        n = self.nodes[nid]
        return lc._slot_pt(n, slot, side)

    def _poly(self, l):
        _lid, oid, os_, tid, ts_ = l
        return lc._wire(self._slot(oid, os_, "out"), self._slot(tid, ts_, "in"),
                        lc.CROSS_SAMPLES)

    def _occl_samples(self, l):
        _lid, oid, os_, tid, ts_ = l
        return lc._wire(self._slot(oid, os_, "out"), self._slot(tid, ts_, "in"),
                        lc.OCCL_SAMPLES)

    def _cross(self, a, b):
        for k in range(len(a) - 1):
            for m in range(len(b) - 1):
                if lc._seg_int(a[k], a[k + 1], b[m], b[m + 1]):
                    return True
        return False

    def eval_move(self, nid, pos):
        """候选位(nid 置 pos)增量违规数(与全量的差为常数,可比较)。"""
        n = self.nodes[nid]
        old = n["pos"]
        n["pos"] = [round(pos[0], 1), round(pos[1], 1)]
        try:
            moved = [l for l in self.links if nid in (l[1], l[3])]
            stat = [l for l in self.links if nid not in (l[1], l[3])]
            polys = {l[0]: self._poly(l) for l in moved}
            stat_polys = [self._poly(l) for l in stat]
            cross = sum(1 for l in moved
                        for sp in stat_polys if self._cross(polys[l[0]], sp))
            cross += sum(1 for a, b in itertools.combinations(moved, 2)
                         if self._cross(polys[a[0]], polys[b[0]]))
            occl = 0
            boxes = [(i, lc._occl_box(m)) for i, m in self.nodes.items()]
            for l in moved:
                hits = set()
                for x, y in self._occl_samples(l):
                    for i, bx in boxes:
                        if i in (l[1], l[3]):
                            continue
                        if bx[0] - 2 <= x <= bx[2] + 2 and bx[1] - 2 <= y <= bx[3] + 2:
                            hits.add(i)
                occl += 1 if hits else 0
            mybox = lc._occl_box(n)
            for l in stat:
                for x, y in self._occl_samples(l):
                    if l[1] == nid or l[3] == nid:
                        continue
                    if mybox[0] - 2 <= x <= mybox[2] + 2 and mybox[1] - 2 <= y <= mybox[3] + 2:
                        occl += 1
                        break
            est_o = est_s = 0
            myest = lc._est_box(n)
            for i, m in self.nodes.items():
                if i == nid:
                    continue
                eb = lc._est_box(m)
                if not (myest[2] <= eb[0] or eb[2] <= myest[0]
                        or myest[3] <= eb[1] or eb[3] <= myest[1]):
                    est_o += 1
                yov = not (myest[3] <= eb[1] or eb[3] <= myest[1])
                xov = not (myest[2] <= eb[0] or eb[2] <= myest[0])
                if yov and not xov:
                    gap = (eb[0] - myest[2]) if eb[0] >= myest[2] else (myest[0] - eb[2])
                    if 0 <= gap < 200:
                        est_s += 1
                if xov and not yov:
                    gap = (eb[1] - myest[3]) if eb[1] >= myest[3] else (myest[1] - eb[3])
                    if 0 <= gap < 80:
                        est_s += 1
            neg = 1 if (pos[0] < 80 or pos[1] < 80) else 0
            left = sum(1 for l in moved
                       if self._slot(l[3], l[4], "in")[0] <= self._slot(l[1], l[2], "out")[0])
            return (cross, occl, est_o, est_s, neg, left)
        finally:
            n["pos"] = old


def optimize(sg, form):
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = [tuple(l) for l in lc._iter_links(sg["links"])]
    consumers = {}
    for _lid, oid, _os, tid, _ts in links:
        consumers.setdefault(oid, []).append(tid)
    fast = Fast(sg)
    for nid in SEARCH[form]:
        x0, x1, y0, y1 = SEARCH[form][nid]
        cons = [c for c in consumers.get(nid, []) if c in nodes]
        if cons:   # 结构性禁左向:x 上限=最小消费端 x−60
            x1 = min(x1, min(nodes[c]["pos"][0] for c in cons) - 60)
        best = best_s = None
        for x in range(x0, max(x0, x1) + 1, STEP_X):
            for y in range(y0, y1 + 1, STEP_Y):
                s = fast.eval_move(nid, [x, y])
                tiered = (s[4], s[5], s[2], s[1], s[0], s[3])  # neg,left,est_o,occl,cross,est_s
                if best_s is None or tiered < best_s:
                    best, best_s = [x, y], tiered
        nodes[nid]["pos"] = [float(best[0]), float(best[1])]
    return sg


def nudge_est(sg):
    """est 间距微调:违规对右/下让位(需要量+20);整体越调越坏则还原(安全回退)。"""
    before = copy.deepcopy(sg)
    base = real_score(sg)
    for _round in range(3):
        r = lc.check_scope("sub", sg["nodes"], list(lc._iter_links(sg["links"])), sg)
        pairs = [v for v in r["violations"] if v["check"] == "est_spacing"]
        if not pairs:
            break
        nodes = {n["id"]: n for n in sg["nodes"]}
        for v in pairs:
            import re
            m = re.search(r"node (\d+) and node (\d+) same-(row|column) gap (\d+)",
                          v["message"])
            if not m:
                continue
            a, b, kind, gap = int(m.group(1)), int(m.group(2)), m.group(3), float(m.group(4))
            na, nb = nodes.get(a), nodes.get(b)
            if na is None or nb is None:
                continue
            need = (200 if kind == "row" else 80) - gap + 20
            tgt = nb if nb["pos"][0] >= na["pos"][0] else na
            if kind == "row":
                tgt["pos"] = [tgt["pos"][0] + need, tgt["pos"][1]]
            else:
                tgt["pos"] = [tgt["pos"][0], tgt["pos"][1] + need]
    now = real_score(sg)
    worse = any(now[i] > base[i] for i, k in enumerate(KEYS)
                 if k != "est_spacing")
    if worse:
        sg["nodes"] = before["nodes"]
    return sg


def regroup(sg, mem, moved_ids):
    """只重算含移动节点的组(立宪公式 margin30;与他组相交则降 margin12 重算;
    仍相交=该落位非法,ValueError 交上层弃)。"""
    byid = {n["id"]: n for n in sg["nodes"]}
    touched = [g for g in sg["groups"] if set(mem.get(g["title"], [])) & set(moved_ids)]
    others = [g for g in sg["groups"] if g not in touched]

    def bbox(ids, mx, my):
        ms = [byid[i] for i in ids if i in byid]
        if not ms:
            return None
        x0 = min(n["pos"][0] for n in ms) - mx
        y0 = min(n["pos"][1] for n in ms) - 50
        x1 = max(n["pos"][0] + n["size"][0] for n in ms) + mx
        y1 = max(n["pos"][1] + n["size"][1] for n in ms) + 30
        return [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)]

    def hits(a):
        ax0, ay0, aw, ah = a
        ax1, ay1 = ax0 + aw, ay0 + ah
        for g in others:
            bx0, by0, bw, bh = g["bounding"]
            if ax0 < bx0 + bw and bx0 < ax1 and ay0 < by0 + bh and by0 < ay1:
                return True
        return False

    for g in touched:
        ids = mem.get(g["title"], [])
        for mx in (30, 12):
            b = bbox(ids, mx, 50)
            if b is None:
                break
            if not hits(b):
                g["bounding"] = b
                break
        else:
            raise ValueError(f"组框 {g['title']} 重算后仍与他组相交")


# ══════════ 守卫 ══════════
def topo_snap(sg):
    core = copy.deepcopy(sg)
    for n in core["nodes"]:
        n.pop("pos", None), n.pop("order", None)
    core["groups"] = sorted(g.get("title") for g in core["groups"])
    for io in core["inputs"] + core["outputs"]:
        io.pop("pos", None)
    links = sorted(tuple(lc._iter_links(sg["links"])))
    return json.dumps(core, ensure_ascii=False, sort_keys=True), json.dumps(links)


def geom_snap(sg):
    return json.dumps({"pos": {n["id"]: n["pos"] for n in sg["nodes"]},
                       "groups": [g["bounding"] for g in sg["groups"]],
                       "pins": [io.get("pos") for io in sg["inputs"] + sg["outputs"]]},
                      sort_keys=True)


def extra_guards(sg, form):
    assert all(n["pos"][0] >= 80 and n["pos"][1] >= 80 for n in sg["nodes"]), "负区"
    rects = [(g["title"], (g["bounding"][0], g["bounding"][1],
                           g["bounding"][0] + g["bounding"][2],
                           g["bounding"][1] + g["bounding"][3])) for g in sg["groups"]]
    for i, (t1, a) in enumerate(rects):
        for t2, b in rects[i + 1:]:
            assert (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]), \
                f"组框相交:{t1}×{t2}"
    covered = set()
    for _t, (x0, y0, x1, y1) in rects:
        for n in sg["nodes"]:
            if x0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= x1 \
                    and y0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= y1:
                covered.add(n["id"])
    # 契约分域:t2i Note[7016] 豁免(恒驻入口组外);i2i/edit 全件须罩
    need = {n["id"] for n in sg["nodes"]
            if not (form == "t2i" and n["type"] == "Note")}
    assert covered >= need, f"组框并集缺罩 {sorted(need - covered)}"
    nodes = {n["id"]: n for n in sg["nodes"]}
    for lid, oid, os_, tid, ts_ in lc._iter_links(sg["links"]):
        ox = sg["inputs"][os_]["pos"][0] if oid == -10 else nodes[oid]["pos"][0]
        tx = sg["outputs"][ts_]["pos"][0] if tid == -20 else nodes[tid]["pos"][0]
        assert tx > ox, f"左向线 link{lid}"
    return ["G: pos≥80+组框两两不交+并集罩全件+恒向右"]


def repair(doc, form):
    sg = _sg(doc)
    mem = snap_members(sg)
    topo = topo_snap(sg)
    out = optimize(copy.deepcopy(sg), form)
    out = nudge_est(out)
    regroup(out, mem, set(SEARCH[form]))
    return out, topo


def process(path, form, before):
    raw = path.read_bytes()
    doc = json.loads(raw)
    sg = _sg(doc)
    best, topo = repair(copy.deepcopy(doc), form)
    if geom_snap(sg) == geom_snap(best):
        extra_guards(sg, form)
        assert topo_snap(sg) == topo
        return "applied"
    assert topo_snap(best) == topo, "拓扑被改动(布局-only 失守)"
    extra_guards(best, form)
    doc2 = json.loads(raw)
    for i, s in enumerate(doc2["definitions"]["subgraphs"]):
        if s.get("name") == SG_NAME:
            doc2["definitions"]["subgraphs"][i] = best
    blob = (json.dumps(doc2, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode()
    bak = BAK_ROOT / path.relative_to(REPO)
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(path, bak)
    if hashlib.md5(bak.read_bytes()).hexdigest() != hashlib.md5(raw).hexdigest():
        fail(f"{path.name}: 备份损坏")
    tmp = path.with_name(path.name + f".tmp-{CAMPAIGN}")
    tmp.write_bytes(blob)
    tmp.replace(path)
    reread = _sg(json.loads(path.read_bytes()))
    assert topo_snap(reread) == topo and geom_snap(reread) == geom_snap(best), "回读终验未过"
    for line in extra_guards(reread, form):
        print(f"[{CAMPAIGN}] {path.name}: PASS {line}")
    print(f"[{CAMPAIGN}] {path.name}: 加速域 {dict(zip(KEYS, before))} → "
          f"{dict(zip(KEYS, real_score(reread)))} | 备份=apps/output/bak/qi21-accel-layout-1018/…")
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    states = {}
    for form, p in [("t2i", W / "1_文生图/qi21-道劫-t2i.json"),
                    ("i2i", W / "2_图生图/qi21-道劫-i2i.json"),
                    ("edit", W / "2_图生图/qi21-edit.json"),
                    ("t2i", B / "qi21-道劫-加速子图.json"),
                    ("i2i", B / "qi21-道劫-加速子图-i2i.json"),
                    ("edit", B / "qi21-道劫-加速子图-edit.json")]:
        if not p.exists():
            fail(f"缺文件 {p}")
        doc = json.loads(p.read_bytes())
        before = dict(lc.check_scope("sub", _sg(doc)["nodes"],
                                     list(lc._iter_links(_sg(doc)["links"])),
                                     _sg(doc))["counts"])
        if args.check:
            cand, _topo = repair(copy.deepcopy(doc), form)
            states[p.name] = f"{before} → {dict(zip(KEYS, real_score(cand)))}"
        else:
            states[p.name] = process(p, form, before)
    if args.check:
        for k, v in states.items():
            print(f"[{CAMPAIGN}] --check {k}: {v}")
        return 0
    vals = set(states.values())
    if "applied" in vals and "done" in vals:
        fail(f"六件状态不一致(半批):{states}")
    print(f"[{CAMPAIGN}] " + ("幂等复跑:六件均处已施态,exit 3" if vals == {"applied"}
                              else f"手术完成:{list(states.values())}"))
    return 3 if vals == {"applied"} else 0


if __name__ == "__main__":
    sys.exit(main())
