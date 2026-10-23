# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""FLUX.3 专用的道劫 RGB 提示词与画幅适配节点。

此节点只投影 Q2.1 型文中不能由 FLUX RGB 输出兑现的透明语义；共享型文、
Q2.1 节点和透明默认值均不修改。输出尺寸按 FLUX latent 的 16 像素网格对齐。
"""

from __future__ import annotations

from typing import Any

from ._qi21_rgba_text import strip_rgba_decl


_SETTING_CARD_RGBA = "卡面为带透明通道的透明底，各分区外无背景景物与底色。"
_SETTING_CARD_RGB = "卡面各分区共用简洁底色。"
_TOOL_RGBA = "透明底时主体以外为透明区域；关闭透明时背景采用主体句指定的简洁底色。"
_TOOL_RGB = "主体以外采用简洁底色。"
_RGBA_REMAINDERS = ("透明通道", "背景透明", "透明底", "透明区域")


class MyFlux3DaojieAdapter:
    """将道劫型文适配为 FLUX.3 的 RGB 提示词与 16px 尺寸。"""

    CATEGORY = "漫影/道劫"
    DESCRIPTION = "FLUX.3 RGB 适配：投影透明型文并将画幅对齐到 16 像素"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "BASE": ("STRING", {"forceInput": True}),
                "WIDTH": ("INT", {"forceInput": True, "min": 1}),
                "HEIGHT": ("INT", {"forceInput": True, "min": 1}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "BOOLEAN")
    RETURN_NAMES = ("BASE", "WIDTH", "HEIGHT", "透明模式")
    FUNCTION = "adapt"

    @staticmethod
    def _align16(value: int, name: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"{name} must be a positive integer")
        aligned = round(value / 16) * 16
        if aligned <= 0:
            raise ValueError(f"{name} rounds below one FLUX latent block")
        return aligned

    @staticmethod
    def _project_rgb(base: str) -> str:
        projected = (base or "").replace(_SETTING_CARD_RGBA, _SETTING_CARD_RGB)
        projected = projected.replace(_TOOL_RGBA, _TOOL_RGB)
        projected = strip_rgba_decl(projected)
        if any(marker in projected for marker in _RGBA_REMAINDERS):
            raise ValueError("FLUX.3 RGB adapter found unprojected transparency text")
        return projected

    def adapt(self, BASE: str, WIDTH: int, HEIGHT: int) -> tuple[str, int, int, bool]:
        return (
            self._project_rgb(str(BASE or "")),
            self._align16(WIDTH, "WIDTH"),
            self._align16(HEIGHT, "HEIGHT"),
            False,
        )
