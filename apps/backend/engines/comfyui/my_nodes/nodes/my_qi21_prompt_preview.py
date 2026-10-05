# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 正负双预览节点(MyQi21PromptPreview,1005 用户令合成一个预览)。

取代此前 [401]正向 + [403]负向 两个 showAnything——用户令「合成1个节点」。
本件=单节点同时显示正向与负向终稿:

  [6].positive(正向出口) ──→ 本件.正向提示词 ──┐
                                              ├→ 合并显示(正向/负向分区)
  [6].negative(负向出口) ──→ 本件.负向提示词 ──┘

OUTPUT_NODE=True(执行根,渲染在 UI widget);两槽 optional(缺键=空串
不断链)。注册在 my_nodes/__init__.py。
"""

from __future__ import annotations
from typing import Any


class MyQi21PromptPreview:
    """漫影正负双预览:一个节点同时显示正向终稿与负向终稿。"""

    CATEGORY = "漫影"
    DESCRIPTION = "正负双预览(合成一个节点):正向终稿+负向终稿分区显示"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "正向提示词": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "正向终稿(主体句扩写+类型句+美术底座)"}),
                "负向提示词": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "负向终稿(类型负面+美术负面+主体句负面)"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("合并预览",)
    FUNCTION = "preview"
    OUTPUT_NODE = True

    def preview(self, 正向提示词: str | None = None,
                负向提示词: str | None = None) -> dict:
        """合并显示:正向在上,负向在下,分隔线隔开。

        1005 ㊈ 显示通道补路:此前返回裸元组,前端对 OUTPUT_NODE 的字符串返回
        不渲染=预览算了但看不见(输入连线又隐藏 multiline 框,节点体全空)。
        改 ui 载荷(ShowText|pysssss 同款机制)+web/my-qi21-prompt-preview.js
        onExecuted 落框,零改 ComfyUI 本体。
        """
        pos = (正向提示词 or "").strip()
        neg = (负向提示词 or "").strip()
        text = f"═══ 正向提示词 ═══\n{pos}"
        if neg:
            text += f"\n\n═══ 负向提示词 ═══\n{neg}"
        return {"ui": {"merged": [text]}, "result": (text,)}
