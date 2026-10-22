#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""i2i ②装配主链布局优化+②指令外露带并组 v2(10-22 用户令).

v1 教训:自由y乱序搜索=散架。v2=结构骨架(四列 x 钉死 2100/2700/3260/4520,
同行距>=200 合规)+语义序种子+精确评分器(逐字口移植 node-graph/tools/
layout_check.py:bezier k=clamp(dx/2,40,200) 24采样交叉/采样遮挡±2/
est_overlap/est_spacing 200·80),爬山只动 y(列平移+D换位+9三位+400.y)。
终态以真 layout_check.py 子进程复核,硬门槛 crossings<=44 且 occlusion<=7。
"""
import copy, itertools, json, shutil, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
CHECK = REPO / ".agents/skills/node-graph/tools/layout_check.py"
BAK = REPO / "apps/output/bak/i2i-asm-layout-1022"

XA, XB, XC, XD = 2100.0, 2700.0, 3260.0, 4520.0
SIX_X = 3750
MOVERS = [10, 11, 12, 505, 16, 17, 18, 9, 400, 4015, 171, 4, 401]
COL = {10: XA, 11: XA, 12: XA, 505: XA,
       16: XB, 17: XB, 18: XB, 9: XB, 400: XC,
       4015: XD, 171: XD, 4: XD, 401: XD}
GAP = 100
SLOT_DY, SLOT_STEP, OCCL_TOL = 25, 20, 2
CROSS_N, OCCL_N = 24, 41
K_MIN, K_MAX = 40.0, 200.0


def wire_pts(p0, p3, n):
    dx = abs(p3[0] - p0[0]); k = max(K_MIN, min(K_MAX, dx * 0.5))
    p1 = (p0[0] + k, p0[1]); p2 = (p3[0] - k, p3[1])
    out = []
    for i in range(n):
        t = i / (n - 1); mt = 1 - t
        out.append((mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0],
                    mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1]))
    return out


def cr(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])


def seg_int(a, b, c, d):
    d1, d2, d3, d4 = cr(c, d, a), cr(c, d, b), cr(a, b, c), cr(a, b, d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def slot_out(n, s):
    return (n["pos"][0] + n["size"][0], n["pos"][1] + SLOT_DY + (s or 0) * SLOT_STEP)


def slot_in(n, s):
    return (n["pos"][0], n["pos"][1] + SLOT_DY + (s or 0) * SLOT_STEP)


def score(nodes, links):
    wires = []
    for l in links:
        o, t = nodes.get(l[1]), nodes.get(l[3])
        if not o or not t:
            continue
        wires.append((l[1], l[3], wire_pts(slot_out(o, l[2]), slot_in(t, l[4]), CROSS_N)))
    cross = 0
    for i in range(len(wires)):
        a = wires[i][2]
        for j in range(i + 1, len(wires)):
            b = wires[j][2]
            hit = False
            for k in range(len(a) - 1):
                for m in range(len(b) - 1):
                    if seg_int(a[k], a[k+1], b[m], b[m+1]):
                        hit = True; break
                if hit: break
            if hit: cross += 1
    ids = list(nodes)
    boxes = {n: (nodes[n]["pos"][0], nodes[n]["pos"][1],
                 nodes[n]["pos"][0] + nodes[n]["size"][0],
                 nodes[n]["pos"][1] + nodes[n]["size"][1]) for n in ids}
    occl = 0
    for (oid, tid, pts) in wires:
        dense = wire_pts(pts[0], pts[-1], OCCL_N)
        hit = False
        for (x, y) in dense:
            for nid in ids:
                if nid in (oid, tid): continue
                bx = boxes[nid]
                if bx[0]-OCCL_TOL <= x <= bx[2]+OCCL_TOL and bx[1]-OCCL_TOL <= y <= bx[3]+OCCL_TOL:
                    hit = True; break
            if hit: break
        if hit: occl += 1
    ov = 0; sp = 0
    for i in range(len(ids)):
        for j in range(i+1, len(ids)):
            a, b = boxes[ids[i]], boxes[ids[j]]
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                ov += 1
            yov = min(a[3], b[3]) - max(a[1], b[1]); xov = min(a[2], b[2]) - max(a[0], b[0])
            if yov > 0 and xov <= 0 and -xov < 200: sp += 1
            elif xov > 0 and yov <= 0 and -yov < 80: sp += 1
    return cross, occl, ov, sp


def apply_y(nodes, ymap):
    for nid, y in ymap.items():
        nodes[nid]["pos"] = [COL[nid], y]


def build(base_nodes, ymap):
    nn = {k: copy.deepcopy(v) for k, v in base_nodes.items()}
    apply_y(nn, ymap)
    return nn


def stack(order, y0, H):
    out, cur = {}, y0
    for nid in order:
        out[nid] = cur; cur += H[nid] + GAP
    return out


def main() -> int:
    raw = WF.read_text(encoding="utf-8")
    wf = json.loads(raw)
    g3 = [g for g in wf["groups"] if g.get("id") == 3]
    assert len(g3) == 1 and g3[0]["title"] == "道劫·②指令外露带"
    base = {n["id"]: n for n in wf["nodes"]}
    assert base[6]["pos"][0] == SIX_X and abs(base[6]["pos"][1] - 1798) < 1
    links = wf["links"]
    H = {nid: base[nid]["size"][1] for nid in MOVERS}
    base_score = score(base, links)
    print(f"[评分] 现:cross={base_score[0]} occl={base_score[1]} ov={base_score[2]} sp={base_score[3]}")

    colA = [10, 11, 12, 505]; colB = [16, 17, 18]; colD = [4015, 171, 4, 401]
    NINE = ["topB", "botB", "botA"]
    seeds = []
    for dord in itertools.permutations(colD):
        for nine in NINE:
            for yA in (1750, 1850):
                ymap = stack(colA, yA, H)
                yB0 = yA + 50
                if nine == "topB":
                    ymap[9] = yB0
                    ymap.update(stack(colB, yB0 + H[9] + GAP, H))
                elif nine == "botB":
                    ymap.update(stack(colB, yB0, H))
                    ymap[9] = yB0 + 3 * (130 + GAP) + GAP
                else:
                    ymap.update(stack(colB, yB0, H))
                    ymap[9] = ymap[505] + H[505] + GAP
                ymap.update(stack(list(dord), yA + 50, H))
                ymap[400] = 1450
                seeds.append(ymap)

    def ok(ymap):
        nn = build(base, ymap)
        s = score(nn, links)
        if s[2] > 0: return None
        if not (ymap[400] < 1798): return None
        if not (ymap[400] + H[400] + 80 <= 1798): return None
        for nid in MOVERS:
            if ymap[nid] < 80: return None
        return s

    best, best_s = None, None
    for ym in seeds:
        s = ok(ym)
        if s and (best_s is None or s < best_s):
            best, best_s = dict(ym), s
    assert best_s is not None, "无合法种子"
    print(f"[种子优] cross={best_s[0]} occl={best_s[1]} sp={best_s[3]}")

    cur, cur_s = dict(best), best_s
    for round_ in range(40):
        improved = False
        cands = []
        for col, members in (("A", colA), ("B", colB), ("D", colD), ("9", [9]), ("400", [400])):
            for dy in (-160, -80, -40, 40, 80, 160):
                ym = dict(cur)
                for nid in members:
                    ym[nid] = cur[nid] + dy
                cands.append(ym)
        for i in range(len(colD)):
            for j in range(i+1, len(colD)):
                a, b = colD[i], colD[j]
                ym = dict(cur); ym[a], ym[b] = cur[b], cur[a]
                cands.append(ym)
                order = sorted(colD, key=lambda n: cur[n])
                order.remove(a); order.insert(order.index(b), a)
                ym2 = dict(cur)
                ym2.update(stack(order, min(cur[n] for n in colD), H))
                cands.append(ym2)
        for nine in NINE:
            ym = dict(cur)
            if nine == "topB":
                ym[9] = min(cur[n] for n in colB) - GAP - H[9]
            elif nine == "botB":
                ym[9] = max(cur[n] + H[n] for n in colB) + GAP
            else:
                ym[9] = max(cur[n] + H[n] for n in colA) + GAP
            cands.append(ym)
        for ym in cands:
            s = ok(ym)
            if s and s < cur_s:
                cur, cur_s = dict(ym), s
                improved = True
        if not improved:
            break
    best, best_s = cur, cur_s
    print(f"[爬山优] cross={best_s[0]} occl={best_s[1]} sp={best_s[3]}")

    nodes = base
    apply_y(nodes, best)
    wf["groups"].remove(g3[0])
    g2 = next(g for g in wf["groups"] if g.get("id") == 2)
    mem = MOVERS + [6]
    x0 = min(nodes[n]["pos"][0] for n in mem) - 60
    y0 = min(nodes[n]["pos"][1] for n in mem) - 60
    x1 = max(nodes[n]["pos"][0] + nodes[n]["size"][0] for n in mem) + 60
    y1 = max(nodes[n]["pos"][1] + nodes[n]["size"][1] for n in mem) + 60
    g2["bounding"] = [x0, y0, x1 - x0, y1 - y0]

    s_final = score(nodes, links)
    assert s_final == best_s
    loaders_right = max(nodes[i]["pos"][0] + nodes[i]["size"][0] for i in (1, 2, 3))
    for nid in (10, 11, 16, 17, 9):
        assert loaders_right < nodes[nid]["pos"][0] and nodes[nid]["pos"][0] + nodes[nid]["size"][0] < SIX_X
    for l in links:
        assert nodes[l[3]]["pos"][0] > nodes[l[1]]["pos"][0], f"左向 {l[:5]}"
    assert nodes[400]["pos"][1] < nodes[6]["pos"][1]
    bx, by, bw, bh = g2["bounding"]
    for nid in mem:
        n = nodes[nid]
        assert bx <= n["pos"][0] and n["pos"][0] + n["size"][0] <= bx + bw \
            and by <= n["pos"][1] and n["pos"][1] + n["size"][1] <= by + bh
    boxes = [(g["title"], *g["bounding"]) for g in wf["groups"]]
    for i in range(len(boxes)):
        for j in range(i+1, len(boxes)):
            t1, x0_, y0_, w_, h_ = boxes[i]; t2, x1_, y1_, w2_, h2_ = boxes[j]
            assert x0_ + w_ <= x1_ or x1_ + w2_ <= x0_ or y0_ + h_ <= y1_ or y1_ + h2_ <= y0_, \
                f"组重叠 {t1}/{t2}"
    g4 = next(g for g in wf["groups"] if g.get("id") == 4)["bounding"]
    for nid in (7, 20):
        n = nodes[nid]
        assert g4[0] <= n["pos"][0] and n["pos"][0] + n["size"][0] <= g4[0] + g4[2] \
            and g4[1] <= n["pos"][1] and n["pos"][1] + n["size"][1] <= g4[1] + g4[3]

    BAK.mkdir(parents=True, exist_ok=True)
    if not (BAK / WF.name).exists():
        shutil.copy2(WF, BAK / WF.name)
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + ("\n" if raw.endswith("\n") else ""),
                  encoding="utf-8")
    proc = subprocess.run([sys.executable, str(CHECK), "--json", str(WF)],
                          capture_output=True, text=True)
    line = next(l for l in reversed(proc.stdout.splitlines()) if l.startswith("LAYOUT_CHECK_JSON:"))
    scopes = {s["name"]: s["counts"] for s in json.loads(line[len("LAYOUT_CHECK_JSON:"):])["scopes"]}
    main_c = scopes["main"]
    print(f"[真检查器] main: {main_c}")
    assert main_c["crossings"] <= 44 and main_c["occlusion"] <= 7, "未过硬门槛"
    assert main_c["est_overlap"] == 0 and main_c["leftward"] == 0 and main_c["group_overlap"] == 0
    print(f"落盘: G3 撤;G2 x[{x0:.0f},{x1:.0f}] y[{y0:.0f},{y1:.0f}]")
    for nid in MOVERS:
        print(f"  [{nid}] -> [{COL[nid]:.0f}, {best[nid]:.0f}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
