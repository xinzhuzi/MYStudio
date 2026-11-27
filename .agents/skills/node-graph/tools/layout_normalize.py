#!/usr/bin/env python3
"""
layout_normalize.py — order-preserving layout compaction for GUI (litegraph)
workflow JSON.

Fixes three canvas problems without touching anything but layout fields:
group boxes that overlap each other, nodes poking out of (or wedged into)
their group boxes, and node gaps grown far beyond the spacing target. Nodes
keep their relative order — gaps only ever shrink toward the target ("only
compact, never push") — except where two groups must be separated or a wire
newly passes through a node, the two sanctioned pushes.

Per-scope pipeline (main scope + each definitions.subgraphs[] entry; scopes
are independent coordinate systems, reusing layout_check._scopes()):

  1. boxes:        visual box = layout_check._occl_box; est box = est_size;
                   per-axis overflow = max(0, est - visual)
  2. unstack:      off by default (PARAMS["UNSTACK"]); true visual overlaps
                   are only reported by survey()
  3. membership:   fully inside exactly one box -> that group; fully inside
                   several -> smallest area; else visual-box CENTER inside a
                   box -> that group (smallest); else groupless. Reroute and
                   Note are ordinary members (they are exempt only in the
                   calibers)
  4. group recompute: member bbox + GROUP_PAD; empty groups keep their box
                   and separate as a rigid rectangle
  5. out-of-box:   a groupless node intersecting a (recomputed) box is pushed
                   to the nearest side, net gap >= 0 — never annexed
  6. pair constraints (compression rungs only, EVERY pair of nodes):
                   projections overlap on the axis -> rigid (offset kept);
                   else order constraint  B >= A + wA + min(orig gap,
                   max(target * rung, floor)); floors keep the est calibers
                   from getting worse (constitutional min + overflow /
                   overflow / DIAG_MIN / EXEMPT_MIN)
  7. group constraints: overlapping box pairs get a separation constraint
                   along the majority-voted axis (ties prefer horizontal;
                   order left, right, up, down), the group behind in that
                   direction is pushed, net box gap >= G_MIN — the only
                   sanctioned push; cross-group pair ORDER constraints along
                   the separation axis are relaxed for interleaved groups;
                   non-overlapping pairs get a pad-sum floor so recomputed
                   boxes cannot intersect
  8. solve:        per-axis difference constraints, minimal fixed point
                   (longest path with per-node lower bounds); a positive
                   cycle means the attempt fails
  9. ladder:       rungs x (1, 1.5, 2, inf) — inf means "no compression, fix
                   groups only"; per scope the first rung passing the gate
                   wins; single-pair conflicts also enumerate the other three
                   separation directions; merging two groups ("A + B") is the
                   last resort and restarts the ladder from the tightest rung
 10. gate:         per scope, layout_check calibers may not increase (tolerance
                   via tol=); group_overlap / node_out_of_group / edge_tight
                   must be 0 after
 11. finishing:    coordinates that match the original (within 1e-6) keep the
                   original value, others round UP; group boxes floor their
                   near edges and ceil their far edges (a plain ceil(width)
                   can shave a pad below GROUP_PAD on float positions); the
                   whole scope is translated so the minimum node coordinate is
                   the original minimum when that was >= 80 and exactly 80
                   otherwise; subgraph boundary slots re-pin to the members
                   (x = min - IO_IN / max right + IO_OUT; the slot y sequence
                   keeps its spacing, re-based at member min y + 25); the
                   main scope's extra.ds is set to a fit-the-graph view state
                   (subgraph extra.ds is untouched). The whole solve iterates
                   on its own output until it stops moving, so the returned
                   document is a fixed point of the operator (the wire repair
                   alone can land one rung short of it).

survey() is read-only; strip_layout() removes exactly the layout-field paths
(the structural-diff whitelist); normalize() never mutates its input and
returns None rather than a half-done document when a scope is unresolvable.

CLI:
  python3 layout_normalize.py <wf.json> [--check] [--json] [--ht N] [--vt N]
  python3 layout_normalize.py <wf.json> --apply [--allow-prod]
  python3 layout_normalize.py --selftest [N3,N5]

--check (default) prints a read-only per-scope report. --apply writes the
normalized document back (indent 2, original newline conventions) but
REFUSES, with exit code 3, when the path lives under a production root
(.../comfyui/workflows or .../comfyui/my_nodes/subgraphs) unless --allow-prod
is given — batch jobs own those files. Exit codes: 0 ok, 1 unresolvable
scope, 2 usage / input error, 3 production-root refusal.

This file contains no project codenames; everything project-specific arrives
through the arguments and the workflow JSON itself.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout_check import (  # noqa: E402  (local sibling module)
    CHECK_KEYS, COL_GAP_MIN, FAR_H_DEFAULT, FAR_V_DEFAULT, GROUP_PAD,
    OCCL_SAMPLES, OCCL_TOL, POS_MIN, ROW_GAP_MIN, SPACING_EXEMPT_TYPES,
    _mk_node, _occl_box, _pos, _scopes, _slot_pt, _wire, check_scope,
    check_workflow, est_size)

PARAMS = {"H_T": FAR_H_DEFAULT, "V_T": FAR_V_DEFAULT, "H_MIN": ROW_GAP_MIN,
          "V_MIN": COL_GAP_MIN, "DIAG_MIN": 20.0, "EXEMPT_MIN": 20.0,
          "PAD": GROUP_PAD, "G_GAP": 60.0, "G_MIN": 50.0, "ORIGIN": POS_MIN,
          "IO_IN": 180.0, "IO_OUT": 80.0, "UNSTACK": False}
LADDER = (1.0, 1.5, 2.0, float("inf"))

DIRS = ("L", "R", "U", "D")            # separation-direction vote order
_SAME = 1e-6                           # "coordinate unchanged" tolerance
_MARGIN = OCCL_TOL + 0.5               # occlusion-repair clearance


# --- public API -------------------------------------------------------------------

def normalize(wf, params=PARAMS, ladder=LADDER, tol=None):
    """Compact the layout of a GUI workflow, order-preserving.

    tol: None       = every caliber allows zero increase (strict);
         dict       = {caliber: allowed increase}, the same for every scope;
         callable   = (scope name, before counts) -> {caliber: allowed inc}.
    Returns (new document or None, report). Input that is not a dict with a
    nodes list passes through as (wf, {"scopes": {}, "applied": False}); any
    unresolvable scope yields (None, report) — never a half-done document.
    The input is never mutated.

    The solve is iterated on its own output until it stops moving: the
    wire-occlusion repair raises per-node bounds that the next application
    re-derives, and a single pass can land one rung short of the fixed point
    the acceptance口径 demands (R4: every file is a fixed point of this
    operator). The returned report is the final (stable) application's; on
    files already at the fixed point it costs one pass.

    1127 回归修正:容差边界件存在「双稳态振荡」(solve(A)=B、solve(B)=A;实测
    t2i-通用 子图交叉 39↔41↔44 循环)——迭代改为带环检测:检出重复态即取环上
    「质量最优态」(判据逐项最小,canonical 决胜)为代表并返回;对代表态再解
    一次仍是原样,apply 的幂等闸与全库不动点检查才对所有件成立。"""
    if not isinstance(wf, dict) or not isinstance(wf.get("nodes"), list):
        return wf, {"scopes": {}, "applied": False}
    if callable(tol):
        # R4 不动点(1127 回归修正):callable 容差只按「整治前原件」取数并全程
        # 钉死,不再逐轮按当前文档重算(放行量水涨船高会加剧漂移)。
        params0 = dict(params)
        entry = {}
        for nm, nds, lks, sgd in _scopes(wf):
            brep = check_scope(nm, nds, lks, sgd,
                               groups=((wf.get("groups") or []) if sgd is None else None),
                               layout={"ht": params0["H_T"], "vt": params0["V_T"]})
            entry[nm] = dict(tol(nm, _merged_counts(brep)) or {})
        tol = lambda scope, before: entry.get(scope) or {}
    doc, report = _solve_document(wf, params, ladder, tol)
    if doc is None:
        return None, report
    if doc == wf:
        # Already at the operator's fixed point: the solve is deterministic
        # (pure function of the input), so re-solving its own output would
        # return the same document and the same report — skip the verification
        # pass. What doc == wf states IS the fixed-point property (R4); the
        # re-solve only ever adds information when doc differs from wf.
        return doc, report
    merges_total = {s: v["merges"] for s, v in report["scopes"].items()}

    def _obj_key(pair):
        rep = pair[1]
        sums = []
        for k in ("crossings", "occlusion", "est_overlap", "spacing_far",
                  "edge_tight", "node_out_of_group", "group_overlap"):
            sums.append(sum(int(v.get("after", {}).get(k, 0))
                            for v in rep["scopes"].values()))
        return tuple(sums)

    pairs = []                                   # [(doc, rep, canonical)] 走过的态
    index = {}                                   # canonical → trail 下标
    settled = False
    for _ in range(12):
        key = json.dumps(doc, ensure_ascii=False, sort_keys=True)
        hit = index.get(key)
        if hit is not None:
            cycle = pairs[hit:]
            doc, report = min(cycle, key=lambda p: (_obj_key(p[:2]), p[2]))[:2]
            settled = True
            break
        index[key] = len(pairs)
        pairs.append((doc, report, key))
        doc2, rep2 = _solve_document(doc, params, ladder, tol)
        if doc2 is None:
            settled = True                       # keep the last resolvable result
            break
        for s, v in rep2["scopes"].items():
            merges_total[s] = merges_total.get(s, 0) + v["merges"]
        if doc2 == doc:
            report = rep2
            settled = True
            break
        doc, report = doc2, rep2
    # 未 settled = 罩到上限仍单向移动(未见环):返回末态,交由批处理幂等闸处置。
    for s in report["scopes"]:
        if s in merges_total and merges_total[s]:
            report["scopes"][s] = dict(report["scopes"][s])
            report["scopes"][s]["merges"] = merges_total[s]
    report["applied"] = (doc != wf)
    return doc, report


def _solve_document(wf, params, ladder, tol):
    """One application of the compaction operator (no entry check, no
    fixed-point iteration)."""
    params = dict(params)
    scopes0 = list(_scopes(wf))
    befores = [check_scope(nm, nds, lks, sgd,
                           groups=((wf.get("groups") or []) if sgd is None else None),
                           layout={"ht": params["H_T"], "vt": params["V_T"]})
               for nm, nds, lks, sgd in scopes0]
    doc = copy.deepcopy(wf)
    dscopes = list(_scopes(doc))
    report = {"applied": False, "scopes": {}}
    solved = []
    for (nm, nds, lks, sgd), brep in zip(scopes0, befores):
        if tol is None:
            tm = {}
        elif callable(tol):
            tm = dict(tol(nm, _merged_counts(brep)) or {})
        else:
            tm = dict(tol)
        grp = (wf.get("groups") or []) if sgd is None else ((sgd or {}).get("groups") or [])
        cand, merges, rung = _compact_scope(nm, nds, lks, sgd, grp, params,
                                            ladder, tm, brep)
        report["scopes"][nm] = {
            "rung": rung,
            "before": _merged_counts(brep),
            "after": _merged_counts(brep) if cand is None else cand["after"],
            "merges": merges,
            "unresolvable": cand is None}
        if cand is None:
            return None, report
        solved.append(cand)
    for (nm, nds, lks, sgd), cand in zip(dscopes, solved):
        for i, nd in enumerate(nds):
            nd["pos"] = list(cand["final"][i])
        # R6 结构对拍纪律(1127 回归修正):原文档没有的键不得新增。groups 只在
        # 原作用域本来就有该键、或求解真的产生了组时才写回;给稀疏件(子图蓝图等)
        # 注入空壳 groups 会让批处理按 strip_mismatch 拒写,不动点也永不成真。
        groups_out = copy.deepcopy(cand["groups"])
        if sgd is None:
            if groups_out or "groups" in wf:
                doc["groups"] = groups_out
        else:
            if groups_out or "groups" in sgd:
                sgd["groups"] = groups_out
            for key in ("inputs", "outputs"):
                if key in sgd and cand["sg"] is not None and key in cand["sg"]:
                    sgd[key] = copy.deepcopy(cand["sg"][key])
    # main-scope view state: "open and see the whole graph" (§4 step 11).
    # Uses only the main scope's node visual boxes; subgraph extra.ds untouched.
    mnodes = dscopes[0][1] if dscopes else []
    if mnodes:
        bs = [_occl_box(nd) for nd in mnodes]
        x0 = min(b[0] for b in bs)
        y0 = min(b[1] for b in bs)
        w = max(max(b[2] for b in bs) - x0, 1.0)
        h = max(max(b[3] for b in bs) - y0, 1.0)
        scale = round(min(1.0, 1520.0 / w, 820.0 / h), 3)
        off = [round((1600.0 - w * scale) / 2 - x0 * scale),
               round((900.0 - h * scale) / 2 - y0 * scale)]
        if not isinstance(doc.get("extra"), dict):
            doc["extra"] = {}
        doc["extra"]["ds"] = {"scale": scale, "offset": off}
    report["applied"] = (doc != wf)
    return doc, report


def strip_layout(wf):
    """Deep copy with exactly the layout-field paths removed (the structural
    diff whitelist): nodes[].pos, groups[].bounding, top-level extra.ds,
    definitions.subgraphs[].nodes[].pos / groups[].bounding / inputs[].pos /
    outputs[].pos. size is NOT removed."""
    doc = copy.deepcopy(wf)
    if not isinstance(doc, dict):
        return doc
    for nd in doc.get("nodes") or []:
        if isinstance(nd, dict):
            nd.pop("pos", None)
    for g in doc.get("groups") or []:
        if isinstance(g, dict):
            g.pop("bounding", None)
    extra = doc.get("extra")
    if isinstance(extra, dict):
        extra.pop("ds", None)
        if not extra:
            # ds 是白名单字段(§4 step 11 会给原本没有的件补视图态):ds 摘除后
            # 变空的 extra 容器视同无键,否则「补视图态」本身就成了结构漂移
            # (1127 回归修正;design §5.4 白名单语义)。
            doc.pop("extra")
    for sg in ((doc.get("definitions") or {}).get("subgraphs")) or []:
        if not isinstance(sg, dict):
            continue
        for nd in sg.get("nodes") or []:
            if isinstance(nd, dict):
                nd.pop("pos", None)
        for g in sg.get("groups") or []:
            if isinstance(g, dict):
                g.pop("bounding", None)
        for io in list(sg.get("inputs") or []) + list(sg.get("outputs") or []):
            if isinstance(io, dict):
                io.pop("pos", None)
    return doc


def _groups_merge_equal(old_groups, new_groups):
    """组列表的合并豁免比较(design §6 步骤 9:「并组」是设计动作,标题「A + B」)。
    新列表的每组必须能在旧列表里按原相对顺序找到一个「除 title 外逐键相等」
    的组(bounding 已被 strip_layout 剔除),途中跳过的旧组 = 被并掉,放行;
    找不到这样的旧组 → 新造组或幸存组重排,不等。(1127 回归二次修正:不少库件
    的组没有 id 键,id 匹配会退化成逐位错配——加速子图-edit 的并组组色 #88A
    被错配到 ②viggle 的 #3f78d3——改为按剩余字段贪心配对。)"""
    if old_groups is None or new_groups is None:
        return old_groups == new_groups
    if not all(isinstance(g, dict) for g in old_groups) or \
       not all(isinstance(g, dict) for g in new_groups):
        return old_groups == new_groups
    i = 0
    for g in new_groups:
        rest = {k: v for k, v in g.items() if k != "title"}
        found = False
        while i < len(old_groups):
            old_rest = {k: v for k, v in old_groups[i].items() if k != "title"}
            i += 1
            if old_rest == rest:
                found = True            # 幸存组按原序留任
                break
            # 其余字段不等 = 这一旧组是被并掉的组,跳过放行
        if not found:
            return False                # 新造组,或幸存组顺序被换
    return True


def structurally_equal(old, new):
    """R6 结构对拍(1127 回归补齐):剔布局字段(strip_layout)后递归比较;
    每个容器层面的 groups 走合并豁免(_groups_merge_equal,design §6 步骤 9
    「并组」是设计动作),其余键严格相等——任何节点增删、连线变化、键增删、
    幸存组字段漂移都判不等。供批处理 apply 与蓝图同步的拒写闸使用。"""
    return _struct_eq(strip_layout(old), strip_layout(new))


def _struct_eq(a, b):
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        ka, kb = dict(a), dict(b)
        ga, gb = ka.pop("groups", None), kb.pop("groups", None)
        if set(ka) != set(kb) or not _groups_merge_equal(ga, gb):
            return False
        return all(_struct_eq(ka[k], kb[k]) for k in ka)
    if isinstance(a, list):
        if len(a) != len(b):
            return False
        return all(_struct_eq(x, y) for x, y in zip(a, b))
    return a == b


# --- geometry helpers ----------------------------------------------------------------

def _intersects(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _fully_inside(a, b):
    return a[0] >= b[0] and a[1] >= b[1] and a[2] <= b[2] and a[3] <= b[3]


def _area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def _axis_pad(axis):
    """Facing pad sum of two group boxes on an axis (x: left+right, y: top+bottom)."""
    return GROUP_PAD[0] + GROUP_PAD[2] if axis == 0 else GROUP_PAD[1] + GROUP_PAD[3]


def _proj(box, axis):
    return (box[0], box[2]) if axis == 0 else (box[1], box[3])


def _membership(vis, group_boxes):
    """Design step 3: fully inside exactly one box -> that group; fully inside
    several -> smallest area; else visual-box center inside a box -> smallest
    such group; else groupless. Returns member_of (node idx -> group idx/None)."""
    member_of = [None] * len(vis)
    areas = [_area(b) if b else float("inf") for b in group_boxes]
    for i, vb in enumerate(vis):
        cands = [gi for gi, gb in enumerate(group_boxes)
                 if gb is not None and _fully_inside(vb, gb)]
        if cands:
            member_of[i] = min(cands, key=lambda g: (areas[g], g))
            continue
        cx, cy = (vb[0] + vb[2]) / 2.0, (vb[1] + vb[3]) / 2.0
        cands = [gi for gi, gb in enumerate(group_boxes)
                 if gb is not None and gb[0] <= cx <= gb[2] and gb[1] <= cy <= gb[3]]
        if cands:
            member_of[i] = min(cands, key=lambda g: (areas[g], g))
    return member_of


def _solve_lb(lbs, edges):
    """Minimal fixed point of x_j >= x_i + w with x_i >= lbs[i]: longest-path
    relaxation (queue-based Bellman-Ford). Returns the value list, or None on
    a positive cycle (unsolvable). Zero cycles — rigid pairs — are fine."""
    n = len(lbs)
    adj = [[] for _ in range(n)]
    for i, j, w in edges:
        adj[i].append((j, w))
    x = [float(v) for v in lbs]
    inq = [True] * n
    q = deque(range(n))
    hits = [0] * n
    while q:
        i = q.popleft()
        inq[i] = False
        base = x[i]
        for j, w in adj[i]:
            nv = base + w
            if nv > x[j] + 1e-9:
                x[j] = nv
                hits[j] += 1
                if hits[j] > n:
                    return None                     # positive cycle
                if not inq[j]:
                    inq[j] = True
                    q.append(j)
    return x


def _rung_str(r):
    if r is None or math.isinf(r):
        return "inf"
    return "%g" % r


def _merged_counts(rep):
    return {**rep["counts"], **(rep.get("layout") or {})}


# --- per-scope solver ------------------------------------------------------------------

def _behind_key(box, d):
    """Sort key: the group further along direction d is "behind" (gets pushed).
    Center first, then leading edge; equal keys -> the first-listed group."""
    if d in ("L", "R"):
        c, lead = (box[0] + box[2]) / 2.0, (box[2] if d == "R" else box[0])
    else:
        c, lead = (box[1] + box[3]) / 2.0, (box[3] if d == "D" else box[1])
    s = 1.0 if d in ("R", "D") else -1.0
    return (s * c, s * lead)


def _sep_delta(stay, push, d, gap):
    """Signed translation so PUSH, moved in direction d, sits >= gap away from
    STAY (0.0 when already far enough)."""
    if d == "R":
        need = stay[2] + gap - push[0]
        return need if need > 0 else 0.0
    if d == "L":
        need = stay[0] - gap - push[2]
        return need if need < 0 else 0.0
    if d == "D":
        need = stay[3] + gap - push[1]
        return need if need > 0 else 0.0
    need = stay[1] - gap - push[3]
    return need if need < 0 else 0.0


def _shift_box(box, d, delta):
    if d in ("L", "R"):
        return (box[0] + delta, box[1], box[2] + delta, box[3])
    return (box[0], box[1] + delta, box[2], box[3] + delta)


def _compact_scope(name, nodes, links, sg, groups, params, ladder, tol_map, before_rep):
    """Solve one scope. Returns (candidate, merges, rung-str) where candidate
    is None when the scope is unresolvable."""
    n = len(nodes)
    p0 = [(_pos(nd)[0], _pos(nd)[1]) for nd in nodes]
    vis0 = [_occl_box(nd) for nd in nodes]
    vsize = [(b[2] - b[0], b[3] - b[1]) for b in vis0]
    esize = [(float(est_size(nd)[0]), float(est_size(nd)[1])) for nd in nodes]
    over = [(max(0.0, esize[i][0] - vsize[i][0]), max(0.0, esize[i][1] - vsize[i][1]))
            for i in range(n)]

    def _mbox(members, pos):
        xs0 = min(pos[i][0] for i in members)
        ys0 = min(pos[i][1] for i in members)
        xs1 = max(pos[i][0] + vsize[i][0] for i in members)
        ys1 = max(pos[i][1] + vsize[i][1] for i in members)
        return (xs0 - GROUP_PAD[0], ys0 - GROUP_PAD[1],
                xs1 + GROUP_PAD[2], ys1 + GROUP_PAD[3])

    boxes0 = []
    for g in groups:
        b = g.get("bounding")
        # litegraph bounding is [x, y, w, h]; internal boxes are (x0, y0, x1, y1)
        boxes0.append((float(b[0]), float(b[1]), float(b[0]) + float(b[2]),
                       float(b[1]) + float(b[3])) if b and len(b) == 4 else None)
    # membership and box recompute iterate to a fixpoint: a recomputed box can
    # swallow a node the original box missed (annex it, recompute again)
    member0 = _membership(vis0, boxes0)
    state = []
    for gi, g in enumerate(groups):
        members = [i for i in range(n) if member0[i] == gi]
        state.append({"g": g, "title": str(g.get("title") or "?"),
                      "members": members, "empty": boxes0[gi] if not members else None})
    for _round in range(4):
        cur_boxes = []
        for e in state:
            cur_boxes.append(_mbox(e["members"], p0) if e["members"] else e["empty"])
        member1 = _membership(vis0, cur_boxes)
        if member1 == member0:
            break
        member0 = member1
        for gi, e in enumerate(state):
            e["members"] = [i for i in range(n) if member0[i] == gi]
            e["empty"] = e["empty"] if e["members"] else (e["empty"] or boxes0[gi])

    def _vote(ea, eb, boxa, boxb):
        """Separation direction for a conflicting pair: majority member-pair
        orientation (the axis where the displacement dominates), ties prefer
        horizontal and then the order left, right, up, down; pairs with an
        empty group vote by the two box centers."""
        if ea["members"] and eb["members"]:
            tally = {d: 0 for d in DIRS}
            for i in ea["members"]:
                for j in eb["members"]:
                    dx = (vis0[j][0] + vis0[j][2]) / 2.0 - (vis0[i][0] + vis0[i][2]) / 2.0
                    dy = (vis0[j][1] + vis0[j][3]) / 2.0 - (vis0[i][1] + vis0[i][3]) / 2.0
                    if abs(dx) >= abs(dy):
                        tally["R" if dx > 0 else "L"] += 1
                    else:
                        tally["D" if dy > 0 else "U"] += 1
            return max(DIRS, key=lambda d: (tally[d], -DIRS.index(d)))
        dx = (boxb[0] + boxb[2]) / 2.0 - (boxa[0] + boxa[2]) / 2.0
        dy = (boxb[1] + boxb[3]) / 2.0 - (boxa[1] + boxa[3]) / 2.0
        if abs(dx) >= abs(dy):
            return "R" if dx > 0 else "L"
        return "D" if dy > 0 else "U"

    # ---- finishing: origin translation, rounding, group boxes, slot re-pin -------
    def _finalize(vals, ebox):
        moved = []
        for axis in (0, 1):
            vs = list(vals[axis])
            if n:
                om = min(p0[i][axis] for i in range(n))
                # original minimum >= 80 -> translate back to it (no move when
                # the solve kept it); below 80 -> lift the whole scope so the
                # minimum is exactly 80 (node coordinates only, never slots)
                tgt = om if om >= params["ORIGIN"] else params["ORIGIN"]
                d = tgt - min(vs)
                vs = [v + d for v in vs]
            moved.append(vs)
        final = []
        for i in range(n):
            row = []
            for axis in (0, 1):
                v = moved[axis][i]
                o = p0[i][axis]
                row.append(o if abs(v - o) < _SAME else math.ceil(v))
            final.append(row)
        tnodes = [dict(nodes[i], pos=list(final[i])) for i in range(n)]
        groups_out = []
        for si, e in enumerate(state):
            g2 = dict(e["g"])
            if e["members"]:
                l = min(final[i][0] for i in e["members"]) - GROUP_PAD[0]
                t = min(final[i][1] for i in e["members"]) - GROUP_PAD[1]
                r = max(final[i][0] + vsize[i][0] for i in e["members"]) + GROUP_PAD[2]
                b = max(final[i][1] + vsize[i][1] for i in e["members"]) + GROUP_PAD[3]
                # floor the near edges, ceil the far edges: with float member
                # positions a "ceil(width)" box can shave a pad below GROUP_PAD
                g2["bounding"] = [math.floor(l), math.floor(t),
                                  math.ceil(r) - math.floor(l),
                                  math.ceil(b) - math.floor(t)]
            else:
                eb = ebox.get(si, e["empty"])
                g2["bounding"] = [math.floor(eb[0]), math.floor(eb[1]),
                                  math.ceil(eb[2]) - math.floor(eb[0]),
                                  math.ceil(eb[3]) - math.floor(eb[1])]
            groups_out.append(g2)
        sg_out = dict(sg) if sg is not None else None
        if sg_out is not None:
            sg_out["nodes"] = tnodes
            sg_out["groups"] = groups_out
            # boundary-slot re-pin: slots travel with the members; the y
            # sequences keep their own spacing, re-based at member min y + 25;
            # slots without an original pos are not invented
            if n:
                minx = min(final[i][0] for i in range(n))
                maxr = max(final[i][0] + vsize[i][0] for i in range(n))
                miny = min(final[i][1] for i in range(n))
            else:
                minx = miny = 0.0
                maxr = 0.0
            for key, base in (("inputs", params["IO_IN"]), ("outputs", params["IO_OUT"])):
                ios = [dict(io) for io in (sg.get(key) or [])]
                seq = [float(io["pos"][1]) for io in ios if io.get("pos")]
                y0 = min(seq) if seq else 0.0
                for io in ios:
                    if io.get("pos"):
                        io["pos"] = [minx - base if key == "inputs" else maxr + base,
                                     (float(io["pos"][1]) - y0) + miny + 25]
                sg_out[key] = ios
        return final, groups_out, sg_out, tnodes

    def _trep(final, groups_out, sg_out, tnodes):
        return check_scope(name, tnodes, links, sg_out,
                           groups=(None if sg is not None else groups_out),
                           layout={"ht": params["H_T"], "vt": params["V_T"]})

    byid = {nodes[i]["id"]: i for i in range(n)}

    def _gate_ok(rep):
        """Step 10: per scope, existing calibers may not increase (tolerance
        via tol), group_overlap / node_out_of_group / edge_tight must be 0."""
        for k in CHECK_KEYS:
            av = rep["counts"].get(k, 0)
            if k == "group_overlap":
                if av > 0:
                    return False
            elif av > before_rep["counts"].get(k, 0) + tol_map.get(k, 0):
                return False
        lay = rep.get("layout") or {}
        return lay.get("node_out_of_group", 0) == 0 and lay.get("edge_tight", 0) == 0

    def _occ_nodes(rep):
        out = set()
        for v in rep["violations"]:
            if v["check"] == "occlusion":
                for nid in v.get("nodes", []):
                    out.add(nid)
        return out

    def _wire_clearance(idx, tnodes):
        """Lowest y (top edge) placing node idx clear BELOW every wire that
        crosses its x-range; None when no wire passes through its box."""
        worst = None
        for lid, oid, os_, tid, ts_ in links:
            io, it = byid.get(oid), byid.get(tid)
            if io is None or it is None:
                continue                      # boundary endpoints have no box
            p0w = _slot_pt(tnodes[io], os_, "out")
            p3w = _slot_pt(tnodes[it], ts_, "in")
            vb = _occl_box(tnodes[idx])
            ys = [y for (_x, y) in _wire(p0w, p3w, OCCL_SAMPLES)
                  if vb[0] - OCCL_TOL <= _x <= vb[2] + OCCL_TOL]
            if ys and any(vb[1] - OCCL_TOL <= y <= vb[3] + OCCL_TOL for y in ys):
                m = max(ys) + _MARGIN
                worst = m if worst is None else max(worst, m)
        return worst

    def _finish_with_gate(vals, ebox, edges, lbs, repairable):
        """Gate the attempt; when a compression rung newly pushes a wire
        through a node, try the sanctioned repair — raise that node's y lower
        bound clear below the wire and re-solve — before giving the rung up."""
        for _it in range(12):
            final, groups_out, sg_out, tnodes = _finalize(vals, ebox)
            rep = _trep(final, groups_out, sg_out, tnodes)
            if _gate_ok(rep):
                return {"final": final, "groups": groups_out, "sg": sg_out,
                        "after": _merged_counts(rep)}
            if not repairable:
                return None
            fresh = _occ_nodes(rep) - _occ_nodes(before_rep)
            raised = False
            for nid in sorted(fresh, key=str):
                idx = byid.get(nid)
                if idx is None:
                    continue
                lb = _wire_clearance(idx, tnodes)
                if lb is not None and lb > lbs[1][idx] + 1e-9:
                    lbs[1][idx] = lb
                    raised = True
            if not raised:
                return None
            vy = _solve_lb(lbs[1], edges[1])
            if vy is None:
                return None
            vals = [vals[0], vy]
        return None

    def _extreme(members, axis, far, pos):
        """Member index with the smallest pos (far=False) or the largest end
        (far=True) on an axis; deterministic on ties (lowest index)."""
        best = None
        for i in members:
            v = pos[i][axis] + (vsize[i][axis] if far else 0.0)
            if best is None or (v > best[0] if far else v < best[0]) \
                    or (v == best[0] and i < best[1]):
                best = (v, i)
        return best[1]

    def _attempt(rung, override=None):
        """One solve attempt at one ladder rung. Steps 3-5 (membership is
        precomputed, box recompute, out-of-box push) then, at the inf rung,
        step-7 separation by whole-group translation; at compression rungs the
        pair constraints (every pair, both axes), the group separation edges
        with the inter-axis relaxation, the group floors and the empty-box
        guards feed the per-axis solver. `override` fixes the separation
        direction for specific group pairs (direction enumeration)."""
        wpos = [list(p) for p in p0]
        ebox = {si: e["empty"] for si, e in enumerate(state) if not e["members"]}
        g_of = [None] * n
        for si, e in enumerate(state):
            for i in e["members"]:
                g_of[i] = si

        def wbox(i):
            x, y = wpos[i]
            return (x, y, x + vsize[i][0], y + vsize[i][1])

        def boxes_w():
            out = []
            for si, e in enumerate(state):
                if e["members"]:
                    out.append(_mbox(e["members"], wpos))
                else:
                    out.append(ebox.get(si))
            return out

        # step 5: push groupless nodes out of the (recomputed) boxes
        for _ in range(4 * len(state) + 8):
            moved = False
            bxs = boxes_w()
            for i in range(n):
                if g_of[i] is not None:
                    continue
                vb = wbox(i)
                for gb in bxs:
                    if gb is None or not _intersects(vb, gb) or _fully_inside(vb, gb):
                        continue
                    cand = [(vb[2] - gb[0], 0, 0, gb[0] - vb[2]),
                            (gb[2] - vb[0], 1, 0, gb[2] - vb[0]),
                            (vb[3] - gb[1], 2, 1, gb[1] - vb[3]),
                            (gb[3] - vb[1], 3, 1, gb[3] - vb[1])]
                    _, _, axis, delta = min(cand)
                    wpos[i][axis] += delta
                    moved = True
                    break
                if moved:
                    break
            if not moved:
                break

        # step 7, part one: resolve conflicts by translation where possible —
        # empty groups translate their box (a rigid rectangle, constant during
        # the solve); the inf rung also translates membered groups wholesale.
        # Along the voted separation axis the two groups' relative order may
        # change (the sanctioned relaxation); intra-group order never does.
        sep_dirs = {}
        for _ in range(4 * len(state) + 8):
            moved = False
            bxs = boxes_w()
            for a in range(len(state)):
                for b2 in range(a + 1, len(state)):
                    ba, bb = bxs[a], bxs[b2]
                    if not (ba and bb and _intersects(ba, bb)):
                        continue
                    d = (override or {}).get((a, b2)) or _vote(state[a], state[b2], ba, bb)
                    pushed = a if _behind_key(ba, d) >= _behind_key(bb, d) else b2
                    stay = b2 if pushed == a else a
                    delta = _sep_delta(bxs[stay], bxs[pushed], d, params["G_MIN"])
                    if not delta:
                        continue
                    if not state[pushed]["members"]:
                        ebox[pushed] = _shift_box(bxs[pushed], d, delta)
                        moved = True
                        bxs = boxes_w()
                    elif math.isinf(rung):
                        axis = 0 if d in ("L", "R") else 1
                        for m in state[pushed]["members"]:
                            wpos[m][axis] += delta
                        moved = True
                        bxs = boxes_w()
                    else:
                        sep_dirs[(a, b2)] = d      # handled as solver edges
            if not moved:
                break
        bxs = boxes_w()
        for a in range(len(state)):
            for b2 in range(a + 1, len(state)):
                if bxs[a] and bxs[b2] and _intersects(bxs[a], bxs[b2]) \
                        and (a, b2) not in sep_dirs:
                    return None              # separation failed this attempt

        if math.isinf(rung):
            vals = [[wpos[i][0] for i in range(n)], [wpos[i][1] for i in range(n)]]
            return _finish_with_gate(vals, ebox, None, None, False)

        # ---- compression rung: build the per-axis difference constraints ----
        edges = ([], [])
        lbs = ([params["ORIGIN"]] * n, [params["ORIGIN"]] * n)
        relax = {}
        tx = params["H_T"] * rung
        ty = params["V_T"] * rung

        def est_wbox(i):
            x, y = wpos[i]
            return (x, y, x + esize[i][0], y + esize[i][1])

        def pair_gap(i, j, axis, gap0):
            """min(original gap, max(target, floor)) — take the small side of
            the min so a pair only ever shrinks. The floor keeps the est
            calibers from getting worse: exempt pairs (Reroute / MarkdownNote)
            EXEMPT_MIN; diagonal pairs (separated on both axes) DIAG_MIN;
            otherwise, by the est net distance on this axis: >= the
            constitutional min -> min + overflow; >= 0 -> overflow; already
            est-overlapping -> 0 (the count cannot grow by deepening)."""
            if nodes[i].get("type") in SPACING_EXEMPT_TYPES \
                    or nodes[j].get("type") in SPACING_EXEMPT_TYPES:
                floor = params["EXEMPT_MIN"]
            else:
                oax = 1 - axis
                poi, poj = _proj(wbox(i), oax), _proj(wbox(j), oax)
                if not (poi[1] > poj[0] and poj[1] > poi[0]):
                    floor = params["DIAG_MIN"]
                else:
                    epi, epj = _proj(est_wbox(i), axis), _proj(est_wbox(j), axis)
                    lo, hi = (epi, epj) if epi[0] <= epj[0] else (epj, epi)
                    egap = hi[0] - lo[1]
                    const = params["H_MIN"] if axis == 0 else params["V_MIN"]
                    ov = over[i][axis] + over[j][axis]
                    floor = (const + ov) if egap >= const else (ov if egap >= 0 else 0.0)
            target = tx if axis == 0 else ty
            return min(gap0, max(target, floor))

        # separation edges between extreme members, plus the axis relaxation
        for (a, b2), d in sep_dirs.items():
            axis = 0 if d in ("L", "R") else 1
            bxs = boxes_w()
            ba, bb = bxs[a], bxs[b2]
            if not (ba and bb and _intersects(ba, bb)):
                continue
            pushed = a if _behind_key(ba, d) >= _behind_key(bb, d) else b2
            stay = b2 if pushed == a else a
            P = state[pushed]["members"]
            S = state[stay]["members"]
            gapc = _axis_pad(axis) + params["G_MIN"]
            if not S:
                eb = bb if pushed == a else ba
                if d in ("R", "D"):
                    h = _extreme(P, axis, False, wpos)
                    pad = GROUP_PAD[2] if axis == 0 else GROUP_PAD[3]
                    lbs[axis][h] = max(lbs[axis][h],
                                       (eb[2] if axis == 0 else eb[3]) + pad + params["G_MIN"])
                else:
                    return None              # upper bound not expressible here
            elif d in ("R", "D"):
                s = _extreme(S, axis, True, wpos)
                h = _extreme(P, axis, False, wpos)
                edges[axis].append((s, h, vsize[s][axis] + gapc))
            else:
                h2 = _extreme(P, axis, True, wpos)
                s2 = _extreme(S, axis, False, wpos)
                edges[axis].append((h2, s2, vsize[h2][axis] + gapc))
            relax[frozenset((a, b2))] = axis

        # step 6: pair constraints, every pair, both axes
        for i in range(n):
            for j in range(i + 1, n):
                gi, gj = g_of[i], g_of[j]
                skip = set()
                if gi is not None and gj is not None and gi != gj:
                    ax = relax.get(frozenset((gi, gj)))
                    if ax is not None:
                        skip.add(ax)
                for axis in (0, 1):
                    if axis in skip:
                        continue
                    pai, paj = _proj(wbox(i), axis), _proj(wbox(j), axis)
                    if pai[1] > paj[0] and paj[1] > pai[0]:
                        # projections overlap -> relative position is rigid
                        dd = wpos[j][axis] - wpos[i][axis]
                        edges[axis].append((i, j, dd))
                        edges[axis].append((j, i, -dd))
                    else:
                        if paj[0] >= pai[1]:
                            li, lj = i, j
                        else:
                            li, lj = j, i
                        gap0 = _proj(wbox(lj), axis)[0] - _proj(wbox(li), axis)[1]
                        gap = pair_gap(i, j, axis, gap0)
                        edges[axis].append((li, lj, vsize[li][axis] + gap))

        # group floors: non-conflicting membered pairs cannot grow boxes that
        # touch (pad-sum floor on the axes where the member bboxes are apart)
        sep_keys = set(sep_dirs)
        for a in range(len(state)):
            for b2 in range(a + 1, len(state)):
                if (a, b2) in sep_keys:
                    continue
                ma, mb = state[a]["members"], state[b2]["members"]
                if not ma or not mb:
                    continue
                for axis in (0, 1):
                    ea = _proj(_mbox(ma, wpos), axis)
                    eb_ = _proj(_mbox(mb, wpos), axis)
                    if ea[1] <= eb_[0]:
                        gap0, leftm, rightm = eb_[0] - ea[1], ma, mb
                    elif eb_[1] <= ea[0]:
                        gap0, leftm, rightm = ea[0] - eb_[1], mb, ma
                    else:
                        continue
                    gap = min(gap0, max(params["G_GAP"], _axis_pad(axis)))
                    s = _extreme(leftm, axis, True, wpos)
                    h = _extreme(rightm, axis, False, wpos)
                    edges[axis].append((s, h, vsize[s][axis] + gap))

        # empty boxes are constants: nodes starting right of / below one must
        # stay clear of it (the solver never moves nodes the other way)
        for si in range(len(state)):
            eb = ebox.get(si)
            if state[si]["members"] or eb is None:
                continue
            for i in range(n):
                for axis in (0, 1):
                    pe = (eb[0], eb[2]) if axis == 0 else (eb[1], eb[3])
                    pi = _proj(wbox(i), axis)
                    if pi[0] >= pe[1]:
                        target = tx if axis == 0 else ty
                        gap = min(pi[0] - pe[1], max(target, params["DIAG_MIN"]))
                        lbs[axis][i] = max(lbs[axis][i], pe[1] + gap)

        vx = _solve_lb(lbs[0], edges[0])
        if vx is None:
            return None
        vy = _solve_lb(lbs[1], edges[1])
        if vy is None:
            return None
        return _finish_with_gate([vx, vy], ebox, edges, lbs, True)

    # ---- driver: ladder round, direction enumeration, merge retry -----------------
    def _static_boxes():
        out = []
        for e in state:
            if e["members"]:
                out.append(_mbox(e["members"], p0))
            else:
                out.append(e["empty"])
        return out

    def _conflicts():
        bxs = _static_boxes()
        return [(i, j) for i in range(len(state)) for j in range(i + 1, len(state))
                if bxs[i] and bxs[j] and _intersects(bxs[i], bxs[j])]

    def _merge(i, j):
        keep, drop = state[i], state[j]
        keep["members"] = keep["members"] + drop["members"]
        if not keep["members"]:
            ka, da = keep["empty"], drop["empty"]
            keep["empty"] = (min(ka[0], da[0]), min(ka[1], da[1]),
                             max(ka[2], da[2]), max(ka[3], da[3]))
        keep["title"] = "%s + %s" % (keep["title"], drop["title"])
        keep["g"] = dict(keep["g"])
        keep["g"]["title"] = keep["title"]
        del state[j]

    def _ladder_round(override=None):
        for rung in ladder:
            cand = _attempt(rung, override)
            if cand is not None:
                return cand, rung
        return None, None

    merges = 0
    if not ladder:
        # empty ladder -> straight to "unresolvable", no merging, no attempts
        return None, 0, "inf"
    while True:
        bxs = _static_boxes()
        conf = _conflicts()
        dirs = {}
        for (i, j) in conf:
            dirs[(i, j)] = _vote(state[i], state[j], bxs[i], bxs[j])
        got, rung = _ladder_round()
        if got is not None:
            return got, merges, _rung_str(rung)
        if len(conf) == 1:
            (i, j) = conf[0]
            voted = dirs[(i, j)]
            for d in DIRS:                      # the other three directions
                if d == voted:
                    continue
                got, rung = _ladder_round({(i, j): d})
                if got is not None:
                    return got, merges, _rung_str(rung)
        if conf and len(state) >= 2:
            i, j = conf[0]                      # merge is the last resort
            _merge(i, j)
            merges += 1
            continue
        return None, merges, "inf"


def survey(wf, params=PARAMS):
    """Read-only per-scope caliber snapshot: {"<scope>": {"node_out_of_group":
    n, "edge_tight": n, "spacing_far": n, "visual_overlaps": n}}. The three
    calibers come straight from check_workflow(..., layout=) — no reimplemented
    caliber here; visual_overlaps counts node pairs whose visual boxes truly
    overlap (reported only: unstacking is off by default)."""
    if not isinstance(wf, dict) or not isinstance(wf.get("nodes"), list):
        return {}
    out = {}
    reps = check_workflow(wf, layout={"ht": params["H_T"], "vt": params["V_T"]},
                          checks=())
    for (name, nodes, _links, _sg), rep in zip(_scopes(wf), reps):
        boxes = [_occl_box(nd) for nd in nodes]
        vo = 0
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if _intersects(boxes[i], boxes[j]):
                    vo += 1
        lay = rep.get("layout") or {}
        out[name] = {"node_out_of_group": lay.get("node_out_of_group", 0),
                     "edge_tight": lay.get("edge_tight", 0),
                     "spacing_far": lay.get("spacing_far", 0),
                     "visual_overlaps": vo}
    return out


def selftest(cases=None) -> int:
    """Synthetic self-test. `cases` (comma-separated names, e.g. "N3,N5")
    runs only the listed cases; None runs all. One line per case,
    PASS - <name> <note> / FAIL - <name> <note>; the last line is always
    "selftest: N failure(s)". Returns 1 when any case failed."""
    failures = []
    selected = None
    if cases:
        selected = {p.strip().upper() for p in cases.split(",") if p.strip()}

    def ok(cond, note):
        if not cond:
            raise AssertionError(note)

    # --- fixtures ------------------------------------------------------------------

    def n1():
        wf1 = {"1": {"class_type": "X"}}
        r = normalize(wf1)
        ok(r[0] is wf1 and r[1] == {"scopes": {}, "applied": False},
           "non-workflow dict passes through as the same object")
        wf2 = [{"id": 1}, {"id": 2}]
        r2 = normalize(wf2)
        ok(r2[0] is wf2 and r2[1] == {"scopes": {}, "applied": False},
           "list input passes through as the same object")

    def _fix_strip():
        sub = {"id": 5, "name": "S",
               "nodes": [_mk_node(9, [300, 200], [200, 100])],
               "links": [],
               "groups": [{"title": "H", "bounding": [250, 100, 400, 300]}],
               "inputs": [{"name": "IN", "type": "*", "pos": [100, 150]}],
               "outputs": [{"name": "OUT", "type": "*", "pos": [600, 160]}]}
        return {"nodes": [_mk_node(1, [100, 100], [200, 100]),
                          _mk_node(2, [700, 300], [200, 100])],
                "links": [],
                "groups": [{"title": "G", "bounding": [50, 40, 500, 400],
                            "color": "#88A"}],
                "extra": {"ds": {"scale": 0.5, "offset": [10, 20]}, "note": "keep"},
                "definitions": {"subgraphs": [sub]}}

    def n2():
        f = _fix_strip()
        base = strip_layout(f)
        f2 = copy.deepcopy(f)
        f2["nodes"][0]["pos"] = [999, 888]
        f2["nodes"][1]["pos"] = [1, 2]
        f2["groups"][0]["bounding"] = [7, 8, 9, 10]
        f2["extra"]["ds"] = {"scale": 1, "offset": [0, 0]}
        sub = f2["definitions"]["subgraphs"][0]
        sub["nodes"][0]["pos"] = [5, 5]
        sub["groups"][0]["bounding"] = [1, 1, 1, 1]
        sub["inputs"][0]["pos"] = [42, 43]
        sub["outputs"][0]["pos"] = [44, 45]
        ok(strip_layout(f2) == base, "layout-only edits are invisible to strip_layout")
        f3 = copy.deepcopy(f)
        f3["nodes"][1]["size"] = [210, 100]
        ok(strip_layout(f3) != base, "a size edit stays visible")
        f4 = copy.deepcopy(f)
        f4["nodes"][0]["widgets_values"] = ["changed"]
        ok(strip_layout(f4) != base, "a widgets_values edit stays visible")
        ok(strip_layout(f) == base, "strip_layout does not mutate its input")

    def _scope_rep(doc, scope="main", layout=None):
        return next(r for r in check_workflow(doc, layout=layout) if r["name"] == scope)

    def _fix_g1():
        return {"nodes": [_mk_node(1, [100, 100], [200, 100], 0, 1),
                          _mk_node(2, [1300, 100], [200, 100], 1, 1),
                          _mk_node(3, [2500, 100], [200, 100], 1, 0)],
                "links": [[1, 1, 0, 2, 0, "*"], [2, 2, 0, 3, 0, "*"]]}

    def n3():
        g1 = _fix_g1()
        doc, rep = normalize(g1, ladder=(float("inf"),))
        ok(doc is not None, "identity rung returns a document")
        if doc is None:
            return
        orig = [list(nd["pos"]) for nd in g1["nodes"]]
        got = [list(nd["pos"]) for nd in doc["nodes"]]
        ok(got == orig, "identity rung keeps every pos (%s vs %s)" % (got, orig))

    def n16():
        f1 = {"nodes": [_mk_node(1, [1000, 2000], [200, 100])], "links": []}
        d1, _ = normalize(f1, ladder=(float("inf"),))
        ok(d1 is not None, "single-node fixture returns a document")
        if d1 is None:
            return
        ok(d1.get("extra", {}).get("ds") == {"scale": 1.0, "offset": [-300, -1600]},
           "single node opens at scale 1 (got %s)" % (d1.get("extra"),))
        sub = {"id": 3, "name": "T",
               "nodes": [_mk_node(9, [300, 300], [200, 100])],
               "links": [], "inputs": [], "outputs": []}
        f2 = {"nodes": [_mk_node(1, [100, 100], [200, 100]),
                        _mk_node(2, [4100, 1100], [200, 100])],
              "links": [], "definitions": {"subgraphs": [sub]}}
        d2, _ = normalize(f2, ladder=(float("inf"),))
        ok(d2 is not None, "wide fixture returns a document")
        if d2 is None:
            return
        ok(d2.get("extra", {}).get("ds") == {"scale": 0.362, "offset": [4, 215]},
           "wide pair opens at scale 0.362 (got %s)" % (d2.get("extra"),))
        ok("extra" not in d2["definitions"]["subgraphs"][0],
           "no extra.ds appears inside subgraph definitions")

    def _fix_g2():
        return {"nodes": [_mk_node(1, [200, 150], [200, 100]),
                          _mk_node(2, [520, 150], [200, 100]),
                          _mk_node(3, [600, 300], [200, 100])],
                "links": [],
                "groups": [{"title": "G1", "bounding": [100, 100, 500, 400]},
                           {"title": "G2", "bounding": [450, 250, 400, 300]}]}

    def n4():
        g2 = _fix_g2()
        doc, _ = normalize(g2, ladder=(float("inf"),))
        ok(doc is not None, "group fixture returns a document")
        if doc is None:
            return
        r = _scope_rep(doc, layout={"ht": 400, "vt": 240})
        ok(r["counts"]["group_overlap"] == 0,
           "group_overlap == 0 (got %d)" % r["counts"]["group_overlap"])
        ok(r["layout"]["node_out_of_group"] == 0,
           "node_out_of_group == 0 (got %d)" % r["layout"]["node_out_of_group"])
        ok(r["layout"]["edge_tight"] == 0,
           "edge_tight == 0 (got %d)" % r["layout"]["edge_tight"])

    def _fix_g3():
        return {"nodes": [_mk_node(1, [200, 150], [200, 100])],
                "links": [],
                "groups": [{"title": "G1", "bounding": [100, 100, 500, 400]},
                           {"title": "E", "bounding": [400, 100, 300, 200]}]}

    def n5():
        g3 = _fix_g3()
        doc, _ = normalize(g3)
        ok(doc is not None, "empty-group fixture returns a document")
        if doc is None:
            return
        e = next(g for g in doc["groups"] if g["title"] == "E")
        ok(e["bounding"][2] == 300 and e["bounding"][3] == 200,
           "empty group keeps its 300x200 box (got %s)" % (e["bounding"],))
        r = _scope_rep(doc)
        ok(r["counts"]["group_overlap"] == 0,
           "group_overlap == 0 (got %d)" % r["counts"]["group_overlap"])

    def _fix_g4():
        return {"nodes": [_mk_node("A1", [100, 130], [200, 100]),
                          _mk_node("A2", [650, 130], [200, 100]),
                          _mk_node("B1", [400, 270], [200, 100]),
                          _mk_node("B2", [900, 270], [200, 100])],
                "links": [],
                "groups": [{"title": "G1", "bounding": [70, 100, 1160, 300]},
                           {"title": "G2", "bounding": [360, 250, 780, 150]}]}

    def n6():
        g4 = _fix_g4()
        doc, _ = normalize(g4)
        ok(doc is not None, "two-row fixture returns a document")
        if doc is None:
            return
        r = _scope_rep(doc, layout={"ht": 400, "vt": 240})
        ok(r["counts"]["group_overlap"] == 0,
           "group_overlap == 0 (got %d)" % r["counts"]["group_overlap"])
        ok(r["layout"]["node_out_of_group"] == 0,
           "node_out_of_group == 0 (got %d)" % r["layout"]["node_out_of_group"])
        pos = {nd["id"]: nd["pos"] for nd in doc["nodes"]}
        ok(pos["A1"][0] < pos["A2"][0], "A1 stays left of A2")
        ok(pos["B1"][0] < pos["B2"][0], "B1 stays left of B2")
        a_bottom = max(pos[i][1] + 100 for i in ("A1", "A2"))
        b_top = min(pos[i][1] for i in ("B1", "B2"))
        ok(a_bottom <= b_top,
           "A-row bottom %s not below B-row top %s" % (a_bottom, b_top))

    def _fix_sg(p1, p2):
        return {"nodes": [], "links": [],
                "definitions": {"subgraphs": [{
                    "id": 9, "name": "S",
                    "nodes": [_mk_node(1, p1, [200, 100], 1, 1),
                              _mk_node(2, p2, [200, 100], 1, 1)],
                    "links": [{"id": 1, "origin_id": -10, "origin_slot": 0,
                               "target_id": 1, "target_slot": 0, "type": "*"},
                              {"id": 2, "origin_id": 1, "origin_slot": 0,
                               "target_id": 2, "target_slot": 0, "type": "*"},
                              {"id": 3, "origin_id": 2, "origin_slot": 0,
                               "target_id": -20, "target_slot": 0, "type": "*"}],
                    "inputs": [{"name": "IN", "type": "*", "pos": [1000, 900]}],
                    "outputs": [{"name": "OUT", "type": "*", "pos": [1300, 950]}],
                    "groups": []}]}}

    def n11():
        sgf = _fix_sg([500, 100], [900, 100])
        doc, _ = normalize(sgf, ladder=(float("inf"),))
        ok(doc is not None, "subgraph fixture returns a document")
        if doc is None:
            return
        sub = doc["definitions"]["subgraphs"][0]
        ok(sub["inputs"][0]["pos"] == [320, 125],
           "input slot re-pinned to [320, 125] (got %s)" % (sub["inputs"][0]["pos"],))
        ok(sub["outputs"][0]["pos"] == [1180, 125],
           "output slot re-pinned to [1180, 125] (got %s)" % (sub["outputs"][0]["pos"],))
        r = _scope_rep(doc, "sub:S")
        ok(r["counts"]["leftward"] == 0,
           "leftward == 0 (got %d)" % r["counts"]["leftward"])
        ok(r["counts"]["output_rightmost"] == 0,
           "output_rightmost == 0 (got %d)" % r["counts"]["output_rightmost"])

    def n12():
        sgf = _fix_sg([20, 100], [520, 100])
        ok(_scope_rep(sgf, "sub:S")["counts"]["negative_region"] == 1,
           "precondition: negative region before")
        doc, _ = normalize(sgf, ladder=(float("inf"),))
        ok(doc is not None, "negative-region fixture returns a document")
        if doc is None:
            return
        sub = doc["definitions"]["subgraphs"][0]
        ok(sub["nodes"][0]["pos"] == [80, 100],
           "node 1 lifted to [80, 100] (got %s)" % (sub["nodes"][0]["pos"],))
        ok(sub["nodes"][1]["pos"] == [580, 100],
           "node 2 lifted to [580, 100] (got %s)" % (sub["nodes"][1]["pos"],))
        ok(sub["inputs"][0]["pos"] == [-100, 125],
           "input slot re-pinned to [-100, 125] (got %s)" % (sub["inputs"][0]["pos"],))
        ok(sub["outputs"][0]["pos"] == [860, 125],
           "output slot re-pinned to [860, 125] (got %s)" % (sub["outputs"][0]["pos"],))
        r = _scope_rep(doc, "sub:S")
        ok(r["counts"]["negative_region"] == 0,
           "negative_region == 0 after (got %d)" % r["counts"]["negative_region"])

    def _fix_pair(pb):
        return {"nodes": [_mk_node(1, [100, 100], [200, 100], 0, 1),
                          _mk_node(2, pb, [200, 100], 1, 0)],
                "links": [[1, 1, 0, 2, 0, "*"]]}

    def n7():
        doc, _ = normalize(_fix_pair([1300, 100]), ladder=(1.0,))
        ok(doc is not None, "far pair returns a document")
        if doc is None:
            return
        ok(doc["nodes"][1]["pos"] == [620, 100],
           "B pulled to [620, 100] (got %s)" % (doc["nodes"][1]["pos"],))
        c = _scope_rep(doc)["counts"]
        ok(c["est_spacing"] == 0 and c["est_overlap"] == 0,
           "est calibers clean after (got %s)" % c)

    def n8():
        doc, _ = normalize(_fix_pair([500, 100]), ladder=(1.0,))
        ok(doc is not None, "near pair returns a document")
        if doc is None:
            return
        ok(doc["nodes"][1]["pos"] == [500, 100],
           "B stays at [500, 100] — only shrink, never push (got %s)"
           % (doc["nodes"][1]["pos"],))

    def n9():
        fix = {"nodes": [_mk_node(1, [100, 100], [200, 100]),
                         _mk_node(2, [100, 1300], [200, 100])],
               "links": []}
        doc, _ = normalize(fix, ladder=(1.0,))
        ok(doc is not None, "column pair returns a document")
        if doc is None:
            return
        ok(doc["nodes"][1]["pos"] == [100, 380],
           "B lands at [100, 380] with the column alignment kept (got %s)"
           % (doc["nodes"][1]["pos"],))

    def n10():
        fix = {"nodes": [_mk_node(1, [100, 100], [200, 100], 0, 1),
                         _mk_node(2, [1100, 1400], [200, 100]),
                         _mk_node(3, [6100, 4100], [200, 100], 1, 0)],
               "links": [[1, 1, 0, 3, 0, "*"]]}
        b = _scope_rep(fix)["counts"]
        ok(b["crossings"] == 0 and b["occlusion"] == 0,
           "precondition: clean before (got %s)" % b)
        doc, _ = normalize(fix)
        ok(doc is not None, "diagonal fixture returns a document")
        if doc is None:
            return
        a = _scope_rep(doc)["counts"]
        ok(a["occlusion"] <= b["occlusion"],
           "occlusion not increased (%d -> %d)" % (b["occlusion"], a["occlusion"]))
        ok(a["crossings"] <= b["crossings"],
           "crossings not increased (%d -> %d)" % (b["crossings"], a["crossings"]))

    def _fix_merge():
        nodes = [_mk_node(1, [500, 400], [200, 100], 0, 1),
                 _mk_node(2, [1000, 400], [200, 100], 1, 1),
                 _mk_node(3, [1500, 400], [200, 100], 1, 0),
                 _mk_node(4, [900, 250], [200, 60], 1, 1),
                 _mk_node(5, [1350, 250], [200, 60], 1, 0),
                 _mk_node(6, [900, 590], [200, 60], 1, 1),
                 _mk_node(7, [1350, 590], [200, 60], 1, 0)]
        return {"nodes": nodes,
                "links": [[1, 1, 0, 2, 0, "*"], [2, 2, 0, 3, 0, "*"],
                          [3, 4, 0, 5, 0, "*"], [4, 6, 0, 7, 0, "*"]],
                "groups": [{"title": "G1", "bounding": [970, 350, 260, 180]},
                           {"title": "G2", "bounding": [470, 350, 1260, 180]}]}

    def n13():
        fix = _fix_merge()
        b = _scope_rep(fix)["counts"]
        ok(b["crossings"] == 0 and b["occlusion"] == 0 and b["est_overlap"] == 0,
           "precondition: clean before (got %s)" % b)
        doc, rep = normalize(fix, ladder=(float("inf"),))
        ok(doc is not None, "merge fixture returns a document")
        if doc is None:
            return
        ok(rep["scopes"]["main"]["merges"] >= 1,
           "at least one merge (got %s)" % rep["scopes"]["main"]["merges"])
        ok(len(doc["groups"]) == 1 and "+" in doc["groups"][0]["title"],
           "one merged group with a '+' title (got %s)"
           % [g["title"] for g in doc["groups"]])
        a = _scope_rep(doc)
        ok(a["counts"]["group_overlap"] == 0,
           "group_overlap == 0 after (got %d)" % a["counts"]["group_overlap"])
        for k in ("crossings", "occlusion", "est_overlap", "est_spacing",
                  "leftward", "negative_region"):
            ok(a["counts"][k] <= b[k],
               "%s not increased (%d -> %d)" % (k, b[k], a["counts"][k]))

    def n14():
        doc, rep = normalize(_fix_g2(), ladder=())
        ok(doc is None, "empty ladder yields no document")
        ok(rep["applied"] is False, "applied is False")
        sc = rep["scopes"]["main"]
        ok(sc["unresolvable"] is True and sc["merges"] == 0,
           "main scope unresolvable without merging (got %s)" % sc)

    def _all_fixtures():
        return [("G1", _fix_g1()), ("G2", _fix_g2()), ("G3", _fix_g3()),
                ("G4", _fix_g4()), ("far-pair", _fix_pair([1300, 100])),
                ("near-pair", _fix_pair([500, 100])),
                ("column", {"nodes": [_mk_node(1, [100, 100], [200, 100]),
                                      _mk_node(2, [100, 1300], [200, 100])],
                            "links": []}),
                ("diagonal", {"nodes": [_mk_node(1, [100, 100], [200, 100], 0, 1),
                                        _mk_node(2, [1100, 1400], [200, 100]),
                                        _mk_node(3, [6100, 4100], [200, 100], 1, 0)],
                              "links": [[1, 1, 0, 3, 0, "*"]]}),
                ("sg-slots", _fix_sg([500, 100], [900, 100])),
                ("sg-origin", _fix_sg([20, 100], [520, 100])),
                ("merge", _fix_merge())]

    def n15():
        for label, fix in _all_fixtures():
            r1 = normalize(fix)
            if r1[0] is None:
                ok(False, "%s: first pass must resolve" % label)
                continue
            r2 = normalize(r1[0])
            ok(r2[0] == r1[0], "%s: second pass deep-equals the first" % label)
            ok(r2[1]["applied"] is False, "%s: second pass reports applied=False" % label)

    def n17():
        fix = {"nodes": [_mk_node("a", [120, 150], [200, 100]),
                         _mk_node("b", [650, 150], [200, 100]),
                         _mk_node("c", [1100, 150], [200, 100])],
               "links": [],
               "groups": [{"title": "G", "bounding": [100, 100, 600, 400]}]}
        ok(survey(fix) == {"main": {"node_out_of_group": 1, "edge_tight": 1,
                                    "spacing_far": 1, "visual_overlaps": 0}},
           "survey reports the three calibers plus visual overlaps (got %s)"
           % survey(fix))

    def n18():
        fix = {"nodes": [_mk_node("p", [200, 200], [200, 100]),
                         _mk_node("q", [300, 250], [200, 100])],
               "links": []}
        ok(survey(fix)["main"]["visual_overlaps"] == 1,
           "survey counts the true visual overlap (got %s)" % survey(fix))
        doc, _ = normalize(fix)
        ok(doc is not None, "default normalize still resolves (unstack off)")
        if doc is None:
            return
        bs = [_occl_box(nd) for nd in doc["nodes"]]
        ok(_intersects(bs[0], bs[1]),
           "p and q still visually overlap — reported, never split")

    for fn in (n1, n2, n3, n16, n4, n5, n6, n11, n12, n7, n8, n9, n10, n13,
               n14, n15, n17, n18):
        name = fn.__name__.upper()
        if selected is not None and name not in selected:
            continue
        try:
            fn()
            print("PASS - %s" % name)
        except AssertionError as e:
            print("FAIL - %s (%s)" % (name, e))
            failures.append(name)
        except Exception as e:  # a crashing case is a failing case
            print("FAIL - %s (%s: %s)" % (name, type(e).__name__, e))
            failures.append(name)

    print("selftest: %d failure(s)" % len(failures))
    return 1 if failures else 0


# --- CLI ---------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="layout_normalize.py",
        description="Order-preserving layout compaction for GUI workflow JSON "
                    "(read-only report by default).")
    ap.add_argument("workflow", nargs="?", help="path to a GUI-format workflow JSON")
    ap.add_argument("--check", action="store_true",
                    help="read-only per-scope report (the default behavior)")
    ap.add_argument("--apply", action="store_true",
                    help="write the normalized document back to the file")
    ap.add_argument("--allow-prod", action="store_true",
                    help="permit --apply under production roots (batch jobs own those)")
    ap.add_argument("--ht", type=float, default=None, metavar="N",
                    help="same-row spacing target (default %g)" % PARAMS["H_T"])
    ap.add_argument("--vt", type=float, default=None, metavar="N",
                    help="same-column spacing target (default %g)" % PARAMS["V_T"])
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--selftest", nargs="?", const=True, default=None, metavar="CASES",
                    help="run the embedded synthetic self-test; optional comma-separated "
                         "case names (e.g. --selftest N3,N5) run only those cases")
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest(None if args.selftest is True else args.selftest)
    if not args.workflow:
        print("error: a workflow JSON path is required (or use --selftest)", file=sys.stderr)
        return 2
    if args.apply and not args.allow_prod and (
            "comfyui/workflows" in args.workflow
            or "comfyui/my_nodes/subgraphs" in args.workflow):
        print("error: %s lives under a production root; batch jobs own those "
              "files (--allow-prod to override)" % args.workflow, file=sys.stderr)
        return 3
    try:
        with open(args.workflow, encoding="utf-8") as f:
            wf = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print("error: cannot read workflow: %s" % e, file=sys.stderr)
        return 2

    params = dict(PARAMS)
    if args.ht is not None:
        params["H_T"] = float(args.ht)
    if args.vt is not None:
        params["V_T"] = float(args.vt)

    surv = survey(wf, params)
    doc, rep = normalize(wf, params)
    if doc is None:
        unres = sorted(k for k, v in rep.get("scopes", {}).items()
                       if v.get("unresolvable"))
        if args.json:
            print(json.dumps({"survey": surv, "report": rep,
                              "unresolvable": unres}, ensure_ascii=False, indent=2))
        else:
            print("unresolvable scope(s): %s" % ", ".join(unres), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({"survey": surv, "report": rep,
                          "changed": rep["applied"]}, ensure_ascii=False, indent=2))
    else:
        print("survey:")
        for s in surv:
            v = surv[s]
            print("  [%s] out_of_group=%d edge_tight=%d spacing_far=%d "
                  "visual_overlaps=%d" % (s, v["node_out_of_group"],
                                          v["edge_tight"], v["spacing_far"],
                                          v["visual_overlaps"]))
        print("normalize: applied=%s" % rep["applied"])
        for s, v in rep["scopes"].items():
            print("  [%s] rung=%s merges=%d unresolvable=%s"
                  % (s, v["rung"], v["merges"], v["unresolvable"]))
    if args.apply:
        if not rep["applied"]:
            print("no change; file not touched")
            return 0
        with open(args.workflow, encoding="utf-8", newline="") as f:
            raw = f.read()
        text = json.dumps(doc, ensure_ascii=False, indent=2)
        if "\r\n" in raw:
            text = text.replace("\n", "\r\n")
        if raw.endswith("\n"):
            text += "\r\n" if "\r\n" in raw else "\n"
        with open(args.workflow, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        print("wrote: %s" % args.workflow)
    return 0


if __name__ == "__main__":
    sys.exit(main())
