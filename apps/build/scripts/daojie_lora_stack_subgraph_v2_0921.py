#!/usr/bin/env python3
"""[90] 子图 v2:九行实链+每件自带说明(09-21 用户裁定:Markdown Note 内容写进 LoRA 节点本身)。

替换 v1 的「执行节点+16块MarkdownNote」→ 九行 LoraLoaderModelOnly 实链:
- 每型一行,该型点亮的件按链序横排(标题=说明:干什么+权重)
- 未点亮的件不出现(该行只挂该型实际用的件)
- 执行仍走 MyDaojieLoraStack(代码选路),九行链全部 mode=4(视觉参考,手拧实验用)
- 每行首一块小Note只标型名+像素(行标签,非解说)
幂等:v2 已建则跳过。
"""
import json
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
BASES_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
V1_NAME = "LoRA栈·九型驱动(双击进入·执行+解说)"
V2_NAME = "LoRA栈·九型驱动(九行实链·每件自带说明)"

NINE = ["人物","场景","道具","美宣","三视图","高清人脸","分镜剧情图","表情差分","概念气氛图"]
ROW_H = 220      # 行间距
COL_W = 180      # 列间距
START_X = 40     # 首列x
START_Y = 60     # 首行y
NODE_W = 170     # 节点宽
NODE_H = 80      # 节点高


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    if any(s.get("name") == V2_NAME for s in defs):
        print("v2 已存在(幂等跳过)")
        return

    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    zh2key = {e["zh"]: e["key"] for e in bases}

    # 找到 v1 子图(拿 uuid 挂在 [90] 上),删除后用 v2 替代
    v1 = next((s for s in defs if s.get("name") == V1_NAME), None)
    old_sid = v1["id"] if v1 else None

    sid = str(uuid.uuid4())
    nodes = []
    nid = 100

    # 执行节点(紧凑放左下角)
    exec_node = {
        "id": 1, "type": "MyDaojieLoraStack", "pos": [START_X, START_Y + 9 * ROW_H + 60],
        "size": [320, 400], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "base", "type": "COMBO", "link": None},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "title": "[执行] MyDaojieLoraStack·自动跟随[80]选型",
        "properties": {"Node name for S&R": "MyDaojieLoraStack"},
        "widgets_values": ["跟随底座型"] + [v for s in slots for v in (True, s.get("default_weight", 1.0))],
    }
    nodes.append(exec_node)

    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_H
        col = 0
        # 行标签 Note(只标型名+像素)
        nid += 1
        label = next(e for e in bases if e["zh"] == zh)
        ov = label.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{label['megapixels']}MP"
        nodes.append({
            "id": nid, "type": "MarkdownNote", "pos": [START_X - 130, y],
            "size": [120, 60], "flags": {}, "order": 0, "mode": 0,
            "title": "", "properties": {},
            "widgets_values": [f"### {zh}\n{label['aspect_ratio'].split(' (')[0]} · {dims}"],
            "color": "#335533", "bgcolor": "#223322",
        })

        # 该型点亮的件
        for slot in slots:
            p = slot["presets"].get(zh, {})
            if not p.get("on"):
                continue
            x = START_X + col * COL_W
            nid += 1
            # 标题 = 说明(干什么+权重),来源=栈数据 note + group
            group = slot.get("group", "")
            note_short = slot.get("note", "")[:60]
            title = f"{slot['label']} ×{p['weight']:g}"
            # 详细说明写进 properties
            props_note = f"分组:{group} | {note_short}"
            nodes.append({
                "id": nid, "type": "LoraLoaderModelOnly",
                "pos": [x, y], "size": [NODE_W, NODE_H], "flags": {},
                "order": col + 1, "mode": 4,  # 视觉参考(旁路),手拧实验时切mode=0
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
                "title": title,
                "properties": {
                    "Node name for S&R": "LoraLoaderModelOnly",
                    "解说": props_note,
                },
                "widgets_values": [slot["file"], p["weight"]],
            })
            col += 1

    subgraph = {
        "id": sid, "name": V2_NAME, "version": "0.35.0", "revision": 1,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": [{"title": f"九型×LoRA 实链(视觉参考·执行走[1]MyDaojieLoraStack)", "bounding": [START_X - 140, START_Y - 20, 2600, 9 * ROW_H + 120], "color": "#335533", "font_size": 20}],
        "inputNode": {"id": -10, "bounding": [0, 40, 128, 48]},
        "outputNode": {"id": -20, "bounding": [2600, 40, 128, 88]},
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

    # 主图 [90]:换 uuid → v2
    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型驱动(双击=九行实链·每件自带说明)"
    n90["properties"] = {"subgraph": sid}

    # 删除 v1
    if v1:
        defs.remove(v1)

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_lora = sum(1 for n in nodes if n["type"] == "LoraLoaderModelOnly")
    print(f"v2 完成: uuid={sid}")
    print(f"九行实链共 {total_lora} 个 LoRA 节点(每件标题=说明+权重,解说在properties)")
    print(f"v1 已删除, [90] 已指向 v2")


if __name__ == "__main__":
    main()
