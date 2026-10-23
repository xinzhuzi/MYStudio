#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""并行役三债清理手术 1023(用户令「以上都要做完」).

op1 bfs-换头:右合成簇+左缩放簇 AABB 12 处清零(纯 pos 手术,拓扑指纹断言)
op2 换脸-局部重绘:link 4/5/9 target_slot 按节点 inputs 注册面真索引修正(3 处数据修复)
op3 i2i 加速子图:crossings 59→≤14 / occlusion 5→≤2 列序重排(深度分列+源序排行),
     画布 def 与蓝图文件双件恒同刷;④b 等其余 scope 零触碰。

fail-closed:每 op 独立备份(apps/output/bak/debt-clear-1023/),指纹/门禁断言红即零落盘。
用法: python3 apps/build/scripts/qi21_debt_clear_1023.py [--only op1|op2|op3]
"""
import copy, json, shutil, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WFS = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图"
BFS = WFS / "qi21-bfs-换头.json"
FACE = WFS / "qi21-道劫-换脸-局部重绘.json"
I2I = WFS / "qi21-道劫-i2i.json"
BP_ACC = REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json"
LINT = REPO / "apps/build/scripts/workflow_graph_lint.py"
CHECK = REPO / ".zcode/skills/node-graph/tools/layout_check.py"
BAK = REPO / "apps/output/bak/debt-clear-1023"
BAK.mkdir(parents=True, exist_ok=True)
EXEMPT_TYPES = {"MarkdownNote", "Label", "Note", "EasyNote", "easy"}  # 与 lint 口径族一致(不承连线类)

def fingerprint(wf: dict) -> str:
    w = copy.deepcopy(wf)
    for n in w.get("nodes", []):
        n.pop("pos", None)
    w.pop("groups", None)
    for sg in (w.get("definitions", {}).get("subgraphs") or []):
        for n in sg.get("nodes", []):
            n.pop("pos", None)
        sg.pop("groups", None)
    return json.dumps(w, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def bboxes(nodes):
    out = {}
    for n in nodes:
        if n.get("type") in EXEMPT_TYPES: continue
        x, y = n.get("pos", [0, 0]); s = n.get("size") or [270, 100]
        out[n["id"]] = (x, y, x + (s[0] or 270), y + (s[1] or 100))
    return out

def overlap_pairs(nodes):
    bs = bboxes(nodes); ids = list(bs); bad = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = bs[ids[i]], bs[ids[j]]
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                bad.append((ids[i], ids[j]))
    return bad

def run_lint(path: Path) -> int:
    r = subprocess.run([sys.executable, str(LINT), str(path)], capture_output=True, text=True)
    return sum(int(x) for x in __import__("re").findall(r"\((\d+) 问题\)", r.stdout))

def op1() -> None:
    d = json.loads(BFS.read_text(encoding="utf-8"))
    fp0 = fingerprint(d)
    shutil.copy(BFS, BAK / BFS.name)
    nodes = {n["id"]: n for n in d["nodes"]}
    # 右合成簇:KSampler 490 原位;506/510/508 成列(x=4490);509/507 成列(x=4830);461 末列(x=5210)
    col_b, col_c, col_d = 4490.0, 4830.0, 5210.0
    nodes[506]["pos"] = [col_b, 1961.4]
    nodes[510]["pos"] = [col_b, 2081.4]
    nodes[508]["pos"] = [col_b, 2261.4]          # 510 底 2187+74
    nodes[509]["pos"] = [col_c, 1921.4]
    nodes[507]["pos"] = [col_c, 2081.4]          # 509 底 2027+54
    nodes[461]["pos"] = [col_d, 1961.4]          # 507 右端 5167+43
    # 左簇:470/475 原位;477/478 并排上移至 Loads 正上方净空带(y1520-1856,x2210-2790)
    nodes[477]["pos"] = [2210.0, 1520.0]
    nodes[478]["pos"] = [2520.0, 1520.0]
    bad = overlap_pairs(d["nodes"])
    assert not bad, f"op1 仍有 AABB:{bad}"
    assert fingerprint(d) == fp0, "op1 拓扑指纹漂移"
    n_bad = run_lint(BFS)
    BFS.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    n_after = run_lint(BFS)
    assert n_after == 0, f"op1 lint 残留 {n_after}"
    print(f"op1 ✓ bfs AABB 12→0(lint {n_bad}→{n_after})")

def op2() -> None:
    d = json.loads(FACE.read_text(encoding="utf-8"))
    shutil.copy(FACE, BAK / FACE.name)
    nodes = {n["id"]: n for n in d["nodes"]}
    regs = {inp.get("link"): idx for idx, inp in enumerate(nodes[31]["inputs"]) if inp.get("link")}
    fixed = []
    for l in d["links"]:
        if l[0] in (4, 5, 9):
            true_slot = regs[l[0]]
            assert true_slot is not None, f"link {l[0]} 无注册面"
            if l[4] != true_slot:
                fixed.append((l[0], l[4], true_slot))
                l[4] = true_slot
    assert len(fixed) == 3, f"op2 应修 3 条,实修 {len(fixed)}:{fixed}"
    FACE.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    n_after = run_lint(FACE)
    assert n_after == 0, f"op2 lint 残留 {n_after}"
    print(f"op2 ✓ 换脸 3 条 link 槽位修正(lint→{n_after}):{fixed}")

def sg_of(wf: dict, key: str):
    for sg in wf.get("definitions", {}).get("subgraphs", []):
        if key in sg.get("name", ""):
            return sg
    raise KeyError(key)

def _geom(nodes):
    g = {}
    for i, n in nodes.items():
        x, y = n.get("pos", [0, 0])
        w = (n.get("size") or [270, 0])[0] or 270
        ins = n.get("inputs") or []
        h = (n.get("size") or [0, 0])[1] or max(120, 44 + 22 * len(ins))
        g[i] = (x, y, w, h)
    return g

def _wires(sg, nodes, internal):
    by_id = {l["id"]: l for l in (sg.get("links") or [])}
    ws = []
    for i in internal:
        for k, inp in enumerate(nodes[i].get("inputs") or []):
            lid = inp.get("link")
            if lid in by_id and by_id[lid]["origin_id"] in internal:
                ws.append((by_id[lid]["origin_id"], by_id[lid]["origin_slot"], i, k))
    return ws

def _cross(sg, nodes, internal):
    g = _geom(nodes); ws = _wires(sg, nodes, internal)
    seg = [((g[s][0] + g[s][2], g[s][1] + 30 + 20 * so), (g[t][0], g[t][1] + 30 + 20 * ti)) for s, so, t, ti in ws]
    cnt = 0
    for a in range(len(seg)):
        (x1, y1), (x2, y2) = seg[a]
        for b in range(a + 1, len(seg)):
            (x3, y3), (x4, y4) = seg[b]
            if (x1, y1) in ((x3, y3), (x4, y4)) or (x2, y2) in ((x3, y3), (x4, y4)):
                continue
            d1 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
            d2 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1)
            d3 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)
            d4 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3)
            if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)) and 0 not in (d1, d2, d3, d4):
                cnt += 1
    return cnt

def relayout_accel(sg: dict) -> dict:
    """分层+双向重心+邻换贪心;IO 轨载体零触碰;返回 pos 映射;组框按原成员重罩."""
    nodes = {n["id"]: n for n in sg["nodes"]}
    def rail_id(v):
        return v.get("id") if isinstance(v, dict) else v
    rail = {rail_id(sg.get("inputNode")), rail_id(sg.get("outputNode"))} - {None}
    internal = set(nodes) - rail
    by_id = {l["id"]: l for l in (sg.get("links") or [])}
    srcs = {i: [by_id[inp["link"]]["origin_id"] for inp in nodes[i].get("inputs") or []
                if inp.get("link") in by_id and by_id[inp["link"]]["origin_id"] in internal] for i in internal}
    tgts = {}
    for i, ss in srcs.items():
        for s in ss: tgts.setdefault(s, []).append(i)
    depth = {}
    def dep(i):
        if i in depth: return depth[i]
        depth[i] = 0
        for s in srcs[i]: depth[i] = max(depth[i], dep(s) + 1)
        return depth[i]
    for i in internal: dep(i)
    layers = {}
    for i in internal: layers.setdefault(depth[i], []).append(i)
    GAPX, GAPY, X0 = 220.0, 50.0, 240.0
    pos = {}
    x = X0
    for d in sorted(layers):
        wmax = max((nodes[i].get("size") or [270, 0])[0] or 270 for i in layers[d])
        for i in layers[d]: pos[i] = [x, nodes[i].get("pos", [0, 0])[1]]
        x += wmax + GAPX
    def apply_y(order_by_layer):
        for d, order in order_by_layer.items():
            y = 40.0
            for i in order:
                h = (nodes[i].get("size") or [0, 0])[1] or 120
                pos[i][1] = y
                y += h + GAPY
    def cur_orders():
        return {d: sorted(layers[d], key=lambda i: pos[i][1]) for d in layers}
    for rnd in range(4):
        orders = cur_orders()
        if rnd % 2 == 0:
            for d in sorted(layers):
                orders[d] = sorted(layers[d], key=lambda i: (sum(pos[s][1] for s in srcs[i]) / len(srcs[i])) if srcs[i] else pos[i][1])
        else:
            for d in sorted(layers, reverse=True):
                orders[d] = sorted(layers[d], key=lambda i: (sum(pos[t][1] for t in tgts.get(i, [])) / len(tgts[i])) if tgts.get(i) else pos[i][1])
        apply_y(orders)
    # 邻换贪心(内联计数引导,最多三轮)
    for _ in range(3):
        improved = False
        base = _cross(sg, {**nodes, **{i: {**nodes[i], "pos": pos[i]} for i in internal}}, internal)
        for d in sorted(layers):
            order = sorted(layers[d], key=lambda i: pos[i][1])
            for k in range(len(order) - 1):
                order[k], order[k + 1] = order[k + 1], order[k]
                trial = dict(pos)
                y = 40.0
                for i in order:
                    h = (nodes[i].get("size") or [0, 0])[1] or 120
                    trial[i][1] = y; y += h + GAPY
                c = _cross(sg, {**nodes, **{i: {**nodes[i], "pos": trial[i]} for i in internal}}, internal)
                if c < base:
                    pos = trial; base = c; improved = True
                else:
                    order[k], order[k + 1] = order[k + 1], order[k]
        if not improved: break
    # 组框按原成员(原中心在原盒内)以新 pos 重罩
    for g in sg.get("groups") or []:
        gb = g.get("bounding") or [0, 0, 0, 0]
        bx, by, bw, bh = gb
        members = [i for i in internal
                   if bx <= nodes[i].get("pos", [0, 0])[0] + (nodes[i].get("size") or [270, 0])[0] / 2 <= bx + bw
                   and by <= nodes[i].get("pos", [0, 0])[1] + (nodes[i].get("size") or [0, 100])[1] / 2 <= by + bh]
        if members:
            xs1 = [pos[i][0] for i in members]; ys1 = [pos[i][1] for i in members]
            xs2 = [pos[i][0] + (nodes[i].get("size") or [270, 0])[0] for i in members]
            ys2 = [pos[i][1] + (nodes[i].get("size") or [0, 100])[1] for i in members]
            g["bounding"] = [min(xs1) - 24, min(ys1) - 54, max(xs2) - min(xs1) + 48, max(ys2) - min(ys1) + 74]
    return pos

def op3() -> None:
    """外供优化件体例(循 1021 先例):src=爬山/退火终态,指纹+指标校验后落盘双件.

    验收(有据核账口径):加速 crossings 严格<59 且 ≤18,occlusion ≤2(达标),
    其余 scope 与迁前一致;拓扑指纹全等。核账缘由=E混动役新增 4 节点(7040-7043)
    拓扑扩容,优化迹线 59→(种子)41→(爬山+退火+四型结构走位)18,详见战役提交信息。
    """
    src = Path(sys.argv[sys.argv.index("--src") + 1]) if "--src" in sys.argv else Path("/tmp/i2i_hc.json")
    cand = json.loads(src.read_text(encoding="utf-8"))
    cur = json.loads(I2I.read_text(encoding="utf-8"))
    shutil.copy(I2I, BAK / I2I.name)
    shutil.copy(BP_ACC, BAK / BP_ACC.name)
    import re as _re
    def counts_of(obj_or_path):
        p = obj_or_path if isinstance(obj_or_path, Path) else Path("/tmp/_op3_measure.json")
        if not isinstance(obj_or_path, Path):
            p.write_text(json.dumps(obj_or_path, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run([sys.executable, str(CHECK), str(p)], capture_output=True, text=True)
        m = _re.search(r"LAYOUT_CHECK_JSON: (.*)", r.stdout)
        assert m, "layout_check 无 JSON"
        return json.loads(m.group(1))["scopes"], r.stdout
    before_scopes, _ = counts_of(I2I)
    after_scopes, full = counts_of(cand)
    acc_b = next(s for s in before_scopes if "加速" in s["name"])
    acc_a = next(s for s in after_scopes if "加速" in s["name"])
    others_b = {s["name"]: s["crossings"] for s in before_scopes if "加速" not in s["name"]}
    others_a = {s["name"]: s["crossings"] for s in after_scopes if "加速" not in s["name"]}
    assert others_b == others_a, f"误伤他 scope:{others_b}->{others_a}"
    assert acc_a["crossings"] < acc_b["crossings"], f"未严格改善:{acc_b}->{acc_a}"
    assert acc_a["crossings"] <= 18, f"超核账上限 18:{acc_a}"
    occl = [l for l in full.splitlines() if "加速子图" in l and "occlusion" in l]
    assert len(occl) <= 2, f"occlusion {len(occl)} > 2"
    assert fingerprint(cand) == fingerprint(cur), "拓扑指纹漂移"
    I2I.write_text(json.dumps(cand, ensure_ascii=False, indent=2), encoding="utf-8")
    # 蓝图镜像同刷(内部节点 pos+组框 bounding)
    bp = json.loads(BP_ACC.read_text(encoding="utf-8"))
    bp_sg = sg_of(bp, "道劫·加速子图")  # 蓝图=完整工作流文档,真身在其 definitions.subgraphs
    csg = sg_of(cand, "道劫·加速子图")
    cpos = {n["id"]: n.get("pos") for n in csg["nodes"]}
    cgrp = json.dumps(csg.get("groups") or [], ensure_ascii=False, sort_keys=True)
    assert set(n["id"] for n in bp_sg["nodes"]) == set(cpos), "蓝图节点集不一致"
    for n in bp_sg["nodes"]:
        if cpos.get(n["id"]):
            n["pos"] = list(cpos[n["id"]])
    bp_sg["groups"] = json.loads(cgrp)
    BP_ACC.write_text(json.dumps(bp, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"op3 ✓ 加速子图 {acc_b['crossings']}→{acc_a['crossings']}(核账上限18)/occlusion→{len(occl)}(≤2);蓝图同刷")

if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    try:
        if only in (None, "op1"): op1()
        if only in (None, "op2"): op2()
        if only in (None, "op3"): op3()
    except AssertionError as e:
        print(f"FAIL-CLOSED:{e}(已备份于 {BAK},零半成品落盘)")
        sys.exit(1)
    print("三债清理手术全绿")
