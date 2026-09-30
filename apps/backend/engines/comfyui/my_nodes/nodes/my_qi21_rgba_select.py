# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 RGBA 透明开关(MyQi21RgbaSelect,0929 画布治理批 D6 造件)。

D6(任务 09-29-qi21-canvas-batch design §D6)型联动 RGBA 的三态选择件:
道具/多视图/高清人脸/表情差分四型默认开透明、其余五型默认关(prd 问题⑤
0929 用户拍板),同时保留用户随时手动开/关的操控权——纯 BOOLEAN 开关表达
不了「型默认+用户覆盖」双重要求,故退役旧「RGBA透明开关」布尔控件,由本
三态 combo 取代(宿主面板外露,subgraph-widget-promotion.md 已证 COMBO
外露可用)。

真值表(mode 首项=默认=跟随型):
  - 跟随型 → 透传 rgba_hint(四型接线时=True 开,五型=False 关);
  - 强制开 → 恒 True(不看 rgba_hint,手动权威);
  - 强制关 → 恒 False(同上)。

rgba_hint 真源链(单源,本件绝不自带四型名单——防名单第二真源漂移):
提取器 qi21_bases_extract_0923.py 内置四型常量 → qi21_bases.json
rgba_default 字段 → MyQi21DaojieBase.rgba_default 输出槽 → 本件 rgba_hint。
rgba_hint 为 optional:未接线(画布缺键)/未求值(None)一律视为 False
(跟随型无型可跟=保守关,与 0929 前全局默认关现状同向;强制开/关不依赖
它,裸件也能用)。加速启停=用户操控杆(0920 铁律)同款哲学:默认跟随仅
初始语义,用户改档不固化。

combo 闭集即契约:/prompt 闭集硬校验,不在列表即 HTTP 400——改三态文案
必须与接线生成器同笔(与 MyQi21SpeedSelect.SPEED_MODES 同纪律)。
"""

from __future__ import annotations

from typing import Any

# 三态表:combo 顺序即画布下拉顺序,首项=默认=跟随型(D6 钦定三串,零分隔
# 符零前导号——与 SPEED_MODES 的「0 · 直出40步」不同,本件三态是语义档非
# 编号档,design.md D6 原文照录)。
RGBA_MODES: tuple[str, ...] = ("跟随型", "强制开", "强制关")

MODES: list[str] = list(RGBA_MODES)
DEFAULT_MODE: str = MODES[0]


class MyQi21RgbaSelect:
    """漫影 qi21 RGBA 透明开关:三态决定透明布尔(默认跟随型=透传型信号)。

    mode=combo 三选一(首项默认):跟随型透传 rgba_hint;强制开恒 True;
    强制关恒 False。rgba_hint 未接线/None=保守关。手动权威(0920 操控杆
    先例):默认跟随仅初始语义,用户随时可强制开/关,不固化。
    """

    CATEGORY = "my"
    DESCRIPTION = ("透明开关三态选择:跟随型按型默认(四型开/五型关,"
                   "信号接 MyQi21DaojieBase.rgba_default);强制开/关=手动权威覆盖")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "mode": (MODES, {"default": DEFAULT_MODE,
                                 "tooltip": "跟随型=按底座型的默认透明(四型开,其余关);"
                                            "强制开/强制关=手动权威,不再随型变"}),
            },
            # optional:生产接线=MyQi21DaojieBase.rgba_default(S2 落地);裸件
            # (未接线)跟随型=保守关,强制两态完全不依赖它。
            "optional": {
                "rgba_hint": ("BOOLEAN", {"default": False,
                                          "tooltip": "型默认透明信号(接 MyQi21DaojieBase"
                                                     ".rgba_default;未接线视为关)"}),
            },
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("rgba_on",)
    FUNCTION = "decide"

    def decide(self, mode: str, rgba_hint: bool | None = None) -> tuple[bool, ...]:
        """三态分派:跟随型=bool(rgba_hint);强制开=True;强制关=False。"""
        if mode == "跟随型":
            return (bool(rgba_hint),)
        if mode == "强制开":
            return (True,)
        if mode == "强制关":
            return (False,)
        raise ValueError(
            f"未知透明开关档位:「{mode}」。可选档位:{' / '.join(MODES)}"
            "——请在画布重新选择档位下拉,或检查自研节点是否为旧版")
