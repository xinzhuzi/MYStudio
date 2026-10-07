# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 画幅定值件(MyQi21WhSuggest,1001 S8 L1-2 造件;1008 建议路清退)。

1001 造件时吞原 t2i 装配子图画幅联动链 8 件([151][152] 正则取比 + [153][154]
转数 + [155][156] 4.2MP 公式 + [157][158] INT 开关)Python 化为一件,含
「联动开关 × wh_ratio 建议(4.2MP 联立 + 8 倍取整)」路与 wh_ratio 懒执行
协议。1006 换装 API 版 PE([4013] MyQi21ApiPE)后 wh_ratio 出口撤销、画幅
走 AI/型宽高直通,建议路全链休眠;**1008 用户令清退无用件**——wh_ratio/
联动开关 两槽、懒协议、4.2MP 公式、取比正则、Q6 建议路容错全删(历史真源
=git 本文件旧版;[155][156] 公式原文=[155] round(a*sqrt(4.2*1024*1024/(a*b))/8)*8
/ [156] round(b*sqrt(4.2*1024*1024/(a*b))/8)*8,round=Python 内建银行家舍入)。

现役行为(1008 起,唯一消费方=qi21-道劫-t2i 主图 [4018]):
  - 手动宽/手动高(optional INT,default 0=跟型,step 8,max 8192)成对
    非 0 → 优先直出;
  - 否则九型WIDTH/九型HEIGHT 原样直通(现接线=[6] 子图 width/height 出口,
    源头 [4013] AI扩写透传 [4010] 型默认画幅);
  - 只填一个(一非 0 一 0)→ 中文报错(不猜不代选——半幅画幅无唯一合理解,
    替用户补 0 或取九型补另一边都是猜);
  - 九型槽未接线(缺键/None)且无手填 → 中文报错(无值可用,不猜)。

半填检测惰性(仅手动路被需要时判):残留半填值不该炸看不见的产线,手动路
被需要时才判才报。九型/手动槽均不 lazy(轻值,无懒钩子)。
"""

from __future__ import annotations

from typing import Any


class MyQi21WhSuggest:
    """漫影 qi21 画幅定值:手动宽高成对优先,否则九型/AI 宽高原样直通。

    1008 清退:联动开关 × wh_ratio 4.2MP 建议路随 1006 API-PE 换装休眠后
    整路删除;现役=手动成对优先 → 九型直通;半填/无值可用中文报错,
    不猜不代选。
    """

    CATEGORY = "漫影"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 1002 ⑭ 槽序:连线槽(九型WIDTH/九型HEIGHT)前置=节点顶部连线区,
        # 参数 widget(手动宽/手动高)下沉=节点下部——required 置空全住
        # optional(声明序即面板序;连线槽保「可不接」语义,widget 缺键=
        # 签名 default 兜底)。1008 清退 wh_ratio/联动开关 两槽。
        # 接线蓝图:九型宽高←[6] 宿主槽2/3(width/height 出口=[4013]
        # AI扩写透传 [4010] 型默认画幅)
        return {
            "required": {},
            "optional": {
                "九型WIDTH": ("INT", {"tooltip": "所选型自带的默认宽,连 [6] "
                                                 "子图 width 出口(AI 扩写"
                                                 "透传型默认画幅)"}),
                "九型HEIGHT": ("INT", {"tooltip": "所选型自带的默认高,连 [6] "
                                                  "子图 height 出口(AI 扩写"
                                                  "透传型默认画幅)"}),
                "手动宽": ("INT", {"default": 0, "min": 0, "max": 8192,
                                   "step": 8,
                                   "tooltip": "自己填的画布宽;0=跟所选型"
                                              "默认,要填就和手动高一起填"
                                              "(8 的倍数)"}),
                "手动高": ("INT", {"default": 0, "min": 0, "max": 8192,
                                   "step": 8,
                                   "tooltip": "自己填的画布高;0=跟所选型"
                                              "默认,要填就和手动宽一起填"
                                              "(8 的倍数)"}),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "suggest"

    def suggest(self, 九型WIDTH: int | None = None,
                九型HEIGHT: int | None = None,
                手动宽: int | None = None,
                手动高: int | None = None) -> tuple[int, int]:
        mw, mh = 手动宽 or 0, 手动高 or 0
        if (mw > 0) != (mh > 0):
            raise ValueError(
                f"[MyQi21WhSuggest] 手动宽高只填了一个(手动宽={mw} 手动高={mh}):"
                "画幅须宽高成对——要么两个都填(非 0),要么都留 0(=跟所选型"
                "默认画幅);不猜不代选(不会替你补 0 或拿九型补另一边)")
        if mw > 0 and mh > 0:
            return (mw, mh)
        if 九型WIDTH is None or 九型HEIGHT is None:
            raise ValueError(
                "[MyQi21WhSuggest] 画幅无值可用:手动宽高未填(0,0)且九型 "
                "WIDTH/HEIGHT 槽未接线(至少其一无值)——请填手动宽高成对值,"
                "或把 [6] 子图的 width/height 出口连到本节点对应槽;不猜不代选")
        return (九型WIDTH, 九型HEIGHT)
