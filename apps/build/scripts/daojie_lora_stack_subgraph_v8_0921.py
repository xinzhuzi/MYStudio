#!/usr/bin/env python3
"""[90] 子图 v8:聚合节点退役(09-21 用户裁定:▶自动档不应再使用)。

架构变更:
- MyDaojieLoraStack 执行节点彻底移除;
- 9 行线路**串联成一条 model 主路**(行①首←子图输入,行⑨尾→子图输出,
  行内+行间全真实连线);
- 当前型行激活,其余 40 loader mode=4(mute 旁路=litegraph 原生直通,
  _resolve_src 16 层穿透既支持);换型=进子图切行 mute(右键 Bypass);
- 子图 outputs 删 applied(聚合产物);主图 [86]生效清单 摘除;
- UI 运行=前端官方摊平子图;脚本运行=ui_to_api 链式展开(v8 同步改造)。
"""
import json, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json").read_text(encoding="utf-8"))
BASES = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json").read_text(encoding="utf-8"))
NAME = "LoRA栈·九型驱动"
ACTIVE = "人物"   # 当前激活行(与 [80] 默认选型一致)

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
CN = "①②③④⑤⑥⑦⑧⑨"
COL_GAP, ROW_GAP = 440, 190
START_X, START_Y = 40, 40

C_FUNC, C_FACE, C_STYLE, C_MIST = "#335577", "#336633", "#663366", "#775533"
GROUP_C = {"功能件": C_FUNC, "面孔": C_FACE, "细节": C_FACE, "画风": C_STYLE, "水墨": C_MIST}


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == NAME), None)

    sid = str(uuid.uuid4())
    nodes, groups, links = [], [], []
    nid, lid = 100, 1
    prev_tail = None  # 上一行尾节点(行间串联)

    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_GAP
        base = next(e for e in BASES if e["zh"] == zh)
        ov = base.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{base['megapixels']}MP"
        aspect = base["aspect_ratio"].split(" (")[0]
        mode = 0 if zh == ACTIVE else 4

        first_id = None
        for col, slot in enumerate(STACK):
            p = slot["presets"].get(zh, {})
            if not p.get("on"):
                continue
            x = START_X + col * COL_GAP
            nid += 1
            me = nid
            nodes.append({
                "id": me, "type": "LoraLoaderModelOnly",
                "pos": [x, y + 16], "size": [340, 100],
                "flags": {}, "order": col + 1, "mode": mode,
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
                prev = nodes[-2]
                lid += 1
                prev["outputs"][0]["links"] = [lid]
                nodes[-1]["inputs"][0]["link"] = lid
                links.append({
                    "id": lid, "origin_id": prev["id"], "origin_slot": 0,
                    "target_id": me, "target_slot": 0, "type": "MODEL",
                })
        # 行间串联:上一行尾 → 本行首(全行串联成一条主路)
        if prev_tail is not None and first_id is not None:
            lid += 1
            prev_tail["outputs"][0]["links"] = (prev_tail["outputs"][0]["links"] or []) + [lid]
            head = next(n for n in nodes if n["id"] == first_id)
            head["inputs"][0]["link"] = lid
            links.append({
                "id": lid, "origin_id": prev_tail["id"], "origin_slot": 0,
                "target_id": first_id, "target_slot": 0, "type": "MODEL",
            })
        if first_id is not None:
            prev_tail = next(n for n in nodes if n["id"] == nodes[-1]["id"])

        cols = sum(1 for s in STACK if s["presets"].get(zh, {}).get("on"))
        state = "●当前型" if zh == ACTIVE else "旁路(切型=右键Toggle)"
        groups.append({
            "id": row + 1,
            "title": f"{CN[row]} {zh} · {aspect} · {dims} · {state}",
            "bounding": [START_X - 8, y - 6, cols * COL_GAP - (COL_GAP - 340) + 26, 162],
            "color": "#2a5a2a" if zh == ACTIVE else "#2a3a2a", "font_size": 20,
        })

    matrix_w = max(g["bounding"][2] for g in groups if g["id"] != 10) + 60
    matrix_h = len(NINE) * ROW_GAP
    groups.append({
        "id": 10,
        "title": f"九型 × LoRA 线路(串联主路·当前={ACTIVE}行激活,其余旁路直通;换型=子图内切行Bypass)",
        "bounding": [START_X - 24, START_Y - 34, matrix_w, matrix_h + 68],
        "color": "#335533", "font_size": 26,
    })

    defs.append({
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 4,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": groups,
        "inputNode": {"id": -10, "bounding": [START_X - 200, START_Y, 140, 48]},
        "outputNode": {"id": -20, "bounding": [START_X + matrix_w + 40, START_Y + matrix_h - 60, 140, 88]},
        "inputs": [
            {"name": "model", "type": "MODEL", "links": []},
            {"name": "base", "type": "COMBO", "type_data": [NINE], "links": [], "widget": False},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
        ],
        "widgets": [],
        "links": links, "nodes": nodes,
    })
    if old:
        defs.remove(old)

    # 主图:[90] 换新 uuid/清 widget;[86] 摘除;link 66 删
    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型线路(双击=9条真实加载线)"
    n90["properties"] = {"subgraph": sid}
    n90["widgets_values"] = []
    n90["outputs"] = [o for o in n90["outputs"] if o.get("name") == "model"]
    doc["nodes"] = [n for n in doc["nodes"] if n.get("id") != 86]
    doc["links"] = [l for l in doc.get("links", []) if l[0] != 66]
    # [86] 去除后 [12] 等其他连线不动;[90] applied 下游只有 [86](link66 已删)

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    active_cnt = sum(1 for n in nodes if n.get("mode") != 4)
    print(f"v8: 聚合节点退役;45 loader 串联主路({active_cnt} 激活={ACTIVE}行,40 旁路);[86]摘除")


if __name__ == "__main__":
    main()
