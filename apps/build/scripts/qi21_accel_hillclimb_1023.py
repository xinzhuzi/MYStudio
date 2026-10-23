#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""加速子图布局爬山器 1023(真 checker 为 oracle 的多进程并行评).

输入: /tmp/i2i_seed.json(幸存节点已种 f29b6155 老坐标,新节点已粗放)
输出: /tmp/i2i_hc.json(达标 crossings≤14 且 occlusion≤2,或不达标终态)
"""
import itertools, json, os, re, subprocess, sys
from concurrent.futures import ProcessPoolExecutor

CHECK = ["python3", ".zcode/skills/node-graph/tools/layout_check.py"]
TEMPLATE: dict = {}
SG_KEY = "道劫·加速子图"


def _sg(dd):
    return next(s for s in dd["definitions"]["subgraphs"] if SG_KEY in s["name"])


def eval_pos(args):
    idx, pos_over, tpl = args
    dd = json.loads(tpl)
    nn = {n["id"]: n for n in _sg(dd)["nodes"]}
    for nid, p in pos_over.items():
        nn[nid]["pos"] = p
    path = f"/tmp/hc_{os.getpid()}_{idx}.json"
    json.dump(dd, open(path, "w"), ensure_ascii=False)
    r = subprocess.run(CHECK + [path], capture_output=True, text=True)
    os.remove(path)
    m = re.search(r"加速子图\] crossings: (\d+)", r.stdout)
    oc = len([l for l in r.stdout.splitlines() if "加速子图" in l and "occlusion" in l])
    return (int(m.group(1)) if m else 999, oc)


def main() -> int:
    global TEMPLATE
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/i2i_seed.json"
    d = json.load(open(src))
    TEMPLATE = json.dumps(d, ensure_ascii=False)
    sg = _sg(d)

    def rail_id(v):
        return v.get("id") if isinstance(v, dict) else v
    rail = {rail_id(sg.get("inputNode")), rail_id(sg.get("outputNode"))} - {None}
    ids = [n["id"] for n in sg["nodes"] if n["id"] not in rail]
    pos = {n["id"]: list(n["pos"]) for n in sg["nodes"] if n["id"] not in rail}
    tpl = json.dumps(d, ensure_ascii=False)
    base = eval_pos((0, pos, tpl))
    W = lambda m: m[0] * 10 + m[1] * 3
    score = W(base)
    print("起测", base, flush=True)
    steps = [0, 80, -80, 180, -180, 320, -320, 520, -520]
    # 列聚类(就近 x 带)
    def columns(p):
        xs = sorted((p[i][0], i) for i in ids)
        cols, cur, last = [], [], None
        for x, i in xs:
            if last is not None and x - last > 220:
                cols.append(cur); cur = []
            cur.append(i); last = x
        if cur: cols.append(cur)
        return cols
    hit = None
    with ProcessPoolExecutor(max_workers=10) as ex:
        def batch(cands):
            jobs = [(i, c, tpl) for i, c in enumerate(cands)] + [(len(cands), pos, tpl)]
            res = list(ex.map(eval_pos, jobs))
            bi = min(range(len(res)), key=lambda i: W(res[i]))
            return bi, res

        for rnd in range(8):
            improved = False
            # A) 单节点网格
            for nid in ids:
                cands = []
                for dx, dy in itertools.product(steps, steps):
                    if dx == dy == 0: continue
                    c = dict(pos); c[nid] = [pos[nid][0] + dx, pos[nid][1] + dy]
                    cands.append(c)
                bi, res = batch(cands)
                if bi < len(cands) and W(res[bi]) < score:
                    pos = cands[bi]; score = W(res[bi]); improved = True
                    print(f"  单移 {nid}: {res[bi]}", flush=True)
                    if res[bi][0] <= 14 and res[bi][1] <= 2: hit = (json.loads(json.dumps(pos)), res[bi]); break
                if hit: break
            if hit: break
            # B) 整列平移(全节点同 delta)
            for axis in (0, 1):
                for st in (80, -80, 180, -180, 340, -340):
                    c = {i: [pos[i][0] + (st if axis == 0 else 0), pos[i][1] + (0 if axis == 0 else st)] for i in ids}
                    bi, res = batch([c])
                    if bi < 1 and W(res[bi]) < score:
                        pos = c; score = W(res[bi]); improved = True
                        print(f"  整列 axis{axis} {st}: {res[bi]}", flush=True)
                        if res[bi][0] <= 14 and res[bi][1] <= 2: hit = (json.loads(json.dumps(pos)), res[bi]); break
                if hit: break
            if hit: break
            # C) 列内纵向对换
            for col in columns(pos):
                if len(col) < 2: continue
                for a in range(len(col)):
                    for b in range(a + 1, len(col)):
                        c = dict(pos); c[col[a]] = list(pos[col[b]]); c[col[b]] = list(pos[col[a]])
                        bi, res = batch([c])
                        if bi < 1 and W(res[bi]) < score:
                            pos = c; score = W(res[bi]); improved = True
                            print(f"  对换 {col[a]}<->{col[b]}: {res[bi]}", flush=True)
                            if res[bi][0] <= 14 and res[bi][1] <= 2: hit = (json.loads(json.dumps(pos)), res[bi]); break
                    if hit: break
                if hit: break
            if hit: break
            cur = eval_pos((0, pos, tpl))
            print(f"round{rnd + 1}: {cur} score={score}", flush=True)
            if not improved: break
    if hit:
        pos, m = hit
        print("达标!", m, flush=True)
    for n in sg["nodes"]:
        if n["id"] in pos:
            n["pos"] = list(pos[n["id"]])
    json.dump(d, open("/tmp/i2i_hc.json", "w"), ensure_ascii=False, indent=2)
    print("终态:", eval_pos((0, pos, tpl)), flush=True)
    return 0 if hit else 1


if __name__ == "__main__":
    sys.exit(main())
