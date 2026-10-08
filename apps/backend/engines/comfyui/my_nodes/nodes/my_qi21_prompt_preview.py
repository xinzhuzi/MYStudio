# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 正负双预览节点(MyQi21PromptPreview,1005 用户令合成一个预览)。

取代此前 [401]正向 + [403]负向 两个 showAnything——用户令「合成1个节点」。
本件=单节点分框显示正向与负向终稿:

  [6].positive(正向出口) ──→ 本件.正向提示词 ──→ 「正向终稿」框
  [6].negative(负向出口) ──→ 本件.负向提示词 ──→ 「负向终稿」框

OUTPUT_NODE=True(执行根,渲染在 UI widget);两槽 optional(缺键=空串
不断链)。注册在 my_nodes/__init__.py。

1007深夜二轮(用户令「正负提示词都传入了,但是又多了个渲染控件,布局也
不合理」):单「预览显示」合并框退役——正/负各自成框(「正向终稿」/
「负向终稿」),ui 载荷分键 positive/negative,前端按名落框;框数=2、
零多余控件,与件名「提示词预览(正向+负向)」字面一致。
"""

from __future__ import annotations
from typing import Any


class MyQi21PromptPreview:
    """漫影正负双预览:正、负终稿各一框分区显示。"""

    CATEGORY = "漫影"
    DESCRIPTION = "正负双预览(合成一个节点):正向终稿与负向终稿各一框"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {},
            # 1007晚 用户令「多了个渲染控件,布局也不合理」根治:正/负向改
            # forceInput 纯槽(带名连线点,零 widget)——multiline widget 在接线态
            # 会留两块隐藏占位空白,叠上显示框成三框堆叠,即布局病灶本体;本件
            # 双入恒接线(契约钉 link18/217),连线槽才是它的真实形状。optional
            # 非 required=未连线也能跑(preview() 收 None),[4013] 十入同款。
            "optional": {
                "正向提示词": ("STRING", {"forceInput": True}),
                "负向提示词": ("STRING", {"forceInput": True}),
                # 1007深夜二轮 用户令:双显示位=正/负各自成框(单「预览显示」
                # 合并框=「多余的渲染控件」退役)。显示位=py 端 optional
                # multiline(DOMWidgetImpl/comfy-multiline-input,全画布唯一被
                # 证实可靠的渲染路径,详优化集 OPTIMIZATION.md 布局④ 1b([401] py-DOM 同构破案全录))。前端 onExecuted 按 name
                # 把 ui.positive/ui.negative 分别写进本二框;纯显示位,无需手填。
                "正向终稿": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "正向终稿显示位(执行后自动刷新,无需手填/连线)"}),
                "负向终稿": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "负向终稿显示位(执行后自动刷新,无需手填/连线)"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("合并预览",)
    FUNCTION = "preview"
    OUTPUT_NODE = True

    def preview(self, 正向提示词: str | None = None,
                负向提示词: str | None = None,
                正向终稿: str | None = None,
                负向终稿: str | None = None) -> dict:
        """分框显示:正、负终稿各随其框(ui.positive/ui.negative 分键)。

        1005 ㊈ 显示通道补路:此前返回裸元组,前端对 OUTPUT_NODE 的字符串返回
        不渲染=预览算了但看不见。改 ui 载荷(ShowText|pysssss 同款机制)+
        web/my-qi21-prompt-preview.js onExecuted 落框,零改 ComfyUI 本体。
        1007深夜二轮:单 merged 键退役(正负同框=用户令多余控件),改分键;
        「合并预览」STRING 出口仍喂合并文(下游语义不变)。
        """
        pos = (正向提示词 or "").strip()
        neg = (负向提示词 or "").strip()
        text = f"═══ 正向提示词 ═══\n{pos}"
        if neg:
            text += f"\n\n═══ 负向提示词 ═══\n{neg}"
        return {"ui": {"positive": [pos], "negative": [neg]},
                "result": (text,)}
