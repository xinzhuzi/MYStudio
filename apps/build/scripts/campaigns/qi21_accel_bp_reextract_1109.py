#!/usr/bin/env python3
"""1109 蓝图重抽(独立通道,不走 1016 手术脚本)。

原因:1016 脚本的 ensure_fix_turbo_route 拒绝 7034(mikkoani)上游——1016 写于
并行役 mikkoani/HQ 链(1108-09)之前。本脚本跳过手术/验锚段,纯抽取当前子图
→ 三蓝图同步(与 _extract_blueprint 同构:根节点+子图深拷贝+canonical 序列化)。
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BP_DIR = ROOT / "apps/backend/comfyui/my_nodes/subgraphs"
CASES = [
    ("t2i", ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
     BP_DIR / "qi21-道劫-加速子图.json", "道劫·加速子图(t2i)"),
    ("i2i", ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
     BP_DIR / "qi21-道劫-加速子图-i2i.json", "道劫·加速子图(i2i)"),
    ("edit", ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
     BP_DIR / "qi21-道劫-加速子图-edit.json", "道劫·加速子图(edit)"),
]


def _sg_of(doc: dict):
    for sg in doc.get("definitions", {}).get("subgraphs", []):
        if "加速" in sg.get("name", ""):
            host = next((n for n in doc["nodes"] if n.get("properties", {}).get("subgraph") == sg.get("id")), None)
            return host, sg
    raise SystemExit("找不到加速子图")


def extract(tag: str, doc: dict, bp_name: str) -> dict:
    host, sg = _sg_of(doc)
    sg_uuid = host["properties"]["subgraph"]
    root_in = []
    for i in sg["inputs"]:
        ent: dict = {"name": i["name"], "type": i["type"]}
        if i["type"] in ("COMBO", "INT", "STRING", "FLOAT", "BOOLEAN"):
            ent["widget"] = {"name": i["name"]}
        ent["link"] = None
        root_in.append(ent)
    root_out = [{"name": o["name"], "type": o["type"], "links": []} for o in sg["outputs"]]
    root_node = {"id": 1, "type": sg_uuid, "pos": [0, 0], "size": [560, 520],
                 "flags": {}, "order": 0, "mode": 0,
                 "properties": {"subgraph": sg_uuid, "previewExposures": []},
                 "inputs": root_in, "outputs": root_out,
                 "widgets_values": copy.deepcopy(host.get("widgets_values")),
                 "title": host.get("title"),
                 "widgets_values_named": copy.deepcopy(host.get("widgets_values_named", {}))}
    sg_def = copy.deepcopy(sg)
    sg_def["category"] = "漫影"
    return {"revision": 1, "last_node_id": 1, "last_link_id": 0,
            "nodes": [root_node], "links": [], "version": 0.4,
            "info": {"category": "漫影", "name": bp_name},
            "definitions": {"subgraphs": [sg_def]}}


def main() -> int:
    for tag, wf, bp_path, bp_name in CASES:
        doc = json.loads(wf.read_text(encoding="utf-8"))
        bp = extract(tag, doc, bp_name)
        tmp = bp_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(bp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(bp_path)
        print(f"[{tag}] 蓝图重抽 → {bp_path.name}")
    print("三蓝图同步毕(独立通道,跳过 1016 手术验锚)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
