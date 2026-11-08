#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""加速子图约束优化器 1023 v2(宪法罚项版).

在 v1(纯 crossings/occlusion)上加三条布局宪法硬罚(违反即大罚):
  C1 子图节点 pos≥80(零负区)
  C2 每条内线 target.x > origin.x(恒向右,边界线以 IO 槽 pos 为端点不计)
  C3 组框罩成员(原组框成员=原中心在原盒内,罚未罩数)
目标仍为 layout_check 实测 crossings/occlusion。种子=当前工作树态。
输出 /tmp/i2i_cst.json。
"""
import itertools, json, os, random, re, subprocess, sys
from concurrent.futures import ProcessPoolExecutor

random.seed(1023)
CHECK = ["python3", ".zcode/skills/node-graph/tools/layout_check.py"]
SGK = "道劫·加速子图"
SRC = sys.argv[1] if len(sys.argv) > 1 else "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
TPL = json.dumps(json.load(open(SRC)), ensure_ascii=False)


def _sg(dd):
    return next(s for s in dd["definitions"]["subgraphs"] if SGK in s["name"])


def rail_id(v):
    return v.get("id") if isinstance(v, dict) else v


def eval_c(args):
    idx, p = args
    dd = json.loads(TPL)
    sg = _sg(dd)
    nn = {n["id"]: n for n in sg["nodes"]}
    for k, v in p.items():
        nn[k]["pos"] = v
    f = f"/tmp/cst_{os.getpid()}_{idx}.json"
    json.dump(dd, open(f, "w"), ensure_ascii=False)
    r = subprocess.run(CHECK + [f], capture_output=True, text=True)
    os.remove(f)
    m = re.search(r"加速子图\] crossings: (\d+)", r.stdout)
    oc = len([l for l in r.stdout.splitlines() if "加速子图" in l and "occlusion" in l])
    cr = int(m.group(1)) if m else 999
    # 约束罚
    pen = 0
    rail = {rail_id(sg.get("inputNode")), rail_id(sg.get("outputNode"))} - {None}
    for i, xy in p.items():
        if xy[0] < 80 or xy[1] < 80:
            pen += 500
    for l in sg.get("links") or []:
        if l["origin_id"] in p and l["target_id"] in p and p[l["target_id"]][0] <= p[l["origin_id"]][0]:
            pen += 300
    for g in sg.get("groups") or []:
        gb = g.get("bounding") or [0, 0, 0, 0]
        bx, by, bw, bh = gb
        for i, xy in p.items():
            w = (nn[i].get("size") or [270, 0])[0] or 270
            h = (nn[i].get("size") or [0, 100])[1] or 100
            if bx <= xy[0] + w / 2 <= bx + bw and by <= xy[1] + h / 2 <= by + bh:
                g["_m"] = g.get("_m", []) + [i]
    return (cr, oc, pen)


def main() -> int:
    d = json.loads(TPL)
    sg = _sg(d)
    rail = {rail_id(sg.get("inputNode")), rail_id(sg.get("outputNode"))} - {None}
    ids = [n["id"] for n in sg["nodes"] if n["id"] not in rail]
    # 原组框成员(以 TPL 原坐标中心判定)
    nn0 = {n["id"]: n for n in _sg(json.loads(TPL))["nodes"]}
    members = []
    for g in sg.get("groups") or []:
        gb = g.get("bounding") or [0, 0, 0, 0]
        bx, by, bw, bh = gb
        ms = [i for i in ids
              if bx <= nn0[i]["pos"][0] + ((nn0[i].get("size") or [270, 0])[0] or 270) / 2 <= bx + bw
              and by <= nn0[i]["pos"][1] + ((nn0[i].get("size") or [0, 100])[1] or 100) / 2 <= by + bh]
        members.append((g, ms))
    def group_pen(p):
        pen = 0
        for g, ms in members:
            gb = g.get("bounding") or [0, 0, 0, 0]
            bx, by, bw, bh = gb
            for i in ms:
                w = (nn0[i].get("size") or [270, 0])[0] or 270
                h = (nn0[i].get("size") or [0, 100])[1] or 100
                if not (bx <= p[i][0] + w / 2 <= bx + bw and by <= p[i][1] + h / 2 <= by + bh):
                    pen += 200
        return pen
    # 包装 eval:组框罚在父进程算(成员表不可 pickle 进TPL?可——但简单起见单算)
    def score(args):
        idx, p = args
        cr, oc, pen = eval_c((idx, p))
        return (cr, oc, pen + group_pen(p), p)
    pos = {n["id"]: list(n["pos"]) for n in sg["nodes"] if n["id"] not in rail}
    cur = score((0, pos)); best = cur
    print("起测 cr/oc/pen:", cur[:3], flush=True)
    W = lambda t: t[0] * 10 + t[1] * 3 + t[2]
    steps = [0, 80, -80, 180, -180, 320, -320]
    with ProcessPoolExecutor(max_workers=10) as ex:
        def batch(cands):
            jobs = [(i, c) for i, c in enumerate(cands)] + [(len(cands), pos)]
            return list(ex.map(eval_c, jobs))
        for rnd in range(8):
            improved = False
            for nid in ids:
                cands = []
                for dx, dy in itertools.product(steps, steps):
                    if dx == dy == 0:
                        continue
                    c = dict(pos)
                    c[nid] = [pos[nid][0] + dx, pos[nid][1] + dy]
                    cands.append(c)
                res = batch(cands)
                res.append(eval_c((len(cands), pos)))
                def Wt(t, p):
                    return t[0] * 10 + t[1] * 3 + t[2] + group_pen(p)
                vals = [Wt(res[i], cands[i] if i < len(cands) else pos) for i in range(len(res))]
                bi = min(range(len(vals)), key=lambda i: vals[i])
                ref = vals[len(vals) - 1]
                if bi < len(cands) and vals[bi] < ref:
                    pos = cands[bi]; improved = True
                    print(f"  单移 {nid}: {res[bi]} pen+grp={vals[bi]-res[bi][0]*10-res[bi][1]*3}", flush=True)
                    if res[bi][0] <= 20 and res[bi][1] <= 2 and res[bi][2] + group_pen(pos) == 0:
                        print("约束达标!", res[bi], flush=True)
                        break
            cur3 = eval_c((0, pos))
            print(f"round{rnd+1}: {cur3} grp_pen={group_pen(pos)}", flush=True)
            if not improved:
                break
    # 组框重罩(成员表按新 pos 全罩)
    for g, ms in members:
        if ms:
            xs1 = [pos[i][0] for i in ms]; ys1 = [pos[i][1] for i in ms]
            xs2 = [pos[i][0] + ((nn0[i].get("size") or [270, 0])[0] or 270) for i in ms]
            ys2 = [pos[i][1] + ((nn0[i].get("size") or [0, 100])[1] or 100) for i in ms]
            g["bounding"] = [min(xs1) - 24, min(ys1) - 54, max(xs2) - min(xs1) + 48, max(ys2) - min(ys1) + 74]
        g.pop("_m", None)
    for n in sg["nodes"]:
        if n["id"] in pos:
            n["pos"] = list(pos[n["id"]])
    json.dump(d, open("/tmp/i2i_cst.json", "w"), ensure_ascii=False, indent=2)
    fin = eval_c((0, pos))
    print("终态 cr/oc/pen:", fin, "grp_pen:", group_pen(pos), flush=True)
    return 0


if __name__ == "__main__":
    main()
