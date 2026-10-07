# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""[401] MyQi21PromptPreview 形状契约(1007深夜二轮 双框随行锚)。

锁:正/负向=forceInput 纯槽(接线态零 widget 零隐藏占位)/显示位=恰两只
optional multiline widget(「正向终稿」「负向终稿」——用户令「正负提示词都
传入了,但又多了个渲染控件」:单「预览显示」合并框退役,正/负各自成框)/
required 恒空/出形状与 OUTPUT_NODE 不变/preview() 分键 ui+双 None 不断链。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from engines.comfyui.my_nodes.nodes.my_qi21_prompt_preview import (
    MyQi21PromptPreview)


def test_positive_negative_are_forceinput_pure_slots():
    t = MyQi21PromptPreview.INPUT_TYPES()
    for name in ("正向提示词", "负向提示词"):
        spec = t["optional"][name][1]
        assert spec.get("forceInput") is True, f"{name} 应为 forceInput 纯槽"
        assert not spec.get("multiline"), f"{name} 纯槽不应带 multiline(widget 是接线态占位病灶)"


def test_display_boxes_are_exactly_two_widgets():
    t = MyQi21PromptPreview.INPUT_TYPES()
    assert t["required"] == {}, "required 应为空(正/负向转 optional 纯槽)"
    for name in ("正向终稿", "负向终稿"):
        spec = t["optional"][name][1]
        assert spec.get("multiline") is True, f"{name} 应保持 multiline 显示位"
        assert not spec.get("forceInput"), f"{name} 是 widget 不是槽"
    plain = [k for k in t["optional"] if "forceInput" not in t["optional"][k][1]]
    assert plain == ["正向终稿", "负向终稿"], \
        f"全件非 forceInput 输入应恰=双显示框(widgets_values 双值位),得 {plain}"
    assert "预览显示" not in t["optional"], \
        "单「预览显示」合并框已退役(1007深夜二轮 用户令「多了个渲染控件」)"


def test_output_shape_and_output_node_unchanged():
    assert MyQi21PromptPreview.RETURN_TYPES == ("STRING",)
    assert MyQi21PromptPreview.RETURN_NAMES == ("合并预览",)
    assert MyQi21PromptPreview.OUTPUT_NODE is True


def test_preview_emits_split_ui_keys():
    r = MyQi21PromptPreview().preview(正向提示词="甲行", 负向提示词="乙行")
    assert r["ui"]["positive"] == ["甲行"], "ui.positive 应为正向裸文(分区头属合并出口)"
    assert r["ui"]["negative"] == ["乙行"], "ui.negative 应为负向裸文"
    assert "merged" not in r["ui"], "ui.merged 随单合并框退役"
    assert r["result"] == ("═══ 正向提示词 ═══\n甲行\n\n═══ 负向提示词 ═══\n乙行",), \
        "「合并预览」STRING 出口仍喂合并文(下游语义不变)"


def test_preview_runs_with_none_inputs():
    r = MyQi21PromptPreview().preview()
    assert r["ui"]["positive"] == [""]
    assert r["ui"]["negative"] == [""]
