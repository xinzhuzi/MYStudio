# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 PE 开关路由件(MyQi21PESwitch,1005 用户令)。

主体句从边界直入本件(不再直连 [4013] PE),pe开关决定路由:
  true  → PE路主体句=原文(喂PE组),直写路主体句=空
  false → PE路主体句=空(PE组零消费零执行),直写路主体句=原文

下游 [4021] SubjectSelect 的懒协议保持不变:
  PE开时 [4021] 请求 PE出文+PE宽高比 → [4013] 执行 → [4019] 加载
  PE关时 [4021] 不请求 → [4013] 零消费者零执行 → [4019] 零加载
"""

from __future__ import annotations
from typing import Any


class MyQi21PESwitch:
    """PE 开关路由:主体句进,按开关分路到 PE 组/直写路。"""

    CATEGORY = "漫影"
    DESCRIPTION = "PE开关路由:主体句进→true走PE组/false直写(懒执行零浪费)"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "主体句": ("STRING", {
                    "forceInput": True,
                    "tooltip": "画面里画什么的描述;连子图入口「主体句」"
                               "(1005 ㊇ forceInput 纯槽:multiline widget 会被"
                               "前端提升到宿主=连线后裸点无标签;纯槽才渲染"
                               "带名字连线点)"}),
                "pe开关": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "true=走PE扩写(英文长文)/false=原句直拼(中文三层)"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "BOOLEAN", "BOOLEAN")
    RETURN_NAMES = ("PE路主体句", "直写路主体句", "true路", "false路")
    FUNCTION = "route"
    OUTPUT_NODE = False

    def route(self, 主体句: str, pe开关: bool) -> tuple[str, str, bool, bool]:
        """true→PE路=原文+直写=空;false→PE路=空+直写=原文。"""
        text = (主体句 or "").strip()
        if pe开关:
            return (text, "", True, False)
        return ("", text, False, True)
