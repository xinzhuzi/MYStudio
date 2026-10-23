# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 布尔分支节点(MyQi21BoolBranch,1005 用户令「true出一条线 false出一条线」)。

PrimitiveBoolean 只有一根 BOOLEAN 输出,用户看不出 true/false 走哪条路。
本件=一分二:true路+false路 两根线各走各的,视觉上清晰分支:

  [4012] PE开关 .BOOLEAN ──→ 本件.value
                             ├→ true路(=原值)  → [4021].pe开关 + [4014].pe开关
                             └→ false路(=取反)  → 视觉指示(或接直写路标记)

**1005 ㊄ 已退役**:终态设计=[4012] MyQi21PESwitch 自带 true路/false路
双 BOOLEAN 出线,本件双出职能被其内建取代;当前零工作流引用(仅注册+花名册
测试在档)。留档不删=回滚杠杆(同 MyQi21ChinesePE 待遇);新管线勿再接线。

纯透传节点,零逻辑改动(下游仍按原值判断);只是让布线视觉上有两条路。
"""

from __future__ import annotations
from typing import Any


class MyQi21BoolBranch:
    """布尔分支:true路+false路 双出(视觉分支,纯透传)。"""

    CATEGORY = "漫影"
    DESCRIPTION = "布尔分支:true路(原值)+false路(取反) 双线输出"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "value": ("BOOLEAN", {"default": True,
                                       "tooltip": "布尔输入(如 PE开关)"}),
            },
        }

    RETURN_TYPES = ("BOOLEAN", "BOOLEAN")
    RETURN_NAMES = ("true路", "false路")
    FUNCTION = "branch"
    OUTPUT_NODE = False

    def branch(self, value: bool) -> tuple[bool, bool]:
        """true路=原值;false路=取反。"""
        return (bool(value), not bool(value))
