#!/usr/bin/env python3
"""Synchronize the persisted QI2.1 accelerator default across workflow and blueprint mirrors."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DEFAULT = "0 · Turbo 8步"
FILES = (
    ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
    ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
)


def set_mode(values: list | None) -> None:
    if not isinstance(values, list) or not values:
        raise ValueError("速度档位 widgets_values 缺失")
    values[0] = DEFAULT


def update(path: Path) -> None:
    raw = path.read_bytes()
    doc = json.loads(raw)
    host = next(node for node in doc["nodes"] if node.get("id") == 7)
    subgraph_id = host["properties"]["subgraph"]
    subgraph = next(sg for sg in doc["definitions"]["subgraphs"] if sg["id"] == subgraph_id)
    selector = next(node for node in subgraph["nodes"] if node.get("id") == 7015)
    if selector.get("type") != "MyQi21SpeedSelect":
        raise ValueError(f"{path}: [7015] 不是 MyQi21SpeedSelect")
    set_mode(host.get("widgets_values"))
    host.setdefault("widgets_values_named", {})["速度档位"] = DEFAULT
    set_mode(subgraph.get("widgets"))
    set_mode(selector.get("widgets_values"))
    selector.setdefault("widgets_values_named", {})["mode"] = DEFAULT
    for node in doc["nodes"]:
        if node.get("type") != "MarkdownNote":
            continue
        values = node.get("widgets_values")
        if isinstance(values, list) and values and isinstance(values[0], str):
            values[0] = values[0].replace("本件默认=「2 · viggle」", "本件默认=「0 · Turbo 8步」")
        named = node.get("widgets_values_named")
        if isinstance(named, dict) and isinstance(named.get("text"), str):
            named["text"] = named["text"].replace("本件默认=「2 · viggle」", "本件默认=「0 · Turbo 8步」")
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    if raw.endswith(b"\n"):
        text += "\n"
    temp = path.with_suffix(path.suffix + ".tmp-1016-default-turbo")
    temp.write_text(text, encoding="utf-8")
    temp.replace(path)
    print(path)


for workflow in FILES:
    update(workflow)
