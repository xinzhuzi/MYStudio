#!/usr/bin/env python3
"""道劫主图布局 v10(09-21,回应用户「为什么要这样布局?」)。

病灶(v9 实拍确诊):
  1. [90] 残留 400×980 旧聚合档高度 → ①区被拉成 1300 高,fitView 后下半画布大片空白;
  2. 长线无走廊:TE[15]→[51]/[65]、[90]→[12]、VAE[10]→[11]、[80]→[53] 全部斜穿 ③区节点带;
  3. 说明书 1000 高立在右端,把画布 bbox 再撑宽 780。

v10 手法(列=阶段不动,只治松散与穿线):
  A. [90] 压缩 400×170(子图入口在双击,外框不需要高);
  B. 走廊制:加载行(y80-250)与节点带(y560+)之间留 y260-520 走廊,长线走高不穿箱;
  C. ③区两行化:[50]/[80]/[51]/[63] 上行、[64]/[65] 下行、[62] 预览垫底,
     [80] WH 输出走 y760-820 空档直抵 [53];
  D. 说明书([66] 700×1000+[91])从右端挪到左下,填 ①区下方天然空白,bbox 收窄 780。

用法:python3 apps/build/scripts/daojie_main_graph_layout_v10_0921.py
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"

# ── v10 坐标表:{id: (pos, size|None 保持)} ──
POS: dict[int, tuple[list[int], list[int] | None]] = {
    # ① 加载行 + LoRA 栈
    21: ([40, 80], None),
    15: ([440, 80], None),
    10: ([840, 80], None),
    90: ([1240, 80], [400, 170]),          # 980→170:外框不再预览九行
    86: ([1240, 300], [440, 190]),         # 生效披露,贴 [90] 正下
    # ③ 提示词链(两行 + 预览垫底)
    50: ([1780, 560], None),
    80: ([2540, 560], [676, 260]),         # +60:WH 输出槽压进 y760-820 走线空档
    51: ([3320, 560], [430, 190]),         # -40:给 WH 走线让净空
    63: ([3830, 560], None),
    64: ([1780, 900], None),
    65: ([3320, 900], None),
    62: ([3320, 1200], None),              # 预览件垫底,不占走线带
    # ④ 画布与采样(输入列贴 [12],长线全部从 y<790 高位入 [12])
    53: ([4480, 790], None),
    20: ([4480, 980], None),
    61: ([4480, 1170], None),
    12: ([4880, 560], None),
    11: ([5260, 560], None),
    4: ([5570, 560], None),
    # 说明书:左下填充位
    66: ([40, 560], None),
    91: ([770, 560], None),
}

GROUPS = [
    {"id": 1, "title": "① 模型加载+LoRA栈([21][15][10]→[90];[90]双击=九条真实线路)",
     "bounding": [20, 40, 1650, 480], "color": "#3f789e"},
    {"id": 2, "title": "③ 提示词链([50]主体句→[80]底座→[51]/[65]编码→[63];[64]负向支线;[62]预览)",
     "bounding": [1740, 520, 2700, 960], "color": "#4d9e6a"},
    {"id": 3, "title": "④ 画布与采样([61]已退位旁路;[53][20]→[12]→[11]→[4])",
     "bounding": [4440, 520, 1470, 800], "color": "#c27a3d"},
    {"id": 4, "title": "说明书([66]用法速查+[91]LoRA逻辑图解·纯展示)",
     "bounding": [20, 520, 1190, 1080], "color": "#8a5fb0"},
]

DS = {"scale": 0.31, "offset": [80, 120]}


def main() -> None:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    missing = [nid for nid in POS if nid not in nodes]
    if missing:
        sys.exit(f"[v10] 节点缺失: {missing}")
    for nid, (pos, size) in POS.items():
        nodes[nid]["pos"] = pos
        if size:
            nodes[nid]["size"] = size
    wf["groups"] = [{**g, "flags": g.get("flags", {})} for g in GROUPS]
    wf.setdefault("extra", {})["ds"] = DS

    # 硬校验:节点两两不重叠(同侧间距≥10);组框互不重叠
    boxes = {nid: (n["pos"][0], n["pos"][1],
                   n["pos"][0] + n.get("size", [0, 0])[0],
                   n["pos"][1] + n.get("size", [0, 0])[1])
             for nid, n in nodes.items() if nid in POS and n.get("size")}
    ids = sorted(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            ax0, ay0, ax1, ay1 = boxes[a]
            bx0, by0, bx1, by1 = boxes[b]
            if ax0 < bx1 - 10 and bx0 < ax1 - 10 and ay0 < by1 - 10 and by0 < ay1 - 10:
                sys.exit(f"[v10] 节点重叠: {a} vs {b}")
    gbs = [g["bounding"] for g in GROUPS]
    for i, (x0, y0, w, h) in enumerate(gbs):
        for j, (u0, v0, w2, h2) in enumerate(gbs):
            if i >= j:
                continue
            if x0 < u0 + w2 and u0 < x0 + w and y0 < v0 + h2 and v0 < y0 + h:
                sys.exit(f"[v10] 组框重叠: {GROUPS[i]['title'][:6]} vs {GROUPS[j]['title'][:6]}")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[v10] 主图重排完成: {len(POS)} 节点 + {len(GROUPS)} 组框;ds={DS}")


if __name__ == "__main__":
    main()
