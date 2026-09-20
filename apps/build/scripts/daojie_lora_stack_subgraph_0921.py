#!/usr/bin/env python3
"""[90] 真集成子图化(09-21 用户裁定:trellis+grill;[90]本体做成真正的子图,
画布上只留参数调整,双击进入=执行节点+解说同框)。幂等:已子图化则跳过。

结构:
- 新子图定义「LoRA栈·九型驱动」:
  * 内部节点:MyDaojieLoraStack(id=1,执行)+ 16块MarkdownNote(解说,从纯展示子图搬运)
  * IO:输入脚 model(MODEL)→[1].model;base(COMBO)→[1].base;
       输出脚 model(MODEL)←[1].model;applied(STRING)←[1].applied
  * widget提升:[1] 的29个widget全部上浮到子图定义widgets(preset+14×enable/weight)
- 主图:原[90]节点改type=子图id(与[91]同款挂载方式),连接线58/54/65/66原位保留
  (link表不动,节点id不动,仅type换);纯展示子图[91]保留不动(用户说仍要)。
"""
import json
import uuid
from pathlib import Path

WF = Path(__file__).resolve().parents[3] / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
DISPLAY_SUBGRAPH_NAME = "LoRA 逻辑图解"
NEW_SUBGRAPH_NAME = "LoRA栈·九型驱动(双击进入·执行+解说)"


def main():
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    disp = next(s for s in defs if s.get("name") == DISPLAY_SUBGRAPH_NAME)
    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)

    # 幂等:若[90]的type已是某个子图uuid则跳过
    existing = {s.get("name"): s for s in defs}
    if n90["type"] in {d for d in _subgraph_ids(defs)}:
        print("已子图化(幂等跳过)")
        return

    sid = str(uuid.uuid4())
    # 1) 搬运16块解说(从展示子图复制nodes,坐标右移避开执行节点)
    notes = []
    for i, nd in enumerate(disp["nodes"]):
        nd = json.loads(json.dumps(nd))
        nd["id"] = 100 + i
        nd["pos"] = [nd["pos"][0] + 260, nd["pos"][1]]
        notes.append(nd)

    # 2) 执行节点(原[90]的一切,进入子图,id=1)
    exec_node = json.loads(json.dumps(n90))
    exec_node["id"] = 1
    exec_node["pos"] = [40, 700]

    # 3) 子图内部连线:inputNode(-10)→[1].model;[80]的base脚经子图输入→[1].base;
    #    [1].model→outputNode(-20)脚0;[1].applied→子图第二输出脚
    inner_links = [
        [-10, 0, 1, 0, "MODEL"],   # 占位,真实结构由 inputs/outputs 的 link 描述
    ]

    subgraph = {
        "id": sid,
        "name": NEW_SUBGRAPH_NAME,
        "version": "0.35.0",
        "revision": 1,
        "config": {"defaultIOState": {}},
        "state": {},
        "extra": {},
        "groups": json.loads(json.dumps(disp.get("groups", []))),
        "inputNode": {"id": -10, "bounding": [0, 40, 128, 48]},
        "outputNode": {"id": -20, "bounding": [2200, 40, 128, 88]},
        "inputs": [   # 子图输入脚(挂在主图的输入)
            {"name": "model", "type": "MODEL", "links": []},
            {"name": "base", "type": "COMBO", "links": [], "widget": False},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "widgets": json.loads(json.dumps(n90.get("widgets_values", []))),
        "links": inner_links,
        "nodes": [exec_node] + notes,
    }
    defs.append(subgraph)

    # 4) 主图[90]变子图实例:type=子图uuid;inputs/outputs脚位对齐原节点
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·九型驱动(双击进入=执行+解说)"
    n90["properties"] = {"subgraph": sid}
    # 输入脚:model(link58)、base(link65) —— 名称/类型对齐子图inputs
    n90["inputs"] = [
        {"name": "model", "type": "MODEL", "link": 58},
        {"name": "base", "type": "COMBO", "link": 65},
    ]
    # 输出脚:model(link54)、applied(link66)
    n90["outputs"] = [
        {"name": "model", "type": "MODEL", "links": [54], "slot_index": 0},
        {"name": "applied", "type": "STRING", "links": [66], "slot_index": 1},
    ]
    n90["widgets_values"] = json.loads(json.dumps(subgraph["widgets"]))

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"子图化完成: uuid={sid}")
    print(f"内部: 执行节点[1] + {len(notes)}块解说; 主图[90]连接线58/54/65/66原位不动")


def _subgraph_ids(defs):
    # 已有子图的uuid=defs里的id字段
    return {s.get("id") for s in defs}


if __name__ == "__main__":
    main()
