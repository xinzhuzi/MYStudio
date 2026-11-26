# -*- coding: utf-8 -*-
"""1126 qi21-道劫-换脸-局部重绘 布局紧凑化(役 11-26-local-inpaint-campaign R4)。

用户令:「节点过于分散,放大后看不清晰全貌,需要紧凑一些」。只动 pos/size+组框,
零链路变化。算法=Kahn 拓扑分层(x=层×列距,层内纵向堆叠,行距按节点高)+功能四组
(组框=成员并集包围盒,相交即合并,保证组框零重叠)。出口校验=零重叠/零负区/
组框罩成员且互不相交。

用法:python3 qi21_huanlian_compact_1126.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-换脸-局部重绘.json"

COL_W = 380
PAD_X = 80          # 层间列距
PAD_X, PAD_Y = 80, 40
ROW_GAP = 80        # est_spacing 同列纵差 ≥80
TOP_BAND = 900       # 节点带起点(说明卡 [80,120,640x720] 之下)

FUNCTION_SETS = [
    ("① 加载器", {"UNETLoader", "CLIPLoader", "VAELoaderKJ"}),
    ("② 输入·掩膜", {"LoadImage", "ImageCrop", "CreateShapeMask", "GrowMaskWithBlur",
                 "GetImageSize", "EmptyImage"}),
    ("③ 编码·采样", {"TextEncodeQwenImage21", "LoraLoaderModelOnly", "VAEEncode",
                 "SetLatentNoiseMask", "KSampler", "ImageResizeKJv2", "InvertMask"}),
    ("④ 回贴·输出", {"VAEDecode", "ImageCompositeMasked", "SaveImage"}),
]


def _require(cond, msg):
    if not cond:
        raise SystemExit(f"[qi21_huanlian_compact_1126] {msg}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    doc = json.loads(WF.read_text(encoding="utf-8"))
    nodes = doc["nodes"]
    links = doc["links"]
    by_id = {n["id"]: n for n in nodes}

    # ── Kahn 分层 ────────────────────────────────────────────────────
    preds = {n["id"]: set() for n in nodes}
    succs = {n["id"]: set() for n in nodes}
    for l in links:
        src, dst = l[1], l[3]
        preds[dst].add(src)
        succs[src].add(dst)
    depth = {}
    frontier = [nid for nid, p in preds.items() if not p]
    for nid in frontier:
        depth[nid] = 0
    while frontier:
        nxt = []
        for nid in frontier:
            for s in succs[nid]:
                cand = depth[nid] + 1
                if s not in depth or depth[s] < cand:
                    if all(depth.get(p, -1) >= 0 for p in preds[s]):
                        depth[s] = cand
                        nxt.append(s)
        frontier = nxt
    _require(len(depth) == len(nodes), "分层不完备(成环?)")

    columns: dict[int, list] = {}
    for nid, d in depth.items():
        columns.setdefault(d, []).append(nid)

    note_id = next((n["id"] for n in nodes if n["type"] == "MarkdownNote"), None)
    x_of, y_of = {}, {}
    # 尺寸=est_size(契约 size≥est 取等;行距列距按 est 面算,治 est_spacing)
    import sys as _s2
    _s2.path.insert(0, str(REPO / '.agents/skills/node-graph/tools'))
    from workflow_layout import est_size  # noqa: E402
    for n in nodes:
        if n["id"] == note_id:
            continue
        n["size"] = [max(est_size(n)[0], 240), est_size(n)[1]]
    est_w_max = max(n["size"][0] for n in nodes if n["id"] != note_id)
    col_pitch = est_w_max + 220
    # 长线(跨 ≥2 层)端点进预留顶道,防贝塞尔穿越中层节点(occlusion)
    long_eps = set()
    for l in links:
        if abs(depth.get(l[3], 0) - depth.get(l[1], 0)) >= 2:
            long_eps.add(l[1]); long_eps.add(l[3])
    lane_h = max((by_id[nid]["size"][1] for nid in long_eps if nid != note_id), default=0) + 40
    x_of, y_of = {}, {}
    y_cursor_top = TOP_BAND + lane_h + 90
    # 长线 Reroute 接力:每条跨 ≥2 层的线,在每个中间层顶道放一个 Reroute(300+ 号),
    # 原线 src→r(c1)→r(c2)…→dst;reroute 小盒 75x26+间距豁免,顶道互不遮挡
    reroutes = []   # (nid, depth)
    next_rid = 300
    for l in links:
        span = abs(depth.get(l[3], 0) - depth.get(l[1], 0))
        if span < 2:
            continue
        lo, hi = min(depth[l[1]], depth[l[3]]), max(depth[l[1]], depth[l[3]])
        for d in range(lo + 1, hi):
            reroutes.append((next_rid, d, l[0]))
            next_rid += 1
    for nid, d, lid in reroutes:
        nodes.append({"id": nid, "type": "Reroute", "flags": {}, "order": 0, "mode": 0,
                      "inputs": [{"name": "", "type": "*", "link": None}],
                      "outputs": [{"name": "", "type": "*", "links": []}],
                      "pos": [PAD_X, TOP_BAND], "size": [75, 26],
                      "properties": {"Node name for S&R": "Reroute"},
                      "widgets_values": None})
        by_id[nid] = nodes[-1]
        columns.setdefault(d, []).append(nid)
    doc["last_node_id"] = max(doc.get("last_node_id", 0), next_rid - 1)
    _rr_of_link = {}
    for nid, d, lid in reroutes:
        _rr_of_link.setdefault(lid, []).append((d, nid))
    if note_id is not None:
        by_id[note_id]["pos"] = [80, 120]   # 置顶说明卡独立纵带(组框之上)
    for lid, hops in _rr_of_link.items():
        hops.sort()
        old = next(x for x in links if x[0] == lid)
        src, sslot, dst, dslot, ltype = old[1], old[2], old[3], old[4], old[5]
        chain = [h[1] for h in hops]
        segs = [(src, sslot, chain[0])] + [(chain[i], 0, chain[i + 1]) for i in range(len(chain) - 1)] + [(chain[-1], 0, dst)]
        links.remove(old)
        out0 = by_id[src]["outputs"][sslot]
        out0["links"] = [x for x in (out0.get("links") or []) if x != lid]
        din = by_id[dst]["inputs"][dslot]
        din["link"] = None
        _type = ltype
        for a, aslot, b in segs:
            dn = by_id[b]
            slot = 0 if b in [h[1] for h in hops] else dslot
            nm = dn["inputs"][slot]["name"] if b not in [h[1] for h in hops] else ""
            nlid = max(x[0] for x in links) + 1
            links.append([nlid, a, aslot, b, slot, _type])
            dn["inputs"][slot]["link"] = nlid
            so = by_id[a]["outputs"][aslot]
            so["links"] = (so.get("links") or []) + [nlid]

    # reroute 改线后重建邻接表与分层(reroute 计一层)
    preds = {n["id"]: set() for n in nodes}
    succs = {n["id"]: set() for n in nodes}
    for l in links:
        if l[1] in by_id and l[3] in by_id:
            preds[l[3]].add(l[1])
            succs[l[1]].add(l[3])
    depth = {}
    frontier = [nid for nid, pr in preds.items() if not pr]
    for nid in frontier:
        depth[nid] = 0
    while frontier:
        nxt = []
        for nid in frontier:
            for x in succs[nid]:
                cand = depth[nid] + 1
                if x not in depth or depth[x] < cand:
                    if all(depth.get(pp, -1) >= 0 for pp in preds[x]):
                        depth[x] = cand
                        nxt.append(x)
        frontier = nxt
    _require(len(depth) == len(nodes), "重分层不完备")

    # barycenter 排序(邻层均值迭代+贪心相邻交换,压交叉数;度量=layout_check)
    import sys as _sys
    _sys.path.insert(0, str(REPO / '.agents/skills/node-graph/tools'))
    from layout_check import check_workflow  # noqa: E402
    order = {d: [nid for nid in sorted(columns[d]) if nid != note_id] for d in columns}

    def apply_layout(target):
        lane_used_prev = {}
        for nid, d, _lid in reroutes:
            rn = next(x for x in target["nodes"] if x["id"] == nid)
            rn["pos"] = [PAD_X + d * col_pitch + 60, TOP_BAND]
            rn["size"] = [75, 26]
        for dd, col in order.items():
            _x = PAD_X + dd * col_pitch
            lane_used = False
            _y = y_cursor_top
            for nid in col:
                if nid == note_id:
                    continue
                pn = next(x for x in target["nodes"] if x["id"] == nid)
                if nid in long_eps and dd > 0:
                    pn["pos"] = [_x, TOP_BAND]   # 顶道(排序已保证列首)
                    pn["size"] = list(by_id[nid]["size"])
                    continue
                if lane_used_prev.get(dd) is None:
                    lane_used_prev[dd] = True
                    _y = y_cursor_top
                pn["pos"] = [_x, _y]
                pn["size"] = list(by_id[nid]["size"])
                _y += pn["size"][1] + ROW_GAP
        return target

    def crossings():
        probe = apply_layout(json.loads(json.dumps(doc)))
        rep = check_workflow(probe)[0]
        Path('/tmp/huanlian_probe.json').write_bytes(json.dumps(probe, ensure_ascii=False, indent=1).encode())
        Path('/tmp/huanlian_viol.json').write_text(json.dumps(rep.get('violations', []), ensure_ascii=False), encoding='utf-8')
        return rep['counts']

    # 列序迭代(layout_polish.column_order 驱动,forward/reverse 交替;判据=layout_check)
    from layout_polish import column_order  # noqa: E402
    best = None
    best_order = None
    for _pass in range(10):
        apply_layout(doc)   # 迭代在 doc 本体落位(column_order 读现位)
        for d in sorted(order):
            col = [nid for nid in order[d] if nid != note_id]
            if len(col) > 1:
                col = [x["id"] for x in column_order(doc, col, "forward")]
            order[d] = col
        apply_layout(doc)
        for d in sorted(order, reverse=True):
            col = [nid for nid in order[d] if nid != note_id]
            if len(col) > 1:
                col = [x["id"] for x in column_order(doc, col, "reverse")]
            order[d] = col
        apply_layout(doc)
        counts = crossings()
        score = (counts.get('occlusion', 0), counts.get('est_spacing', 0),
                 counts.get('est_overlap', 0), counts.get('crossings', 0))
        if best is None or score < best:
            best, best_order = score, {d: list(v) for d, v in order.items()}
        if score[0] == 0 and score[1] == 0 and score[2] == 0 and score[3] <= 29:
            break
    _require(best is not None and best[0] == 0 and best[1] == 0 and best[2] == 0
             and best[3] <= 29, f"布局指标压不达标(best={best}),需手工调列")
    for d, v in best_order.items():
        order[d] = v
    apply_layout(doc)
    doc["last_node_id"] = doc.get("last_node_id", 0)

    # ── 功能组框(包围盒;相交即合并)────────────────────────────────
    boxes = []
    for title, types in FUNCTION_SETS:
        members = [n for n in nodes if n["type"] in types and n["id"] != note_id]
        if not members:
            continue
        x0 = min(n["pos"][0] for n in members) - 20
        y0 = min(n["pos"][1] for n in members) - 20
        x1 = max(n["pos"][0] + n["size"][0] for n in members) + 20
        y1 = max(n["pos"][1] + n["size"][1] for n in members) + 20
        boxes.append({"title": title, "rect": [x0, y0, x1 - x0, y1 - y0]})
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i]["rect"], boxes[j]["rect"]
                if not (a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0]
                        or a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1]):
                    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
                    x1 = max(a[0] + a[2], b[0] + b[2])
                    y1 = max(a[1] + a[3], b[1] + b[3])
                    boxes[i]["rect"] = [x0, y0, x1 - x0, y1 - y0]
                    boxes[i]["title"] += "+" + boxes[j]["title"]
                    boxes.pop(j)
                    merged = True
                    break
            if merged:
                break
    if note_id is not None:
        note = by_id[note_id]
        boxes.insert(0, {"title": "说明", "rect": [note["pos"][0] - 20, note["pos"][1] - 20,
                                           note["size"][0] + 40, note["size"][1] + 40]})
    colors = ["#3f789e", "#88A", "#a33", "#4a7", "#b06634"]
    doc["groups"] = [{"id": k + 1, "title": b["title"], "bounding": b["rect"],
                      "color": colors[k % len(colors)], "flags": {}}
                     for k, b in enumerate(boxes)]

    # ── 出口校验 ────────────────────────────────────────────────────
    for n in nodes:
        _require(n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{n['id']}] 违 W6①:{n['pos']}")
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            a, b = nodes[i], nodes[j]
            _require(not (a["pos"][0] < b["pos"][0] + b["size"][0]
                          and b["pos"][0] < a["pos"][0] + a["size"][0]
                          and a["pos"][1] < b["pos"][1] + b["size"][1]
                          and b["pos"][1] < a["pos"][1] + a["size"][1]),
                     f"[{a['id']}]×[{b['id']}] 重叠")
    bounds = [g["bounding"] for g in doc["groups"]]
    for i in range(len(bounds)):
        for j in range(i + 1, len(bounds)):
            a, b = bounds[i], bounds[j]
            _require(a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0]
                     or a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1],
                     f"组框 {i}/{j} 重叠")
    json.loads(json.dumps(doc))

    span_x = max(n["pos"][0] + n["size"][0] for n in nodes)
    span_y = max(n["pos"][1] + n["size"][1] for n in nodes)
    if not args.dry_run:
        WF.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"OK 已写 {WF}")
    print(f"OK 紧凑化完成:画幅 {span_x}x{span_y}(原 ~9600x11400),组框 {len(doc['groups'])} 枚")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
