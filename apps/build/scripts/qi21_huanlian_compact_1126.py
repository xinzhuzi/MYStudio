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
ROW_GAP = 30
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
    y_cursor_top = TOP_BAND
    if note_id is not None:
        by_id[note_id]["pos"] = [80, 120]   # 置顶说明卡独立纵带(组框之上)
    for d in sorted(columns):
        col = sorted(columns[d], key=lambda nid: (nid == note_id, nid))
        x = PAD_X + d * COL_W
        y = y_cursor_top
        for nid in col:
            if nid == note_id:
                continue   # 置顶说明卡已独立定位,不参与列堆叠
            n = by_id[nid]
            n["pos"] = [x, y]
            n["size"] = [min(n["size"][0], 340), n["size"][1]]
            y_of[nid] = y
            y += n["size"][1] + ROW_GAP
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
