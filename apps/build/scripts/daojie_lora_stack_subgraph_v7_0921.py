#!/usr/bin/env python3
"""[90] 子图 v6:9 条真实 LoRA 线路(09-21 用户裁定:不要 MarkdownNote 摆样
+1 个黑盒执行节点;要 9 条线路的真实 lora 加载展示,可从外部接入)。

结构:
- 9 行(①人物…⑨概念气氛图),每行=该型真实 LoraLoaderModelOnly 横排串联
  (links 真实;title=件名×权重;widgets=[真实文件名,权重]);
  行首 model 入口/行尾 model 出口悬空=手动档接线桩;
- ▶执行·自动跟随[80] 保留右列=自动档(数据面,现行生图架构零变动);
- 行组带 id+标题(缺 id 只活第一个);无任何 MarkdownNote。
"""
import json, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json").read_text(encoding="utf-8"))
BASES = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json").read_text(encoding="utf-8"))
NAME = "LoRA栈·九型驱动"

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
CN = "①②③④⑤⑥⑦⑧⑨"

COL_GAP = 440          # loader 列距(节点宽340,线段100px清晰)
ROW_GAP = 190          # 行距(组高160+间30)
START_X, START_Y = 40, 40
EXEC_X, EXEC_W, EXEC_H = 2740, 400, 780

# 槽位配色(按件分组;node color 只是标题栏点缀)
C_FUNC, C_FACE, C_STYLE, C_MIST = "#335577", "#336633", "#663366", "#775533"
GROUP_C = {"功能件": C_FUNC, "面孔": C_FACE, "细节": C_FACE, "画风": C_STYLE, "水墨": C_MIST}


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == NAME), None)

    sid = str(uuid.uuid4())
    nodes, groups, links = [], [], []
    nid, lid = 100, 1

    max_cols = max(sum(1 for s in STACK if s["presets"].get(zh, {}).get("on")) for zh in NINE)
    matrix_w = max_cols * COL_GAP
    matrix_h = len(NINE) * ROW_GAP

    # ── 右列:▶执行(自动档,现行架构执行件;收起成小条不占视觉) ──
    nodes.append({
        "id": 1, "type": "MyDaojieLoraStack",
        "pos": [EXEC_X, START_Y], "size": [EXEC_W, EXEC_H],
        "flags": {"collapsed": True}, "order": 0, "mode": 0,
        "inputs": [{"name": "model", "type": "MODEL", "link": None},
                   {"name": "base", "type": "COMBO", "link": None}],
        "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
                    {"name": "applied", "type": "STRING", "links": [], "slot_index": 1}],
        "title": "▶自动档核心(主图[90]执行件·已收起勿删;展开=点节点)",
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

        first_id = None
        for col, slot in enumerate(STACK):
            p = slot["presets"].get(zh, {})
            if not p.get("on"):
                continue
            x = START_X + col * COL_GAP
            nid += 1
            me = nid
            is_first, is_last = first_id is None, False  # 末位标记稍后回填
            nodes.append({
                "id": me, "type": "LoraLoaderModelOnly",
                "pos": [x, y + 16], "size": [340, 100],
                "flags": {}, "order": col + 1, "mode": 0,
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0}],
                "title": f"{slot['label']} ×{p['weight']:g}",
                "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
                "widgets_values": [slot["file"], p["weight"]],
                "color": GROUP_C.get(slot.get("group", ""), C_STYLE),
            })
            if first_id is None:
                first_id = me
            else:
                # 行内串联:上一个 → 本节点(links 用 0.37 对象格式;数组格式被前端忽略)
                prev = nodes[-2]
                lid += 1
                prev["outputs"][0]["links"] = [lid]
                nodes[-1]["inputs"][0]["link"] = lid
                links.append({
                    "id": lid, "origin_id": prev["id"], "origin_slot": 0,
                    "target_id": me, "target_slot": 0, "type": "MODEL",
                })

        cols = sum(1 for s in STACK if s["presets"].get(zh, {}).get("on"))
        groups.append({
            "id": row + 1,
            "title": f"{CN[row]} {zh} · {aspect} · {dims}(行首进/行尾出=手动接线桩)",
            "bounding": [START_X - 8, y - 6, cols * COL_GAP - (COL_GAP - 340) + 26, 162],
            "color": "#2a3a2a", "font_size": 20,
        })

    groups.append({
        "id": 10,
        "title": "九型 × LoRA 线路矩阵(9条真实加载线;自动档=▶执行跟随[80];手动档=把model线改接任一行首尾)",
        "bounding": [START_X - 24, START_Y - 34, EXEC_X + EXEC_W - START_X + 48, matrix_h + 68],
        "color": "#335533", "font_size": 26,
    })

    defs.append({
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 3,
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
        "links": links, "nodes": nodes,
    })
    if old:
        defs.remove(old)

    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型驱动(双击=9条真实线路)"
    n90["properties"] = {"subgraph": sid}

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    loaders = sum(1 for n in nodes if n["type"] == "LoraLoaderModelOnly")
    print(f"v6: 9行真实线路共{loaders}个LoraLoaderModelOnly+{len(links)}条行内串联+▶自动档右列;MarkdownNote=0")


if __name__ == "__main__":
    main()
