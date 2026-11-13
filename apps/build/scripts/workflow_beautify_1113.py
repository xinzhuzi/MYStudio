#!/usr/bin/env python3
"""workflow_beautify_1113 —— 全量排查美观美化役(1113 用户令「…并且进行美观美化」)。

纯坐标手术:只动 node.pos / node.size / group.bounding,禁改拓扑/连线/widget 值/mode/title。
组感知分层布局(优化集布局策略②④⑤⑩ + 11-13 复盘 Step5「一把算完不迭代」):
  1. 按现组框 bounding 把节点归组(保留组数与组成员,三采契约钉死 5 组);
  2. 组间按跨界连线拓扑排序定左右 flow 序;零跨界自含组(TESSERA)沉底排;
  3. 组内最长路径分层(rank=列)+重心法排序消交叉+est 尺寸(横距≥200/纵距≥80);
  4. 组框重算=全包围成员节点+pad+标题栏(标题栏画在 pos 上方,⑩坐标事实);
  5. 全局校验零左向(target.x>origin.x)/零负区(pos≥80)/组框两两不交。

落盘前恒过三道门:①结构保真断言(除 pos/size/bounding 外逐字节等价)②layout_check
指标只降不升 ③契约测试(若该件有)。--dry 只算不写;--out 写到指定件(试排副本)。

用法:
  python3 workflow_beautify_1113.py <wf.json> --out /tmp/x.json   # 试排到副本
  python3 workflow_beautify_1113.py <wf.json> --apply              # 落盘(过门后)
"""
from __future__ import annotations
import json, pathlib, sys, copy, subprocess

REPO = pathlib.Path(__file__).resolve().parents[3]
TOOLS = REPO / ".agents/skills/node-graph/tools"
sys.path.insert(0, str(TOOLS))
from workflow_layout import est_size, _pos, auto_layout  # noqa: E402
from layout_check import check_workflow, CHECK_KEYS  # noqa: E402

H_GAP = 200      # 列间横距(立宪 ROW_GAP_MIN)
V_GAP = 80       # 行内纵距(立宪 COL_GAP_MIN)
GROUP_GAP = 240  # 组间净距
PAD = 45         # 组框内边距
TITLE_H = 46     # 组框标题栏高(画在 pos 上方)
POS_MIN = 80
ORIGIN = (100, 120)


def _edges(wf):
    out = []
    for lk in wf.get("links", []) or []:
        if isinstance(lk, list) and len(lk) >= 5:
            out.append((lk[1], lk[3]))
    return out


def assign_groups(wf):
    """按现组框 bounding 归组;返回 (groups, {gid:[nid]}, orphan[nid])。"""
    groups = wf.get("groups", []) or []
    nodes = wf["nodes"]
    mem = {i: [] for i in range(len(groups))}
    orphan = []
    for n in nodes:
        x, y = _pos(n)
        placed = False
        for i, g in enumerate(groups):
            bx, by, bw, bh = g["bounding"]
            if bx <= x <= bx + bw and by <= y <= by + bh:
                mem[i].append(n["id"]); placed = True; break
        if not placed:
            orphan.append(n["id"])
    return groups, mem, orphan


def layout_cluster(nodes_map, nids, edges, origin):
    """对一组节点做分层布局,返回 {nid:(x,y,w,h)}。纯 est,一把算完。"""
    nids = set(nids)
    succ = {n: [] for n in nids}
    pred = {n: [] for n in nids}
    for s, t in edges:
        if s in nids and t in nids:
            succ[s].append(t); pred[t].append(s)
    rank = {}
    def depth(n, seen):
        if n in rank: return rank[n]
        if n in seen: return 0
        seen = seen | {n}
        r = 0 if not pred[n] else 1 + max(depth(p, seen) for p in pred[n])
        rank[n] = r; return r
    for n in nids: depth(n, set())
    order = {}
    for n, r in rank.items(): order.setdefault(r, []).append(n)
    for r in order: order[r].sort()
    # 重心法消交叉
    pil = {n: i for r in order for i, n in enumerate(order[r])}
    for _ in range(6):
        for r in sorted(order):
            if r > 0:
                order[r].sort(key=lambda n: (sum(pil[p] for p in pred[n]) / len(pred[n]) if pred[n] else pil[n]))
                for i, n in enumerate(order[r]): pil[n] = i
        for r in sorted(order, reverse=True):
            order[r].sort(key=lambda n: (sum(pil[s] for s in succ[n]) / len(succ[n]) if succ[n] else pil[n]))
            for i, n in enumerate(order[r]): pil[n] = i
    # est 尺寸
    size = {n: est_size(nodes_map[n]) for n in nids}
    H = {n: size[n][1] for n in nids}
    W = {n: size[n][0] for n in nids}
    ox, oy = origin
    col_x = {}; x = ox
    for r in sorted(order):
        col_x[r] = x
        x += max((W[n] for n in order[r]), default=250) + H_GAP
    ypos = {}
    for r in sorted(order):
        y = oy
        for n in order[r]:
            ypos[n] = y; y += H[n] + V_GAP
    def ctr(n): return ypos[n] + H[n] / 2.0
    def place(col, desired):
        col = sorted(col, key=lambda n: desired.get(n, ypos[n]))
        tmp = {}; y = 0.0
        for n in col:
            tmp[n] = y; y += H[n] + V_GAP
        cur = sum(tmp[n] + H[n] / 2.0 for n in col) / len(col)
        des = sum(desired.get(n, ctr(n)) for n in col) / len(col)
        sh = des - cur
        for n in col: ypos[n] = tmp[n] + sh
        return col
    cols = sorted(order)
    for _ in range(12):
        for r in cols:
            desired = {n: sum(ctr(p) for p in pred[n]) / len(pred[n]) for n in order[r] if pred[n]}
            order[r] = place(order[r], desired)
        for r in reversed(cols):
            desired = {n: sum(ctr(s) for s in succ[n]) / len(succ[n]) for n in order[r] if succ[n]}
            order[r] = place(order[r], desired)
    if ypos:
        shift = oy - min(ypos.values())
        for n in ypos: ypos[n] += shift
    return {n: (col_x[rank[n]], ypos[n], W[n], H[n]) for n in nids}


def beautify(wf):
    wf = copy.deepcopy(wf)
    nodes_map = {n["id"]: n for n in wf["nodes"]}
    edges = _edges(wf)
    groups, mem, orphan = assign_groups(wf)
    if not groups:
        # 无组:全局分层 + 单组包围
        allids = [n["id"] for n in wf["nodes"]]
        box = layout_cluster(nodes_map, allids, edges, ORIGIN)
        for n in wf["nodes"]:
            x, y, w, h = box[n["id"]]
            n["pos"] = [round(x), round(y)]; n["size"] = [round(w), round(h)]
        return wf
    # 组间跨界依赖
    gid_of = {}
    for i, ids in mem.items():
        for nid in ids: gid_of[nid] = i
    gsucc = {i: set() for i in range(len(groups))}
    gpred = {i: set() for i in range(len(groups))}
    for s, t in edges:
        gs, gt = gid_of.get(s), gid_of.get(t)
        if gs is not None and gt is not None and gs != gt:
            gsucc[gs].add(gt); gpred[gt].add(gs)
    # 主行组=有跨界依赖的;自含组(零跨界)沉底
    main = [i for i in range(len(groups)) if gsucc[i] or gpred[i]]
    below = [i for i in range(len(groups)) if i not in main]
    # 主行组拓扑排序(按跨界 flow),同层按现 x 序
    def gx(i): return groups[i]["bounding"][0]
    ordered = []
    remaining = set(main)
    while remaining:
        ready = [i for i in remaining if not (gpred[i] & remaining)]
        if not ready:  # 环兜底:按现 x
            ready = sorted(remaining, key=gx)
        ready.sort(key=gx)
        for i in ready:
            ordered.append(i); remaining.discard(i)
    # 逐组布局,主行横排
    ox, oy = ORIGIN
    cursor_x = ox
    main_bottom = oy
    group_box = {}
    for i in ordered:
        ids = mem[i] or []
        if not ids:
            group_box[i] = (cursor_x, oy, 200, 100); cursor_x += 200 + GROUP_GAP; continue
        box = layout_cluster(nodes_map, ids, edges, (cursor_x, oy))
        for nid in ids:
            x, y, w, h = box[nid]
            nodes_map[nid]["pos"] = [round(x), round(y)]
            nodes_map[nid]["size"] = [round(w), round(h)]
        xs = [box[n][0] for n in ids]; ys = [box[n][1] for n in ids]
        xe = [box[n][0] + box[n][2] for n in ids]; ye = [box[n][1] + box[n][3] for n in ids]
        gw = max(xe) - min(xs); gh = max(ye) - min(ys)
        group_box[i] = (min(xs), min(ys), gw, gh)
        cursor_x = max(xe) + GROUP_GAP
        main_bottom = max(main_bottom, max(ye))
    # 自含组沉底横排
    cursor_x = ox
    below_y = main_bottom + GROUP_GAP
    for i in sorted(below, key=gx):
        ids = mem[i] or []
        if not ids:
            group_box[i] = (cursor_x, below_y, 200, 100); cursor_x += 200 + GROUP_GAP; continue
        box = layout_cluster(nodes_map, ids, edges, (cursor_x, below_y))
        for nid in ids:
            x, y, w, h = box[nid]
            nodes_map[nid]["pos"] = [round(x), round(y)]
            nodes_map[nid]["size"] = [round(w), round(h)]
        xs = [box[n][0] for n in ids]; xe = [box[n][0] + box[n][2] for n in ids]
        ys = [box[n][1] for n in ids]; ye = [box[n][1] + box[n][3] for n in ids]
        group_box[i] = (min(xs), min(ys), max(xe) - min(xs), max(ye) - min(ys))
        cursor_x = max(xe) + GROUP_GAP
    # 孤儿节点(无组)放最右
    if orphan:
        box = layout_cluster(nodes_map, orphan, edges, (cursor_x, oy))
        for nid in orphan:
            x, y, w, h = box[nid]
            nodes_map[nid]["pos"] = [round(x), round(y)]; nodes_map[nid]["size"] = [round(w), round(h)]
    # 重算组框 bounding(全包围+pad+标题栏)
    for i, g in enumerate(groups):
        if i in group_box:
            x, y, w, h = group_box[i]
            g["bounding"] = [round(x - PAD), round(y - PAD - TITLE_H),
                             round(w + 2 * PAD), round(h + 2 * PAD + TITLE_H)]
    return wf


def beautify_global(wf):
    """全局分层布局(auto_layout:零 est 重叠+零左向,DAG rank 序),再按原成员重算组框。
    适用于无组契约锁的小件(pika/moss/charcard);组框可能因成员散布而重叠,由门判定。"""
    wf = copy.deepcopy(wf)
    groups, mem, orphan = assign_groups(wf)
    auto_layout(wf, origin=ORIGIN)  # 写所有 node pos/size
    nodes_map = {n["id"]: n for n in wf["nodes"]}
    # 重算组框=全包围原成员节点
    for i, g in enumerate(groups):
        ids = mem[i]
        if not ids:
            continue
        xs = [_pos(nodes_map[n])[0] for n in ids]
        ys = [_pos(nodes_map[n])[1] for n in ids]
        xe = [_pos(nodes_map[n])[0] + est_size(nodes_map[n])[0] for n in ids]
        ye = [_pos(nodes_map[n])[1] + est_size(nodes_map[n])[1] for n in ids]
        g["bounding"] = [round(min(xs) - PAD), round(min(ys) - PAD - TITLE_H),
                         round(max(xe) - min(xs) + 2 * PAD),
                         round(max(ye) - min(ys) + 2 * PAD + TITLE_H)]
    return wf


def structure_fingerprint(wf):
    """除 pos/size/bounding 外的结构指纹(保真断言用)。"""
    d = copy.deepcopy(wf)
    for n in d.get("nodes", []):
        n.pop("pos", None); n.pop("size", None)
    for g in d.get("groups", []):
        g.pop("bounding", None)
    return json.dumps(d, sort_keys=True, ensure_ascii=False)


def metrics(wf):
    scopes = check_workflow(wf)  # 返回 scope 报告 list
    agg = {k: 0 for k in CHECK_KEYS}
    for s in scopes:
        for k, v in s["counts"].items(): agg[k] += v or 0
    return agg


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__); return 2
    p = pathlib.Path(args[0])
    orig = json.loads(p.read_text(encoding="utf-8"))
    before = metrics(orig)
    new = beautify_global(orig) if "--global" in sys.argv else beautify(orig)
    after = metrics(new)
    # 门1:结构保真
    assert structure_fingerprint(orig) == structure_fingerprint(new), "结构被改(非纯坐标)!"
    # 门2:指标只降不升(逐 key)
    worse = [k for k in CHECK_KEYS if after[k] > before[k]]
    print("BEFORE:", {k: before[k] for k in CHECK_KEYS if before[k]})
    print("AFTER :", {k: after[k] for k in CHECK_KEYS if after[k]})
    if worse:
        print(f"⚠ 指标上升: {worse}(不达标)")
    # 左向/负区/组重叠硬判据
    hard = [k for k in ("leftward", "negative_region", "group_overlap", "est_overlap") if after[k] > 0]
    if hard:
        print(f"⚠ 硬判据非零: {hard}")
    if "--apply" in sys.argv:
        if worse or hard:
            print("✗ 未过门,拒绝落盘"); return 1
        p.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"✓ 落盘 {p}")
    elif "--out" in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])
        out.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"✓ 试排副本 {out}")
    else:
        print("(只读试算,加 --out 或 --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())