# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""分镜通用模板 9999 说明节点契约(1115 详情入 ComfyUI:写死文案退役)。

被测对象 = workflows/0_分镜/分镜工作流.json(分镜域唯一真源模板):
- 恒 7 环节锚点不破:MyStage×7(ids 1-7)+六条 MY_FLOW 链原样;
- 9999 MarkdownNote 在案(id=9999 唯一、无 inputs/outputs/零连线——
  不进执行图,不碰 widgets_values 序列化契约之外的任何链);
- last_node_id==9999(单镜.json 同款先例;LiteGraph 落库要求
  last_node_id 覆盖最大节点 id,App 克隆注入照旧);
- md 内容=五条速查文案(导航/节点按钮/分镜内容/正文滚动/进度与技能,
  stage-node.js 渲染器按图内 9999 md 直读,缺节点=优雅退化不浮卡)。

独立新件(避开存量 2 败的 test_my_nodes.py=已知红:注册表+道劫底座
3.0MP≠1.5MP,非本役引入)。
"""
from __future__ import annotations

import json
from pathlib import Path

_TEMPLATE = (Path(__file__).resolve().parents[2]
             / "workflows" / "0_分镜" / "分镜工作流.json")

# 五条速查锚(stage-node.js 9999 渲染器消费面;文案真源=模板 md 本体)
_HINT_ANCHORS = ("导航", "节点按钮", "分镜内容", "正文滚动", "进度与技能")


def _load() -> dict:
    return json.loads(_TEMPLATE.read_text(encoding="utf-8"))


def test_template_keeps_seven_stage_anchors():
    data = _load()
    stages = [n for n in data["nodes"] if n["type"] in ("MyStage", "ManyingStage")]
    assert sorted(n["id"] for n in stages) == [1, 2, 3, 4, 5, 6, 7]
    # 六条 MY_FLOW 链原样(1→2→7→3→4→5→6 环节链零断)
    flow_links = [l for l in data["links"] if l[5] == "MY_FLOW"]
    assert len(flow_links) == 6


def test_template_has_9999_markdown_note():
    data = _load()
    notes = [n for n in data["nodes"] if n["type"] == "MarkdownNote"]
    assert len(notes) == 1
    note = notes[0]
    assert note["id"] == 9999
    assert note["inputs"] == [] and note["outputs"] == []  # 零连线不进执行图
    # 无任何 link 引用 9999(链表 [id, origin_id, slot, target_id, slot, type])
    assert all(9999 not in (l[1], l[3]) for l in data["links"])
    # last_node_id 同步覆盖(LiteGraph 落库要求,单镜同款先例)
    assert data["last_node_id"] == 9999
    assert len(data["nodes"]) == 8  # 7 MyStage + 1 MarkdownNote


def test_template_note_md_carries_five_hints():
    note = next(n for n in _load()["nodes"] if n["type"] == "MarkdownNote")
    values = note["widgets_values"]
    md = values[0] if isinstance(values, list) else str(values)
    assert isinstance(md, str) and len(md) > 50
    for anchor in _HINT_ANCHORS:
        assert anchor in md, anchor
    # 1115 详情语义:文案须说「详情」为画布内浮层(旧「直达对应阶段页」退役)
    assert "画布内浮层" in md or "浮层" in md
