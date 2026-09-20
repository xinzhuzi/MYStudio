#!/usr/bin/env python3
"""[90] 子图 v4:彩色卡片阵列+实链(09-21 用户令:美化)。

LoraLoaderModelOnly 不听 size(画布按 widget 自动算高),文字写不进去。
正解=MarkdownNote 当视觉卡(尊重自定义尺寸/色彩/内容),每件一张彩色卡片
(件名×权重+一句说明+分组色),排九行;执行节点居中下方。
"""
import json, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json").read_text(encoding="utf-8"))
BASES = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json").read_text(encoding="utf-8"))
PREV = "LoRA栈·九型驱动"
NAME = "LoRA栈·九型驱动"

NINE = ["人物","场景","道具","美宣","三视图","高清人脸","分镜剧情图","表情差分","概念气氛图"]

# 分组色彩
C_FUNC  = {"color": "#1a2a4a", "bgcolor": "#223355"}  # 功能件·蓝
C_FACE  = {"color": "#1a3a1a", "bgcolor": "#224422"}  # 面孔/细节·绿
C_STYLE = {"color": "#3a1a3a", "bgcolor": "#442244"}  # 画风·紫
C_MIST  = {"color": "#3a2a1a", "bgcolor": "#443322"}  # 水墨·棕

def slot_color(s):
    g = s.get("group", "")
    if "功能" in g: return C_FUNC
    if "水墨" in g: return C_MIST
    if "面孔" in g or "细节" in g: return C_FACE
    return C_STYLE

CARD_W, CARD_H = 220, 120
COL_GAP = 250
ROW_GAP = 150
LABEL_W = 150
START_X = 40
START_Y = 40


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == PREV), None)

    sid = str(uuid.uuid4())
    nodes = []
    groups = []
    nid = 100

    max_cols = max(sum(1 for s in STACK if s["presets"].get(zh, {}).get("on")) for zh in NINE)
    total_w = LABEL_W + max_cols * COL_GAP

    # ── 执行节点 ──
    exec_y = START_Y + len(NINE) * ROW_GAP + 80
    nodes.append({
        "id": 1, "type": "MyDaojieLoraStack",
        "pos": [START_X + (total_w - 400) // 2, exec_y], "size": [400, 500],
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
        label = next(e for e in BASES if e["zh"] == zh)
        ov = label.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{label['megapixels']}MP"
        aspect = label["aspect_ratio"].split(" (")[0]
        col = 0

        # 行标签
        nid += 1
        nodes.append({
            "id": nid, "type": "MarkdownNote",
            "pos": [START_X, y], "size": [LABEL_W - 15, CARD_H],
            "flags": {}, "order": 0, "mode": 0,
            "title": "", "properties": {},
            "widgets_values": [f"## {zh}\n### {aspect}\n**{dims}**"],
            "color": "#111", "bgcolor": "#222",
        })

        for slot in STACK:
            p = slot["presets"].get(zh, {})
            if not p.get("on"): continue
            x = START_X + LABEL_W + col * COL_GAP
            c = slot_color(slot)
            nid += 1

            # 卡片内容:件名+权重+一句说明
            short = slot.get("note", "")
            # 取第一句有意义的(去裁定号/日期)
            for line in short.split(";"):
                line = line.strip()
                if line and not any(x in line for x in ["09-", "裁定", "入档"]):
                    short = line; break
            else:
                short = slot.get("label", "")

            nodes.append({
                "id": nid, "type": "MarkdownNote",
                "pos": [x, y], "size": [CARD_W, CARD_H],
                "flags": {}, "order": col + 1, "mode": 0,
                "title": "", "properties": {},
                "widgets_values": [
                    f"**{slot['label']}**\n"
                    f"×{p['weight']:g}\n"
                    f"---\n"
                    f"{short[:60]}"
                ],
                "color": c["color"], "bgcolor": c["bgcolor"],
            })
            col += 1

        # 行组框
        groups.append({
            "title": "", "bounding": [START_X - 8, y - 8, LABEL_W + col * COL_GAP + 16, CARD_H + 16],
            "color": "#2a3a2a", "font_size": 0,
        })

    # 总组框
    groups.append({
        "title": "九型 × LoRA 配方矩阵(双击[80]选型→自动套用该行)",
        "bounding": [START_X - 16, START_Y - 24, total_w + 32, len(NINE) * ROW_GAP + 48],
        "color": "#335533", "font_size": 24,
    })

    defs.append({
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 1,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": groups,
        "inputNode": {"id": -10, "bounding": [0, 40, 128, 48]},
        "outputNode": {"id": -20, "bounding": [total_w + 100, 40, 128, 88]},
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
    })

    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型驱动(双击=配方矩阵)"
    n90["properties"] = {"subgraph": sid}

    if old: defs.remove(old)
    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cards = sum(1 for n in nodes if n["type"] == "MarkdownNote" and n.get("color"))
    print(f"v4: {cards} 张彩色卡片(220×120)+9行标签+执行节点; v3已删")


if __name__ == "__main__":
    main()
