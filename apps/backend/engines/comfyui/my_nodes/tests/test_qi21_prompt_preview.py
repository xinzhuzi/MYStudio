# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""[401] MyQi21PromptPreview 形状契约(1007晚 布局手术随行锚)。

锁:正/负向=forceInput 纯槽(接线态零 widget 零隐藏占位——「多了个渲染
控件,布局不合理」根治)/显示位=唯一 optional multiline widget/required
恒空/出形状与 OUTPUT_NODE 不变/preview() 双 None 不断链。
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


def test_display_box_is_the_only_widget():
    t = MyQi21PromptPreview.INPUT_TYPES()
    assert t["required"] == {}, "required 应为空(正/负向转 optional 纯槽)"
    disp = t["optional"]["预览显示"][1]
    assert disp.get("multiline") is True, "预览显示应保持 multiline 显示位"
    assert not disp.get("forceInput"), "预览显示是 widget 不是槽"
    plain = [k for k in t["optional"] if "forceInput" not in t["optional"][k][1]]
    assert plain == ["预览显示"], f"全件唯一非 forceInput 输入=预览显示(widgets_values 单值位),得 {plain}"


def test_output_shape_and_output_node_unchanged():
    assert MyQi21PromptPreview.RETURN_TYPES == ("STRING",)
    assert MyQi21PromptPreview.RETURN_NAMES == ("合并预览",)
    assert MyQi21PromptPreview.OUTPUT_NODE is True


def test_preview_runs_with_none_inputs():
    r = MyQi21PromptPreview().preview()
    assert "═══ 正向提示词 ═══" in r["ui"]["merged"][0]
    assert r["result"] == (r["ui"]["merged"][0],)
