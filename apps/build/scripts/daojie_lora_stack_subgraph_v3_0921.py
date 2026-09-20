#!/usr/bin/env python3
"""[90] 子图 v3:九行实链美化版(09-21 用户令:节点布局合理+美化)。

v2问题:节点过小(170×80)、列距过窄(180)、无色彩分组、无链路视觉、执行节点孤岛。
v3改进:
- 节点加大到 240×110,列距 280,能完整显示标题
- 色彩分组:功能件=蓝、面孔/细节=绿、画风=紫、质感=橙
- 每行加 MODEL→→→ 箭头视觉(左侧入→右侧出)
- 行间距 160(紧凑),行组框按型着色
- 执行节点居中放九行下方,尺寸放大
- 行标签加大,型名+画幅+像素一目了然
"""
import json
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
BASES_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
V2_NAME = "LoRA栈·九型驱动(九行实链·每件自带说明)"
V3_NAME = "LoRA栈·九型驱动"

NINE = ["人物","场景","道具","美宣","三视图","高清人脸","分镜剧情图","表情差分","概念气氛图"]

# 色彩方案(按分组)
GROUP_COLORS = {
    "功能件":   {"color": "#223", "bgcolor": "#335"},
    "人物三件": {"color": "#232", "bgcolor": "#353"},
    "画风":     {"color": "#323", "bgcolor": "#535"},
    "画风水墨": {"color": "#323", "bgcolor": "#535"},
    "质感":     {"color": "#332", "bgcolor": "#533"},
}

# 布局参数
NODE_W, NODE_H = 240, 110
COL_GAP = 280           # 列间距
ROW_GAP = 160           # 行间距
START_X = 60            # 首列x(留行标签位)
START_Y = 40            # 首行y
LABEL_W = 140           # 行标签宽


def slot_color(slot):
    g = slot.get("group", "")
    if "功能" in g: return GROUP_COLORS["功能件"]
    if "水墨" in g or "画风" in g: return GROUP_COLORS["画风水墨"]
    if "面孔" in g or "细节" in g: return GROUP_COLORS["人物三件"]
    return {"color": "#333", "bgcolor": "#555"}


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    if any(s.get("name") == V3_NAME for s in defs):
        print("v3 已存在(幂等跳过)")
        return

    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))

    # 删 v2
    v2 = next((s for s in defs if s.get("name") == V2_NAME), None)

    sid = str(uuid.uuid4())
    nodes = []
    groups = []
    nid = 100

    # ── 执行节点(居中放九行下方) ──
    max_cols = max(
        sum(1 for s in slots if s["presets"].get(zh, {}).get("on"))
        for zh in NINE
    )
    total_w = LABEL_W + max_cols * COL_GAP
    exec_x = START_X + (total_w - 400) // 2
    exec_y = START_Y + len(NINE) * ROW_GAP + 80

    nodes.append({
        "id": 1, "type": "MyDaojieLoraStack",
        "pos": [exec_x, exec_y], "size": [400, 500],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "base", "type": "COMBO", "link": None},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "title": "▶ 执行·MyDaojieLoraStack(自动跟随[80]选型)",
        "properties": {"Node name for S&R": "MyDaojieLoraStack"},
        "widgets_values": ["跟随底座型"] + [v for s in slots for v in (True, s.get("default_weight", 1.0))],
        "color": "#432", "bgcolor": "#653",
    })

    # ── 九行实链 ──
    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_GAP
        label = next(e for e in bases if e["zh"] == zh)
        ov = label.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{label['megapixels']}MP"
        aspect = label["aspect_ratio"].split(" (")[0]
        col = 0
        row_on = []

        for slot in slots:
            p = slot["presets"].get(zh, {})
            if not p.get("on"):
                continue
            x = START_X + LABEL_W + col * COL_GAP
            nid += 1
            c = slot_color(slot)
            title = f"{slot['label']} ×{p['weight']:g}"
            nodes.append({
                "id": nid, "type": "LoraLoaderModelOnly",
                "pos": [x, y], "size": [NODE_W, NODE_H],
                "flags": {}, "order": col + 1, "mode": 4,
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
                "title": title,
                "properties": {
                    "Node name for S&R": "LoraLoaderModelOnly",
                    "解说": f"{slot.get('group','')} | {slot.get('note','')[:80]}",
                },
                "widgets_values": [slot["file"], p["weight"]],
                "color": c["color"], "bgcolor": c["bgcolor"],
            })
            row_on.append(nid)
            col += 1

        # 行标签(型名+画幅,用 Note 节点)
        nid += 1
        nodes.append({
            "id": nid, "type": "MarkdownNote",
            "pos": [START_X, y], "size": [LABEL_W - 10, NODE_H],
            "flags": {}, "order": 0, "mode": 0,
            "title": "", "properties": {},
            "widgets_values": [f"### {zh}\n**{aspect}**\n{dims}"],
            "color": "#222", "bgcolor": "#333",
        })

        # 行组框
        row_w = LABEL_W + col * COL_GAP + 20
        groups.append({
            "title": zh, "bounding": [START_X - 10, y - 15, row_w, NODE_H + 30],
            "color": "#335533", "font_size": 18,
        })

    # 总组框
    groups.append({
        "title": "九型×LoRA 实链(视觉参考·mode=4·手拧实验切mode=0)",
        "bounding": [START_X - 20, START_Y - 30, total_w + 40, len(NINE) * ROW_GAP + 60],
        "color": "#335533", "font_size": 22,
    })

    subgraph = {
        "id": sid, "name": V3_NAME, "version": "0.35.0", "revision": 1,
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
        "widgets": ["跟随底座型"] + [v for s in slots for v in (True, s.get("default_weight", 1.0))],
        "links": [],
        "nodes": nodes,
    }
    defs.append(subgraph)

    # 主图 [90] 指向 v3
    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型驱动(双击=九行实链)"
    n90["properties"] = {"subgraph": sid}

    # 删 v2
    if v2:
        defs.remove(v2)

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_lora = sum(1 for n in nodes if n["type"] == "LoraLoaderModelOnly")
    print(f"v3 完成: uuid={sid}")
    print(f"  {total_lora} 个 LoRA 节点(240×110,列距{COL_GAP})")
    print(f"  色彩: 功能=蓝 面/细节=绿 画风=紫")
    print(f"  执行节点居中({exec_x},{exec_y})")
    print(f"  v2 已删")


if __name__ == "__main__":
    main()
