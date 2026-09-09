# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""提示词节点:正/负 STRING 双出(09-09 核实点③落定:走 STRING 双出,
接 K2 模板 CLIPTextEncode.text——native 式样,Encode 留在模板侧)。"""

from __future__ import annotations


class ManyingPrompt:
    CATEGORY = "manying"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": ("STRING", {"multiline": True, "default": "", "placeholder": "正向提示词"}),
                "negative": ("STRING", {"multiline": True, "default": "", "placeholder": "反向提示词"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "run"

    def run(self, positive, negative):
        return (positive or "", negative or "")
