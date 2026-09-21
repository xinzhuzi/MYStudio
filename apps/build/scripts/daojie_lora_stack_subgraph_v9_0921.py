#!/usr/bin/env python3
"""[90] 子图 v9:按型分流(09-21 用户裁定:根据类型进入不同线路再出去,不是融合串联)。

结构(inputNode=-10:槽0=model 槽1=base;outputNode=-20:槽0=model 槽1=applied):
  -10.model ─┬─→ 行①首→…→行①尾 ─→ Route.人物 ─┐
             ├─→ 行②首→…→行②尾 ─→ Route.场景  │
             ├─→ …(9 行并联,各自真实链)       ├→ Route ─→ -20.model
             └─→ 行⑨首→…→行⑨尾 ─→ Route.概念气氛图
  -10.base([80] 选型) ─────────────────→ Route.base
  Route.applied ─→ -20.applied(主图 [86] 生效清单恢复)
Route=自研 MyDaojieRoute(选线不加载);9 行全部真实可见可改。
"""
import json, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json").read_text(encoding="utf-8"))
BASES = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json").read_text(encoding="utf-8"))
NAME = "LoRA栈·九型驱动"
ACTIVE = "人物"

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
CN = "①②③④⑤⑥⑦⑧⑨"
COL_GAP, ROW_GAP = 440, 190
START_X, START_Y = 40, 40
ROUTE_ID = 1

C_FUNC, C_FACE, C_STYLE, C_MIST = "#335577", "#336633", "#663366", "#775533"
GROUP_C = {"功能件": C_FUNC, "面孔": C_FACE, "细节": C_FACE, "画风": C_STYLE, "水墨": C_MIST}


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == NAME), None)

    sid = str(uuid.uuid4())
    nodes, groups, links = [], [], []
    nid, lid = 100, 1
    row_tails = {}   # zh -> 行尾节点引用

    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_GAP
        base = next(e for e in BASES if e["zh"] == zh)
        ov = base.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{base['megapixels']}MP"
        aspect = base["aspect_ratio"].split(" (")[0]

        first = None
        for col, slot in enumerate(STACK):
            p = slot["presets"].get(zh, {})
            if not p.get("on"):
                continue
            nid += 1
            nodes.append({
                "id": nid, "type": "LoraLoaderModelOnly",
                "pos": [START_X + col * COL_GAP, y + 16], "size": [340, 100],
                "flags": {}, "order": col + 1, "mode": 0,
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0}],
                "title": f"{slot['label']} ×{p['weight']:g}",
                "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
                "widgets_values": [slot["file"], p["weight"]],
                "color": GROUP_C.get(slot.get("group", ""), C_STYLE),
            })
            if first is None:
                first = nodes[-1]
                # 行首 ← inputNode(-10).model(槽0)
                lid += 1
                first["inputs"][0]["link"] = lid
                links.append({"id": lid, "origin_id": -10, "origin_slot": 0,
                              "target_id": first["id"], "target_slot": 0, "type": "MODEL"})
            else:
                prev = nodes[-2]
                lid += 1
                prev["outputs"][0]["links"] = [lid]
                nodes[-1]["inputs"][0]["link"] = lid
                links.append({"id": lid, "origin_id": prev["id"], "origin_slot": 0,
                              "target_id": nid, "target_slot": 0, "type": "MODEL"})
        row_tails[zh] = nodes[-1]

        cols = sum(1 for s in STACK if s["presets"].get(zh, {}).get("on"))
        groups.append({
            "id": row + 1,
            "title": f"{CN[row]} {zh} · {aspect} · {dims}",
            "bounding": [START_X - 8, y - 6, cols * COL_GAP - (COL_GAP - 340) + 26, 162],
            "color": "#2a5a2a" if zh == ACTIVE else "#2a3a2a", "font_size": 20,
        })

    # Route 汇聚节点(右侧中部)
    matrix_h = len(NINE) * ROW_GAP
    matrix_w = max(g["bounding"][2] for g in groups if g["id"] != 10) + 60
    route_in = [{"name": "base", "type": "COMBO", "link": None}] + \
               [{"name": zh, "type": "MODEL", "link": None} for zh in NINE]
    nodes.append({
        "id": ROUTE_ID, "type": "MyDaojieRoute",
        "pos": [START_X + matrix_w + 60, START_Y + (matrix_h - 260) // 2], "size": [300, 260],
        "flags": {}, "order": 99, "mode": 0,
        "inputs": route_in,
        "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
                    {"name": "applied", "type": "STRING", "links": [], "slot_index": 1}],
        "title": "按型选线·跟随[80](base=型,九槽=九线尾)",
        "properties": {"Node name for S&R": "MyDaojieRoute"},
        "widgets_values": [ACTIVE],
        "color": "#432", "bgcolor": "#653",
    })
    # base ← inputNode(-10) 槽1
    lid += 1
    nodes[-1]["inputs"][0]["link"] = lid
    links.append({"id": lid, "origin_id": -10, "origin_slot": 1,
                  "target_id": ROUTE_ID, "target_slot": 0, "type": "COMBO"})
    # 九行尾 → Route 对应槽(槽序:base=0, 人物=1, 场景=2, …)
    for i, zh in enumerate(NINE):
        lid += 1
        tail = row_tails[zh]
        tail["outputs"][0]["links"] = (tail["outputs"][0]["links"] or []) + [lid]
        links.append({"id": lid, "origin_id": tail["id"], "origin_slot": 0,
                      "target_id": ROUTE_ID, "target_slot": i + 1, "type": "MODEL"})
    # Route.model → outputNode(-20) 槽0;applied → -20 槽1
    lid += 1
    nodes[-1]["outputs"][0]["links"] = [lid]
    links.append({"id": lid, "origin_id": ROUTE_ID, "origin_slot": 0,
                  "target_id": -20, "target_slot": 0, "type": "MODEL"})
    lid += 1
    nodes[-1]["outputs"][1]["links"] = [lid]
    links.append({"id": lid, "origin_id": ROUTE_ID, "origin_slot": 1,
                  "target_id": -20, "target_slot": 1, "type": "STRING"})

    groups.append({
        "id": 10,
        "title": "九型 × LoRA 线路(9条真实加载线并联;[80]选型→按型进入对应线路→汇出)",
        "bounding": [START_X - 24, START_Y - 34, matrix_w + 420, matrix_h + 68],
        "color": "#335533", "font_size": 26,
    })

    defs.append({
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 5,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": groups,
        "inputNode": {"id": -10, "bounding": [START_X - 220, START_Y + 60, 150, 200]},
        "outputNode": {"id": -20, "bounding": [START_X + matrix_w + 440, START_Y + (matrix_h - 200) // 2, 150, 200]},
        "inputs": [
            {"name": "model", "type": "MODEL", "links": []},
            {"name": "base", "type": "COMBO", "type_data": [NINE], "links": [], "widget": False},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "widgets": [ACTIVE],
        "links": links, "nodes": nodes,
    })
    if old:
        defs.remove(old)

    # 主图:[90] outputs 恢复 model+applied;[86] 生效清单恢复
    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·按型分流线路(双击=9条真实加载线)"
    n90["properties"] = {"subgraph": sid}
    n90["widgets_values"] = [ACTIVE]
    n90["outputs"] = [
        {"name": "model", "type": "MODEL", "links": [54], "slot_index": 0},
        {"name": "applied", "type": "STRING", "links": [66], "slot_index": 1},
    ]
    if not any(n.get("id") == 86 for n in doc["nodes"]):
        doc["nodes"].append({
            "id": 86, "type": "easy showAnything",
            "pos": [1240, 1100], "size": [480, 200],
            "flags": {}, "order": 0, "mode": 0,
            "inputs": [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 66}],
            "outputs": [{"name": "output", "type": "*", "links": None}],
            "title": "[86] 按型线路生效披露", "properties": {"Node name for S&R": "easy showAnything"},
            "widgets_values": ["(待运行)"],
        })
    doc["links"] = [l for l in doc.get("links", []) if l[0] != 66]
    doc["links"].append([66, 90, 1, 86, 0, "*"])

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"v9: 9行并联(各{sum(1 for s in STACK if s['presets'].get(ACTIVE,{}).get('on'))}~件)+Route按型选线+-10/-20真连线;[86]恢复")


if __name__ == "__main__":
    main()
