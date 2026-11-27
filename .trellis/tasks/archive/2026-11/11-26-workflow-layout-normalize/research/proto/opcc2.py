#!/usr/bin/env python3
"""可行性原型(丢弃件,不入仓):保序约束压缩 OPCC = Order-Preserving Constraint Compaction。

把原布局里「谁在谁左/右/上/下」的关系做成差分约束(u >= v + d),d=原净隙夹到[下限, 目标];
组框=成员包围盒+留白,组间按原方位(重叠组取多数方位)加约束;Kahn 拓扑+最长路径(最小不动点)
分别解 x、y。结果=「原布局的橡皮膜收缩」:相对次序全保,过大空隙吸到目标值,过近抬到下限,
节点全包进所属组框,组框两两不重叠。线带约束保证原来在线带上/下侧之外的节点压缩后仍在外侧。
"""
import copy
import json
import math
import os
import sys

REPO = "/Users/zhengbingjin/Project/Github/MYStudio"
sys.path.insert(0, os.path.join(REPO, ".agents/skills/node-graph/tools"))
from layout_check import CHECK_KEYS, _est_box, _iter_links, _pos, check_workflow, est_size  # noqa: E402
from layout_check import SPACING_EXEMPT_TYPES  # noqa: E402

DEF = dict(H_MIN=200, V_MIN=80, H_T=240, V_T=120, DIAG_MIN=20, EXEMPT_MIN=20,
           PAD=(30, 50, 30, 30), G_GAP=60, G_MIN=50, ORIGIN=80, BAND_EPS=6,
           RR_W=60, RR_H=30, IO_IN=180, IO_OUT=80)
LADDER = (1.0, 1.5, 2.0, 3.0, 5.0, float("inf"))
LOG = None
TOL = {}
if "--tol" in sys.argv:
    _a, _r = [x for x in sys.argv if x.startswith("--tol")][0].split("=")[1].split(":")
    TOL = {"crossings": int(_a), "occlusion": int(_a)}
    REL_TOL = float(_r)
    pats = []


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def cbox(n, pos=None):
    """est 盒(立宪口径);Reroute 用 60x30 点盒。pos 缺省取节点自身坐标。"""
    if pos is None:
        return cbox_at(n, *_pos(n))
    return cbox_at(n, pos[0], pos[1])


def cbox_at(n, x, y):
    if n.get("type") == "Reroute":
        return (x, y, x + DEF["RR_W"], y + DEF["RR_H"])
    w, h = est_size(n)
    return (x, y, x + float(w), y + float(h))


def vbox(n, pos=None):
    """可视盒:声明 size(Reroute 固定 60x30);缺 size 回落 est。"""
    x, y = _pos(n) if pos is None else pos
    if n.get("type") == "Reroute":
        return (x, y, x + DEF["RR_W"], y + DEF["RR_H"])
    sz = n.get("size")
    if isinstance(sz, dict):
        sz = [sz.get("0"), sz.get("1")]
    try:
        return (x, y, x + float(sz[0]), y + float(sz[1]))
    except (TypeError, ValueError, IndexError):
        return _est_box(n)


def deoverlap(nodes, deg, P=DEF):
    """解叠:可视盒(声明 size)真重叠的节点对,沿侵入最浅的轴把「连线少/后加」的那个挪到最近的合法空位。

    合法空位=与横向范围有交叠的其它节点:视觉不重叠,且(非豁免节点之间)est 净隙≥立宪下限
    (横 200/纵 80)。单向扫描只进不退,每次落位清掉当前重叠且不制造新重叠 → 必然收敛。
    只动真重叠的节点;返回 (位置表, 移动节点数)。"""
    by = {n["id"]: n for n in nodes}
    pp = {n["id"]: list(_pos(n)) for n in nodes}
    moved = set()
    ids = list(pp)

    def box(i, axis_box, pos):
        return axis_box(by[i], pos)

    for _round in range(50):
        hit = None
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                if overlaps(vbox(by[ids[i]], pp[ids[i]]), vbox(by[ids[j]], pp[ids[j]])):
                    hit = (ids[i], ids[j]); break
            if hit:
                break
        if not hit:
            break
        a, b = hit
        A, B = vbox(by[a], pp[a]), vbox(by[b], pp[b])
        px = min(A[2], B[2]) - max(A[0], B[0])
        py = min(A[3], B[3]) - max(A[1], B[1])
        mv = a if (deg.get(a, 0), -a) < (deg.get(b, 0), -b) else b   # 挪连线少的;同则挪后加的(id 大)
        o = b if mv == a else a
        ax = 0 if px <= py else 1                     # 0=横轴 1=纵轴
        M, O = vbox(by[mv], pp[mv]), vbox(by[o], pp[o])
        c_m = (M[0] + M[2]) / 2 if ax == 0 else (M[1] + M[3]) / 2
        c_o = (O[0] + O[2]) / 2 if ax == 0 else (O[1] + O[3]) / 2
        step = 1 if c_m >= c_o else -1
        lo, hi = (0, 2) if ax == 0 else (1, 3)
        clo, chi = (1, 3) if ax == 0 else (0, 2)     # 沿横轴扫→交叉范围=纵范围;沿纵轴扫→横范围
        exempt_mv = exempt(by[mv])
        while True:
            cur = pp[mv][ax]
            w = M[hi] - M[lo]
            c_lo, c_hi = M[clo], M[chi]
            nxt = None
            for k in ids:
                if k == mv:
                    continue
                KB = cbox(by[k], pp[k]) if not (exempt_mv or exempt(by[k])) else vbox(by[k], pp[k])
                if min(c_hi, KB[chi]) - max(c_lo, KB[clo]) <= 0:
                    continue                             # 交叉范围不交叠=不构成同行/同列
                gap = 1 if (exempt_mv or exempt(by[k])) else (P["H_MIN"] if ax == 0 else P["V_MIN"])
                if step > 0 and KB[hi] + gap - cur > 0 and KB[lo] < cur + w + gap:
                    nxt = KB[hi] + gap if nxt is None else max(nxt, KB[hi] + gap)
                elif step < 0 and cur - (KB[lo] - gap - w) > 0 and KB[hi] + gap > cur:
                    nxt = KB[lo] - gap - w if nxt is None else min(nxt, KB[lo] - gap - w)
            if nxt is None:
                break
            pp[mv][ax] = nxt
        moved.add(mv)
    return pp, len(moved)


def exempt(n):
    return n.get("type") in SPACING_EXEMPT_TYPES


def sep(a, b):
    """(横向, 纵向) 关系:'L'=a 左于 b/'R'=a 右于 b/'A'=a 上于 b/'B'=a 下于 b/None=该轴重叠。"""
    dx = ("L", b[0] - a[2]) if b[0] >= a[2] else ("R", a[0] - b[2]) if a[0] >= b[2] else None
    dy = ("A", b[1] - a[3]) if b[1] >= a[3] else ("B", a[1] - b[3]) if a[1] >= b[3] else None
    return dx, dy


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


class Sys:
    """单轴差分约束:val[u] >= val[v] + d。Kahn 拓扑 + 最长路径 = 最小不动点。"""

    def __init__(self):
        self.lb, self.out, self.inn = {}, {}, []

    def var(self, v, lo):
        self.lb[v] = max(lo, self.lb.get(v, lo))

    def edge(self, v, u, d):
        if v not in self.lb or u not in self.lb:
            raise KeyError("unknown var %s %s" % (v, u))
        self.out.setdefault(v, []).append((u, d))

    def solve(self):
        """强连通缩点 + 最长路径(最小不动点)。零权和环(等式)合法;正环=不可解,返回残留变量。"""
        nodes = list(self.lb)
        out = self.out
        inn = {v: [] for v in nodes}
        for v, os_ in out.items():
            for u, d in os_:
                inn[u].append((v, d))
        # Kosaraju:第一遍 DFS 求.finish 序
        seen, order = set(), []
        for st in nodes:
            if st in seen:
                continue
            seen.add(st)
            stack = [(st, iter(out.get(st, [])))]
            while stack:
                v, it = stack[-1]
                adv = False
                for u, _d in it:
                    if u not in seen:
                        seen.add(u)
                        stack.append((u, iter(out.get(u, []))))
                        adv = True
                        break
                if not adv:
                    order.append(v); stack.pop()
        # 第二遍:反图按 finish 逆序取 SCC
        radj = {v: [x for x, _d in inn[v]] for v in nodes}
        comp = {}
        cid = 0
        for st in reversed(order):
            if st in comp:
                continue
            stack = [st]; comp[st] = cid
            while stack:
                v = stack.pop()
                for u in radj[v]:
                    if u not in comp:
                        comp[u] = cid; stack.append(u)
            cid += 1
        sccs = [[] for _ in range(cid)]
        for v in nodes:
            sccs[comp[v]].append(v)
        val, bad = {}, []
        for S in sccs:                       # 逆 finish 序=缩点图的拓扑序
            if len(S) == 1:
                v = S[0]
                val[v] = self.lb[v]
                for u, d in inn[v]:
                    if u in val and val[u] + d > val[v]:
                        val[v] = val[u] + d
                continue
            inside = {v: [(u, d) for u, d in out.get(v, []) if u in set(S)] for v in S}
            dist = {v: 0.0 for v in S}
            for _ in range(len(S)):
                changed = False
                for v in S:
                    for u, d in inside[v]:
                        if dist[v] + d > dist[u]:
                            dist[u] = dist[v] + d; changed = True
                if not changed:
                    break
            else:
                bad.extend(S)               # 正环:不可解
                for v in S:
                    val[v] = self.lb[v]
                continue
            root = S[0]
            base = self.lb[root] - dist[root]
            for v in S:
                base = max(base, self.lb[v] - dist[v])
                for u, d in inn[v]:
                    if u in val:
                        base = max(base, val[u] + d - dist[v])
            for v in S:
                val[v] = base + dist[v]
        return val, bad


class Scope:
    """一个作用域(主图或一个子图定义)的布局模型。双盒:
    可视盒 vb=声明 size(Reroute 60x30),决定组框归属/包住/组间关系与压缩目标;
    est 盒 bx=立宪 est_size 足迹,只用于「不新增 est 违规」。"""

    def __init__(self, nodes, links, groups, P):
        self.nodes, self.links, self.P = nodes, list(_iter_links(links)), P
        self.links_raw = links
        self.by = {n["id"]: n for n in nodes}
        deg = {}
        for _lid, oid, _os, tid, _ts in self.links:
            deg[oid] = deg.get(oid, 0) + 1
            deg[tid] = deg.get(tid, 0) + 1
        self.pp, self.deoverlap_moves = deoverlap(nodes, deg, P)      # 解叠后的位置(真重叠才动)
        self.vb = {n["id"]: vbox(n, self.pp[n["id"]]) for n in nodes}
        self.bx = {n["id"]: cbox(n, self.pp[n["id"]]) for n in nodes}
        self.ids = list(self.vb)
        self.groups = [dict(g) for g in groups if g.get("bounding") and len(g["bounding"]) == 4]
        self.voted = set()          # 两轴交叠、靠多数方位定关系的组对
        self.extra_y = []           # 修补阶段追加的纵向约束 [(v, u, d)]
        self.merge_overlap = False  # True=两轴交叠的组直接并组(不挪节点)

    def over(self, i, axis):        # est 相对可视的外溢(右侧/下侧),恒 ≥0
        b, v = self.bx[i], self.vb[i]
        return max(0.0, (b[2] - b[0]) - (v[2] - v[0])) if axis == "x" else max(0.0, (b[3] - b[1]) - (v[3] - v[1]))

    # ── 组成员判定(可视盒中心在组框内;或与组框交叠面积占比≥0.25)──────────
    def membership(self):
        decl = [(g["bounding"][0], g["bounding"][1], g["bounding"][0] + g["bounding"][2],
                 g["bounding"][1] + g["bounding"][3]) for g in self.groups]
        area = lambda b: max((b[2] - b[0]) * (b[3] - b[1]), 1.0)
        mem = [set() for _ in self.groups]
        drop = []
        for i, b in self.vb.items():
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            inside = [k for k, d in enumerate(decl) if d[0] <= cx <= d[2] and d[1] <= cy <= d[3]]
            if inside:
                mem[min(inside, key=lambda k: area(decl[k]))].add(i)
                continue
            best, br = None, 0.0
            for k, d in enumerate(decl):
                w = min(b[2], d[2]) - max(b[0], d[0]); h = min(b[3], d[3]) - max(b[1], d[1])
                r = (w * h) / area(b) if w > 0 and h > 0 else 0.0
                if r > br:
                    best, br = k, r
            if best is not None and br >= 0.25:
                mem[best].add(i)
            else:
                drop.append(i)
        self.mem = mem
        for _ in range(8):   # 落入收紧盒的非成员=视觉在组内 → 收编
            changed = False
            for k in range(len(self.groups)):
                if not mem[k]:
                    continue
                t = self.tight(k)
                for i in drop:
                    if any(i in m for m in mem):
                        continue
                    b = self.vb[i]; cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
                    if t[0] < cx < t[2] and t[1] < cy < t[3]:
                        mem[k].add(i); changed = True
            if not changed:
                break

    def tight(self, k):
        """组框=成员可视盒包围盒+立宪留白 [minX−30, minY−50, 右+30, 下+30]。"""
        PL, PT, PR, PB = self.P["PAD"]
        m = [self.vb[i] for i in self.mem[k]]
        if not m:
            b = self.groups[k]["bounding"]
            return (b[0], b[1], b[0] + b[2], b[1] + b[3])
        return (min(b[0] for b in m) - PL, min(b[1] for b in m) - PT,
                max(b[2] for b in m) + PR, max(b[3] for b in m) + PB)

    def group_rel(self, a, b):
        """组 a 相对组 b 的方位约束集:按收紧盒;两轴都交叠取多数成员对的方位。"""
        dx, dy = sep(self.tight(a), self.tight(b))
        if dx and dy:
            return (dx[0], dy[0])
        if dx or dy:
            return ((dx or dy)[0],)
        votes = {"L": 0, "R": 0, "A": 0, "B": 0}
        for i in self.mem[a]:
            for j in self.mem[b]:
                ex, ey = sep(self.vb[i], self.vb[j])
                if ex:
                    votes[ex[0]] += 1
                if ey:
                    votes[ey[0]] += 1
        best = max(("L", "R", "A", "B"), key=lambda d: (votes[d], d in ("L", "R")))
        self.voted.add((min(a, b), max(a, b)))
        return (best,)

    # ── 约束构建 ─────────────────────────────────────────────────────
    def build(self, scale, grel):
        P = self.P
        T_H = P["H_T"] * scale if math.isfinite(scale) else float("inf")
        T_V = P["V_T"] * scale if math.isfinite(scale) else float("inf")
        PL, PT, PR, PB = P["PAD"]
        SX, SY = Sys(), Sys()
        for i in self.ids:
            SX.var(("n", i), P["ORIGIN"]); SY.var(("n", i), P["ORIGIN"])
        live = [k for k in range(len(self.groups)) if self.mem[k]]
        for k in live:
            SX.var(("g", k), P["G_MIN"] - PL); SY.var(("g", k), P["G_MIN"] - PT)
            for i in self.mem[k]:
                SX.edge(("g", k), ("n", i), PL); SY.edge(("g", k), ("n", i), PT)
        grp_of = {i: k for k in live for i in self.mem[k]}
        G = lambda k: ("g", k)
        isg = lambda x: isinstance(x, tuple)

        def right(S, a, b, gap, axis=None):
            """b 在 a 右(或下),两者**可视盒间**净隙 = gap。a/b = 节点 id(int) 或组 ('g',k)。"""
            axis = axis or ("x" if S is SX else "y")
            pr, pl = (PR, PL) if axis == "x" else (PB, PT)
            ext = lambda i: self.bx[i][2 if axis == "x" else 3] - self.bx[i][0 if axis == "x" else 1]
            if not isg(a):
                d = gap - self.over(a, axis)
                if not isg(b):
                    S.edge(("n", a), ("n", b), ext(a) + d)
                else:
                    S.edge(("n", a), b, ext(a) + d)
            else:
                for m in self.mem[a[1]]:
                    d = gap - self.over(m, axis)
                    if not isg(b):
                        S.edge(("n", m), ("n", b), ext(m) + pr + d)
                    else:
                        S.edge(("n", m), b, ext(m) + pr + d)      # gap 已是两收紧盒间净隙(含对方留白),不再加 pl

        def rigid(S, a, b, delta):
            """刚性:b 恒在 a 的坐标 + delta 处(双向不等式=等式)。"""
            S.edge(("n", a), ("n", b), delta)
            S.edge(("n", b), ("n", a), -delta)

        def pair_gap(a, b, axis, T):
            """两节点在某轴上「原可视净隙 g」该收成多少。只收不推;且不新增 est 违规:
            原 est 净隙合规(≥立宪下限)→ 新 est 净隙仍须≥下限(即新可视净隙≥下限+外溢);
            原 est 净隙∈[0,下限)=已过近 → 不得再变成 est 重叠;原已 est 重叠 → 保持原样不恶化。"""
            i, j = (0, 2) if axis == "x" else (1, 3)
            va, vb_ = self.vb[a], self.vb[b]
            ex, ey = sep(self.bx[a], self.bx[b])
            e = (ex[1] if axis == "x" else ey[1]) if (ex if axis == "x" else ey) else \
                ((vb_[i] - va[j]) - self.over(a, axis))
            g = vb_[i] - va[j]
            o = self.over(a, axis)
            mn = P["H_MIN"] if axis == "x" else P["V_MIN"]
            floor = (mn + o) if e >= mn else (o if e >= 0 else 0.0)
            return min(g, max(T, floor))

        def relate(a, b):
            va, vb_ = self.vb[a], self.vb[b]
            dx, dy = sep(va, vb_)
            if dx:
                gap = pair_gap(a, b, "x", T_H) if dx[0] == "L" else pair_gap(b, a, "x", T_H)
                right(SX, a, b, gap) if dx[0] == "L" else right(SX, b, a, gap)
            else:
                rigid(SX, a, b, vb_[0] - va[0])
            if dy:
                gap = pair_gap(a, b, "y", T_V) if dy[0] == "A" else pair_gap(b, a, "y", T_V)
                right(SY, a, b, gap) if dy[0] == "A" else right(SY, b, a, gap)
            else:
                rigid(SY, a, b, vb_[1] - va[1])

        def relate_ng(i, k):
            """非成员节点 i 与组 k:按可视盒关系;i 落在组收紧盒内的情形由成员收编处理。"""
            va, ta = self.vb[i], self.tight(k)
            dx, dy = sep(va, ta)
            if dx == "L":
                right(SX, i, G(k), min(dx[1], max(T_H, 0.0)))
            elif dx == "R":
                right(SX, G(k), i, min(dx[1], max(T_H, 0.0)))
            if dy == "A":
                right(SY, i, G(k), min(dy[1], max(T_V, 0.0)))
            elif dy == "B":
                right(SY, G(k), i, min(dy[1], max(T_V, 0.0)))

        ids = self.ids
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = ids[i], ids[j]
                ga, gb = grp_of.get(a), grp_of.get(b)
                if ga is not None and gb is not None and ga != gb:
                    rel = grel.get((min(ga, gb), max(ga, gb)), ())
                    if ga > gb:
                        rel = tuple({"L": "R", "R": "L", "A": "B", "B": "A"}[d] for d in rel)
                    ex, ey = sep(self.vb[a], self.vb[b])
                    if "L" not in rel and "R" not in rel:          # 横向次序仍保
                        if ex:
                            gap = pair_gap(a, b, "x", T_H) if ex[0] == "L" else pair_gap(b, a, "x", T_H)
                            right(SX, a, b, gap) if ex[0] == "L" else right(SX, b, a, gap)
                        else:
                            rigid(SX, a, b, self.vb[b][0] - self.vb[a][0])
                    if "A" not in rel and "B" not in rel:          # 纵向次序仍保
                        if ey:
                            gap = pair_gap(a, b, "y", T_V) if ey[0] == "A" else pair_gap(b, a, "y", T_V)
                            right(SY, a, b, gap) if ey[0] == "A" else right(SY, b, a, gap)
                        else:
                            rigid(SY, a, b, self.vb[b][1] - self.vb[a][1])
                    continue
                relate(a, b)
        for i in ids:
            for k in live:
                if k != grp_of.get(i):
                    relate_ng(i, k)
        for (a, b), rel in grel.items():            # 组 × 组(可视收紧盒)
            ta, tb = self.tight(a), self.tight(b)
            dx, dy = sep(ta, tb)
            gg = max(T_H, P["G_GAP"]), max(T_V, P["G_GAP"])
            for d in rel:
                if d == "L":
                    right(SX, G(a), G(b), min(dx[1] if dx else -over_pen(ta, tb, "x"), gg[0]))
                elif d == "R":
                    right(SX, G(b), G(a), min(dx[1] if dx else -over_pen(tb, ta, "x"), gg[0]))
                elif d == "A":
                    right(SY, G(a), G(b), min(dy[1] if dy else -over_pen(ta, tb, "y"), gg[1]))
                elif d == "B":
                    right(SY, G(b), G(a), min(dy[1] if dy else -over_pen(tb, ta, "y"), gg[1]))
        # 线带约束(检查器遮挡盒=声明 size,即可视盒):原在线带上/下侧之外的节点留在外侧。
        # 只收不推:要求值若高于原相对位置则取原值。
        slot = lambda s_: 25 + (s_ or 0) * 20
        for lid, oid, os_, tid, ts_ in self.links:
            if oid not in self.vb or tid not in self.vb:
                continue
            a, b = self.vb[oid], self.vb[tid]
            if not (b[0] >= a[2]):
                continue
            sa, sb = a[1] + slot(os_), b[1] + slot(ts_)
            blo, bhi = min(sa, sb), max(sa, sb)
            for i in self.ids:
                if i in (oid, tid):
                    continue
                c = self.vb[i]
                if not (c[2] > a[2] and c[0] < b[0]):
                    continue
                if c[3] <= blo:                       # i 整条在带上方:端点槽 y ≥ i.y1 + EPS
                    for e, sl in ((oid, slot(os_)), (tid, slot(ts_))):
                        d = (c[3] - c[1]) + P["BAND_EPS"] - sl
                        if d >= 0:
                            SY.edge(("n", i), ("n", e), min(d, self.pp[e][1] - self.pp[i][1]))
                elif c[1] >= bhi:                     # i 整条在带下方:i.y0 ≥ 端点槽 y + EPS
                    for e, sl in ((oid, slot(os_)), (tid, slot(ts_))):
                        SY.edge(("n", e), ("n", i), min(sl + P["BAND_EPS"], self.pp[i][1] - self.pp[e][1]))
        for (v, u, d) in self.extra_y:       # 修补阶段追加的约束
            SY.edge(v, u, d)
        return SX, SY

    def run(self, scale):
        """返回 (new_pos, new_groups, report)。"""
        self.membership()
        self.voted = set()
        active = [k for k in range(len(self.groups)) if self.mem[k]]
        grel = {(a, b): self.group_rel(a, b) for x, a in enumerate(active) for b in active[x + 1:]}
        report = {"merged": 0, "separated": 0, "scale": scale, "groups": len(active)}
        if self.merge_overlap and self.voted:
            drop = set()
            for (a, b) in sorted(self.voted):
                if a in drop or b in drop:
                    continue
                self.mem[a] |= self.mem[b]; self.mem[b] = set(); drop.add(b)
                report["merged"] += 1
            active = [k for k in active if self.mem[k]]
            grel = {(a, b): self.group_rel(a, b) for x, a in enumerate(active) for b in active[x + 1:]}
        else:
            report["separated"] = len(self.voted)
        VX = VY = None
        for _attempt in range(len(active) + 2):
            SX, SY = self.build(scale, grel)
            VX, cx = SX.solve(); VY, cy = SY.solve()
            cyc = cx + cy
            if not cyc:
                break
            gvars = sorted({v[1] for v in cyc if v[0] == "g"})
            pair = None
            for v in cyc:
                if v[0] != "g":
                    continue
                for (a, b) in grel:
                    if a == v[1] or b == v[1]:
                        pair = (a, b); break
                if pair:
                    break
            if pair is None:
                if len(gvars) >= 2:
                    pair = (gvars[0], gvars[1])
                else:
                    report["unresolvable"] = cyc[:6]
                    return None, None, report
            a, b = sorted(pair)
            self.mem[a] |= self.mem[b]; self.mem[b] = set()
            grel = {k: v for k, v in grel.items() if b not in k}
            for k in list(grel):
                if k[0] == a:
                    grel[k] = self.group_rel(a, k[1])
                elif k[1] == a:
                    grel[k] = self.group_rel(k[0], a)
            report["merged"] += 1
        else:
            report["unresolvable"] = True
            return None, None, report
        O = self.P["ORIGIN"]
        PL, PT, PR, PB = self.P["PAD"]
        newpos = {}
        omx = min(self.pp[i][0] for i in self.ids); omy = min(self.pp[i][1] for i in self.ids)
        nmx = min(VX[("n", i)] for i in self.ids); nmy = min(VY[("n", i)] for i in self.ids)
        tx = omx - nmx if omx >= O else O - nmx
        ty = omy - nmy if omy >= O else O - nmy
        for i in self.ids:
            x, y = VX[("n", i)], VY[("n", i)]
            if not (math.isfinite(x) and math.isfinite(y)):
                x, y = self.pp[i][0], self.pp[i][1]
            x += tx; y += ty
            fx = self.pp[i][0] + (O - omx if omx < O else 0.0)
            fy = self.pp[i][1] + (O - omy if omy < O else 0.0)
            if abs(x - fx) < 1e-6 and abs(y - fy) < 1e-6:
                newpos[i] = [fx, fy]
            else:
                newpos[i] = [int(math.ceil(x - 1e-6)), int(math.ceil(y - 1e-6))]
        newg = []
        for k in active:
            if not self.mem[k]:
                continue
            m = list(self.mem[k])
            x0 = min(newpos[i][0] + self.vb[i][0] - self.pp[i][0] for i in m) - PL
            y0 = min(newpos[i][1] + self.vb[i][1] - self.pp[i][1] for i in m) - PT
            x1 = max(newpos[i][0] + self.vb[i][2] - self.pp[i][0] for i in m) + PR
            y1 = max(newpos[i][1] + self.vb[i][3] - self.pp[i][1] for i in m) + PB
            g = dict(self.groups[k])
            g["bounding"] = [int(math.floor(x0)), int(math.floor(y0)), int(math.ceil(x1 - x0)), int(math.ceil(y1 - y0))]
            newg.append(g)
        return newpos, newg, report


def over_pen(u, v, axis):
    """组 a 沿 axis 压入组 b 的深度(多数方位下两盒该轴交叠)。"""
    i, j = (0, 2) if axis == "x" else (1, 3)
    return max(0.0, min(u[j], v[j]) - max(u[i], v[i]))


def fix_io(s, P=DEF):
    nodes = s.get("nodes") or []
    if not nodes:
        return
    byid = {n["id"]: n for n in nodes}
    xs = [_pos(n)[0] for n in nodes]
    x1 = max(_est_box(n)[2] for n in nodes)
    y0 = min(_pos(n)[1] for n in nodes)
    cons = {}
    for lid, oid, os_, tid, ts_ in _iter_links(s.get("links")):
        cons.setdefault(("in", os_), []).append(tid)
        cons.setdefault(("out", ts_), []).append(oid)
    for k, io in enumerate(s.get("inputs") or []):
        c = [byid[t] for t in cons.get(("in", k), []) if t in byid]
        io["pos"] = [int(min(xs) - P["IO_IN"]), int(min((_pos(n)[1] + 25 for n in c), default=y0 + 25))]
    for k, io in enumerate(s.get("outputs") or []):
        c = [byid[t] for t in cons.get(("out", k), []) if t in byid]
        io["pos"] = [int(x1 + P["IO_OUT"]), int(min((_pos(n)[1] + 25 for n in c), default=y0 + 25))]


def fix_ds(doc, vw=1600, vh=900):
    nodes = doc.get("nodes") or []
    if not nodes:
        return
    bs = [cbox(n) for n in nodes]
    x0, y0 = min(b[0] for b in bs), min(b[1] for b in bs)
    W = max(1, max(b[2] for b in bs) - x0); H = max(1, max(b[3] for b in bs) - y0)
    sc = round(min(1.0, (vw - 80) / W, (vh - 80) / H), 3)
    doc.setdefault("extra", {})
    doc["extra"]["ds"] = {"scale": sc, "offset": [round((vw - W * sc) / 2 - x0 * sc), round((vh - H * sc) / 2 - y0 * sc)]}


def normalize_groups_only(doc, P=DEF):
    """保底档:节点只做整体平移(pos>=80),组框=成员 est 包围盒+留白;收紧后仍相交的组并为一组。"""
    out = copy.deepcopy(doc)
    PL, PT, PR, PB = P["PAD"]

    def do(nodes, groups):
        sc = Scope(nodes, [], groups, P)
        sc.membership()
        ox = P["ORIGIN"] - min(sc.bx[i][0] for i in sc.bx)
        oy = P["ORIGIN"] - min(sc.bx[i][1] for i in sc.bx)
        if ox or oy:
            for n in nodes:
                n["pos"] = [n["pos"][0] + ox, n["pos"][1] + oy]
        live = [k for k in range(len(sc.groups)) if sc.mem[k]]
        boxes = {k: sc.tight(k) for k in live}
        changed = True
        while changed:
            changed = False
            for x, a in enumerate(live):
                for b in live[x + 1:]:
                    if not sc.mem[a] or not sc.mem[b]:
                        continue
                    ta = (min(boxes[a][0], boxes[b][0]), min(boxes[a][1], boxes[b][1]),
                          max(boxes[a][2], boxes[b][2]), max(boxes[a][3], boxes[b][3]))
                    if overlaps(boxes[a], boxes[b]):
                        sc.mem[a] |= sc.mem[b]; sc.mem[b] = set(); boxes[a] = ta
                        changed = True
        newg = []
        for k in live:
            if sc.mem[k]:
                g = dict(sc.groups[k]); b = boxes[k]
                g["bounding"] = [int(math.floor(b[0])), int(math.floor(b[1])),
                                 int(math.ceil(b[2] - b[0])), int(math.ceil(b[3] - b[1]))]
                newg.append(g)
        return newg

    if out.get("nodes"):
        out["groups"] = do(out["nodes"], out.get("groups") or [])
    for sg in (out.get("definitions") or {}).get("subgraphs") or []:
        if sg.get("nodes"):
            sg["groups"] = do(sg["nodes"], sg.get("groups") or [])
            fix_io(sg, P)
    if out.get("nodes"):
        fix_ds(out)
    return out


def normalize(doc, scale=1.0, P=DEF, merge_overlap=False, repair=4):
    """返回 (out, reps) 或 (None, reps)。repair=线遮迭代修补轮数上限。"""
    out = copy.deepcopy(doc)
    reps = []
    nodes, links = out.get("nodes") or [], out.get("links") or []
    if nodes:
        r = _do_scope(nodes, links, out.get("groups") or [], scale, P, merge_overlap, repair)
        if r is None:
            return None, [("main", {"unsolvable": True})]
        out["groups"] = r[1]; reps.append(("main", r[2]))
    for sg in (out.get("definitions") or {}).get("subgraphs") or []:
        sn, sl = sg.get("nodes") or [], sg.get("links") or []
        if sn:
            r = _do_scope(sn, sl, sg.get("groups") or [], scale, P, merge_overlap, repair)
            if r is None:
                return None, reps + [("sub", {"unsolvable": True})]
            sg["groups"] = r[1]
            fix_io(sg, P)
            reps.append(("sub:%s" % sg.get("name"), r[2]))
    if nodes:
        fix_ds(out)
    return out, reps


def _occlusions(sc, pos):
    """只算遮挡(照 layout_check.check_scope 口径:41 点采样,非端点盒 ±2,Reroute 60x30,
    缺 size 用 [220,120];遮挡盒=声明 size)。返回 {(link, frozenset(被穿节点))}。"""
    from layout_check import (_wire, _size_wh, OCCL_SAMPLES, OCCL_TOL, REROUTE_OCCL_W,
                              REROUTE_OCCL_H, SLOT_DY, SLOT_STEP)
    box = {}
    for i in sc.ids:
        n = sc.by[i]
        w, h = (REROUTE_OCCL_W, REROUTE_OCCL_H) if n.get("type") == "Reroute" else _size_wh(n.get("size"))
        x, y = pos[i]
        box[i] = (x, y, x + w, y + h)
    out = set()
    for lid, oid, os_, tid, ts_ in sc.links:
        if oid not in box or tid not in box:
            continue
        a, b = box[oid], box[tid]
        p0 = (a[2], a[1] + SLOT_DY + (os_ or 0) * SLOT_STEP)
        p3 = (b[0], b[1] + SLOT_DY + (ts_ or 0) * SLOT_STEP)
        hit = set()
        for x, y in _wire(p0, p3, OCCL_SAMPLES):
            for i, bx in box.items():
                if i in (oid, tid):
                    continue
                if bx[0] - OCCL_TOL <= x <= bx[2] + OCCL_TOL and bx[1] - OCCL_TOL <= y <= bx[3] + OCCL_TOL:
                    hit.add(i)
        if hit:
            out.add((lid, frozenset(hit)))
    return out


def _push_out(sc, lid, i, below):
    """给节点 i 追加「离开 link 线带」的约束(below=推到带下方,否则带上方)。返回追加前长度(用于回退)。"""
    P = sc.P
    lk = next(l for l in sc.links if l[0] == lid)
    oid, tid = lk[1], lk[3]
    sa = sc.pp[oid][1] + 25 + (lk[2] or 0) * 20
    sb = sc.pp[tid][1] + 25 + (lk[4] or 0) * 20
    n0 = len(sc.extra_y)
    h = sc.vb[i][3] - sc.vb[i][1]
    ends = ((oid, sa - sc.pp[oid][1]), (tid, sb - sc.pp[tid][1]))
    if below:
        for e, sl in ends:
            sc.extra_y.append((("n", e), ("n", i), P["BAND_EPS"] + sl))
    else:
        for e, sl in ends:
            sc.extra_y.append((("n", i), ("n", e), h + P["BAND_EPS"] - sl))
    return n0


def _band(sc, lid):
    """link 线带的 (min_y, max_y)(按解叠后位置与槽序)。"""
    lk = next(l for l in sc.links if l[0] == lid)
    sa = sc.pp[lk[1]][1] + 25 + (lk[2] or 0) * 20
    sb = sc.pp[lk[3]][1] + 25 + (lk[4] or 0) * 20
    return min(sa, sb), max(sa, sb)


def _do_scope(nodes, links, groups, scale, P, merge_overlap, repair=12):
    """单作用域:求解 → 查新线遮 → 逐个试「推到带下方/上方」(位移小的优先;不可解或没消掉就回退换向)
    → 再解,至多 repair 轮。修补致不可解时回退到上一轮的可行解。"""
    sc = Scope(nodes, links, groups, P)
    sc.merge_overlap = merge_overlap
    occ0 = _occlusions(sc, sc.pp)
    best = sc.run(scale)
    if best[0] is None:
        return None
    given_up = set()
    it = 0
    for it in range(repair):
        pos = best[0]
        new = _occlusions(sc, pos) - occ0
        todo = [(lid, i) for (lid, hit) in sorted(new) for i in sorted(hit) if (lid, i) not in given_up]
        if not todo:
            break
        lid, i = todo[0]
        lo, hi = _band(sc, lid)
        h = sc.vb[i][3] - sc.vb[i][1]
        d_below = max(0.0, hi + P["BAND_EPS"] - pos[i][1])
        d_above = max(0.0, pos[i][1] + h - (lo - P["BAND_EPS"]))
        ok = False
        for below in sorted((True, False), key=lambda b: d_below if b else d_above):
            n0 = _push_out(sc, lid, i, below)
            r = sc.run(scale)
            if r[0] is not None and not any(l == lid and i in hit for (l, hit) in _occlusions(sc, r[0])):
                best = r; ok = True
                break
            del sc.extra_y[n0:]
        if not ok:
            given_up.add((lid, i))
            continue
    pos, gs, rep = best
    for n in nodes:
        n["pos"] = list(pos[n["id"]])
    rep["occl_new"] = len(_occlusions(sc, pos) - occ0)
    rep["deoverlap"] = sc.deoverlap_moves
    return True, gs, rep


def worse_of(before, after, tol):
    """守门差量:受守判据(交叉/线遮/est重叠/est间距/负区/左向)任一超容差即算变差。tol=绝对容差。"""
    worse = {}
    for k in before:
        if k not in after:
            continue
        d = {c: after[k][c] - before[k][c] for c in CHECK_KEYS if c != "group_overlap" and after[k][c] - before[k][c] > tol.get(c, 0)}
        if d:
            worse[k] = d
    return worse


def candidates(doc, P=DEF, ladder=LADDER):
    """按「最紧凑 → 逐级放松 → 只动组框」顺序产出候选 [(档位, doc 或 None)]。与守门策略无关。"""
    cands = []
    for sc_ in ladder:
        for mo in (False, True):
            out, _reps = normalize(doc, sc_, P, merge_overlap=mo)
            cands.append((((sc_, "sep") if not mo else (sc_, "merge")), out))
    cands.append((("groups-only", "-"), normalize_groups_only(doc, P)))
    return cands


def counts_of(doc):
    return {s["name"]: dict(s["counts"]) for s in check_workflow(doc)}


def pick(before, cands, tol=None):
    """按守门容差从候选里取第一个不超容差的。返回 (doc 或 None, report)。"""
    worse = []
    for rung, new in cands:
        if new is None:
            worse.append((rung, "unsolvable")); continue
        after = counts_of(new)
        w = worse_of(before, after, tol or {})
        worse.append((rung, w))
        if not w:
            return new, {"scale": rung, "trail": worse, "before": before, "after": after}
    return None, {"scale": None, "trail": worse, "before": before, "after": None}


def process(doc, P=DEF, ladder=LADDER, tol=None, cands=None):
    cands = cands if cands is not None else candidates(doc, P, ladder)
    return pick(counts_of(doc), cands, tol)


def fmt_scale(sc):
    a, b = sc if isinstance(sc, tuple) else (sc, "s")
    if isinstance(a, str):
        return "%s-%s" % (a, b)
    return "%s-%s" % ("inf" if a == float("inf") else ("%g" % a), b[0])


if __name__ == "__main__":
    import time
    argv = sys.argv[1:]
    TOL, REL = {}, 0.0
    pats = []
    for a in argv:
        if a.startswith("--tol="):
            _a, _r = a.split("=", 1)[1].split(":")
            TOL = {"crossings": int(_a), "occlusion": int(_a)}
            REL = float(_r)
        else:
            pats.append(a)
    root = os.path.join(REPO, "apps/backend/comfyui/workflows")
    tot, rows = {}, []
    for dp, dn, fn in os.walk(root):
        for f in sorted(fn):
            if not f.endswith(".json"):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            if pats and not any(x in rel for x in pats):
                continue
            doc = json.load(open(p, encoding="utf-8"))
            if not (isinstance(doc, dict) and isinstance(doc.get("nodes"), list)) or not doc["nodes"]:
                continue
            t0 = time.time()
            tol = dict(TOL)
            if REL:
                before = {s["name"]: dict(s["counts"]) for s in check_workflow(doc)}
                # 相对容差按最大作用域现值折算(整件一个容差)
                for c in ("crossings", "occlusion"):
                    m = max(v[c] for v in before.values())
                    tol[c] = max(tol.get(c, 0), int(REL * m))
            new, rep = process(doc, tol=tol)
            def ext(d):
                nb = [vbox(n) for n in d.get("nodes") or []]
                gb = [(g["bounding"][0], g["bounding"][1], g["bounding"][0] + g["bounding"][2], g["bounding"][1] + g["bounding"][3]) for g in d.get("groups") or []]
                bs = nb + gb
                if not bs:
                    return (0, 0)
                return (round(max(b[2] for b in bs) - min(b[0] for b in bs)), round(max(b[3] for b in bs) - min(b[1] for b in bs)))
            b0 = ext(doc); b1 = ext(new) if new else None
            key = ("ok@" + fmt_scale(rep["scale"])) if new else "fail"
            tot[key] = tot.get(key, 0) + 1
            rows.append((rel, key, b0, b1, time.time() - t0, rep["trail"]))
    for r in sorted(rows, key=lambda r: (r[1], r[0])):
        print("%-18s %s %s→%s %.1fs" % (r[1], r[0][:64], r[2], r[3], r[4]))
        if "--trail" in argv:
            for t in r[5]:
                print("      %-14s %s" % (fmt_scale(t[0]), json.dumps(t[1], ensure_ascii=False)[:160] if isinstance(t[1], dict) else t[1]))
    print("合计:", dict(sorted(tot.items())))
