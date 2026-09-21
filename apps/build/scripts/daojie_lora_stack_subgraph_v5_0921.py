#!/usr/bin/env python3
"""[90] 子图 v5:实测复验后的定版布局(09-21)。

v4 在 dev 引擎实测(Playwright 截图)暴露三问题:
① 执行节点吊在矩阵下方(y=1470),子图总高 2220,fitView 缩到 0.34 字不可读;
② 行组空标题被 ComfyUI 丢弃,10 组只渲染 1 组,行间无分隔;
③ 28 控件把执行节点自动撑高到 ~750px,与预设 500 不符。

v5 布局:
- 行组带标题(①人物 · 3:4 · 4.2MP),行标签卡删除(组标题取代之);
- 行高 170(组 140+间 30),矩阵总高 1570;
- 执行节点移右列(x=1700)垂直居中,预算高 780;
- inputNode/outputNode 归位右列顶/底,形成「右列=执行流」;
- 外框组包住全部,总包围盒 ~2100×1600,fitView≈0.60。
"""
import json, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json").read_text(encoding="utf-8"))
BASES = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json").read_text(encoding="utf-8"))
NAME = "LoRA栈·九型驱动"

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]

C_FUNC = {"color": "#1a2a4a", "bgcolor": "#223355"}   # 功能件·蓝
C_FACE = {"color": "#1a3a1a", "bgcolor": "#224422"}   # 面孔/细节·绿
C_STYLE = {"color": "#3a1a3a", "bgcolor": "#442244"}  # 画风·紫
C_MIST = {"color": "#3a2a1a", "bgcolor": "#443322"}   # 水墨·棕

CARD_W, CARD_H = 220, 120
COL_GAP = 250
ROW_GAP = 170          # 组高140 + 组间30
PAD_TITLE = 14         # 组标题栏高(卡片在组内下移量)
START_X = 40
START_Y = 40
EXEC_X = 1700          # 右列执行流
EXEC_W, EXEC_H = 400, 780

CN = "①②③④⑤⑥⑦⑧⑨"


def slot_color(s):
    g = s.get("group", "")
    if "功能" in g: return C_FUNC
    if "水墨" in g: return C_MIST
    if "面孔" in g or "细节" in g: return C_FACE
    return C_STYLE


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == NAME), None)

    sid = str(uuid.uuid4())
    nodes, groups = [], []
    nid = 100
    max_cols = max(sum(1 for s in STACK if s["presets"].get(zh, {}).get("on")) for zh in NINE)
    total_w = max_cols * COL_GAP          # 无行标签卡,矩阵宽=卡片列总宽
    matrix_h = len(NINE) * ROW_GAP        # 1530

    # ── 执行节点(右列垂直居中) ──
    exec_y = START_Y + (matrix_h - EXEC_H) // 2
    nodes.append({
        "id": 1, "type": "MyDaojieLoraStack",
        "pos": [EXEC_X, exec_y], "size": [EXEC_W, EXEC_H],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "base", "type": "COMBO", "link": None},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "title": "▶ 执行·自动跟随[80]选型",
        "properties": {"Node name for S&R": "MyDaojieLoraStack"},
        "widgets_values": ["跟随底座型"] + [v for s in STACK for v in (True, s.get("default_weight", 1.0))],
        "color": "#432", "bgcolor": "#653",
    })

    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_GAP
        base = next(e for e in BASES if e["zh"] == zh)
        ov = base.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{base['megapixels']}MP"
        aspect = base["aspect_ratio"].split(" (")[0]
        col = 0
        for slot in STACK:
            p = slot["presets"].get(zh, {})
            if not p.get("on"): continue
            x = START_X + col * COL_GAP
            c = slot_color(slot)
            nid += 1
            short = slot.get("note", "")
            for line in short.split(";"):
                line = line.strip()
                if line and not any(t in line for t in ["09-", "裁定", "入档"]):
                    short = line; break
            else:
                short = slot.get("label", "")
            nodes.append({
                "id": nid, "type": "MarkdownNote",
                "pos": [x, y + PAD_TITLE], "size": [CARD_W, CARD_H],
                "flags": {}, "order": col + 1, "mode": 0,
                "title": "", "properties": {},
                "widgets_values": [f"**{slot['label']}**\n×{p['weight']:g}\n---\n{short[:60]}"],
                "color": c["color"], "bgcolor": c["bgcolor"],
            })
            col += 1
        # 行组(带标题+id;空标题或缺 id 的组会被前端丢弃/只活第一个——v4/v5 实测)
        groups.append({
            "id": row + 1,
            "title": f"{CN[row]} {zh} · {aspect} · {dims}",
            "bounding": [START_X - 8, y - 6, col * COL_GAP - (COL_GAP - CARD_W) + 22, PAD_TITLE + CARD_H + 14],
            "color": "#2a3a2a", "font_size": 22,
        })

    # 外框组(包住矩阵+右列执行流)
    groups.append({
        "id": 10,
        "title": "九型 × LoRA 配方矩阵(双击[80]选型→自动套用该行)",
        "bounding": [START_X - 24, START_Y - 34, EXEC_X + EXEC_W - START_X + 48, matrix_h + 68],
        "color": "#335533", "font_size": 28,
    })

    sg = {
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 2,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": groups,
        "inputNode": {"id": -10, "bounding": [EXEC_X, START_Y - 60, 140, 48]},
        "outputNode": {"id": -20, "bounding": [EXEC_X, START_Y + matrix_h + 20, 140, 88]},
        "inputs": [
            {"name": "model", "type": "MODEL", "links": []},
            {"name": "base", "type": "COMBO", "type_data": [NINE], "links": [], "widget": False},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "widgets": ["跟随底座型"] + [v for s in STACK for v in (True, s.get("default_weight", 1.0))],
        "links": [], "nodes": nodes,
    }
    defs.append(sg)
    if old: defs.remove(old)

    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型驱动(双击=配方矩阵)"
    n90["properties"] = {"subgraph": sid}

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cards = sum(1 for n in nodes if n["type"] == "MarkdownNote")
    print(f"v5: {cards} 卡 + 9 行组(带标题) + 执行节点右列({EXEC_X},{exec_y}) 总盒≈{EXEC_X + EXEC_W}×{START_Y + matrix_h + 60}")


if __name__ == "__main__":
    main()
