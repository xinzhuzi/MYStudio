# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 画幅联动建议器(MyQi21WhSuggest,1001 S8 L1-2 造件)。

吞原 t2i 装配子图画幅联动链 8 件([151][152] 正则取比 + [153][154] 转数 +
[155][156] 4.2MP 公式 + [157][158] INT 开关)为一件 Python 化节点(任务
10-01-qi21-assembly-blueprint design §10.6 / implement.md S8 步骤 2;
prd.md R7.2「4.2MP/8倍取整算式 Python 化,公式逐字迁移」)。

公式真源=现工作流 `qi21-道劫-t2i.json` 子图 [155][156] widgets_values[0]
逐字(程序提取,禁手敲):
  [155]  round(a*sqrt(4.2*1024*1024/(a*b))/8)*8
  [156]  round(b*sqrt(4.2*1024*1024/(a*b))/8)*8
取比正则真源=同图 [151][152] widgets_values[1] 逐字:
  [151]  ^\\s*(\\d+)          (前段宽比)
  [152]  :\\s*(\\d+)\\s*$      (冒号后尾段高比,锚串尾)
round=Python 内建(银行家舍入),与原 ComfyMathExpression 插件同语义
(其内部即 Python eval),数值行为逐字等价。

Q6 容错(design §10.6,产线不炸队列):
  - wh_ratio 解析失败(非「宽:高」数字形,含 0 值比例/非字符串)且联动开
    → print 一条中文警告,回退 (九型WIDTH, 九型HEIGHT) 继续;
  - 九型槽未接线(缺键/None)且无建议值可用(解析失败,或联动关)
    → 中文报错(无值可用,不猜)。原工作流九型恒接线([150] 直连
    [157][158].on_false),联动关+未接线在画布上不可达,报错属节点级
    对称防御,非行为变更。

九型 W/H 槽不 lazy(轻值);wh_ratio 非 lazy([140] 若进执行图其
wh_ratio 附带产出,无额外代价)——两槽声明照蓝本,零 lazy 参数。

期望值锚(手验命令=implement.md S8 步骤 3,本会话实跑):
  16:9→(2800,1576) 1:1→(2096,2096) 9:16→(1576,2800)(≈4.2MP,
  8 倍数取整)。implement.md:67 期望清单①③的 (2560,1440)/(1440,2560)
  系誊写误——与其②(2096,2096,与公式一致)自身不自洽,且 implement.md:69
  手验命令实跑输出=2800 非 2560(2560×1440=3.69MP,系 3.52MP 口径);
  prd.md:36 / design.md:207 / 工作流 [155] 现值三方一致锚 4.2MP。
"""

from __future__ import annotations

import math
import re
from typing import Any

# 取比正则:原 [151][152] RegexExtract widgets_values[1] 逐字(工作流真源
# 程序提取;head 带 ^ 锚前导空白容忍,tail 锚串尾——「16:9 extra」类尾缀
# 污染按原节点同款判失败走 Q6 回退)。
_RATIO_HEAD_RE = re.compile(r"^\s*(\d+)")
_RATIO_TAIL_RE = re.compile(r":\s*(\d+)\s*$")


def _parse_ratio(wh_ratio: Any) -> tuple[int, int] | None:
    """wh_ratio → (宽比, 高比);非「宽:高」数字形/含 0 值 → None(走 Q6)。

    0 值比例(a*b=0)会使原公式除零,原链在 ComfyMathExpression 直接炸;
    Python 化按 Q6「产线不炸队列」精神归入解析失败回退(防御,行为面
    仅多一条中文警告)。
    """
    if not isinstance(wh_ratio, str):
        return None
    head = _RATIO_HEAD_RE.search(wh_ratio)
    tail = _RATIO_TAIL_RE.search(wh_ratio)
    if head is None or tail is None:
        return None
    a, b = int(head.group(1)), int(tail.group(1))
    if a <= 0 or b <= 0:
        return None
    return a, b


class MyQi21WhSuggest:
    """漫影 qi21 画幅联动:按 PE 宽高比给 4.2MP 档 8 倍数取整建议宽高。

    联动开关(宿主面板,默认关=恒九型)开且 wh_ratio 可解析 → 建议值
    (原 [155][156] 公式逐字);否则回九型 WIDTH/HEIGHT 原样(原
    [157][158] ComfySwitchNode on_false 臂)。解析失败回退时发一条中文
    警告;九型无值可用时中文报错,不猜不代选。
    """

    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            # 接线蓝图(design §10.6):wh_ratio←[140].wh_ratio;
            # 联动开关←子图输入口 -10 槽7(宿主面板「画幅联动」,默认关)
            "required": {
                "wh_ratio": ("STRING",),
                "联动开关": ("BOOLEAN", {"default": False}),
            },
            # 九型宽高←[150] MyQi21DaojieBase.WIDTH/HEIGHT(轻值不 lazy)
            "optional": {
                "九型WIDTH": ("INT",),
                "九型HEIGHT": ("INT",),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "suggest"

    def suggest(self, wh_ratio: Any, 联动开关: bool = False,
                九型WIDTH: int | None = None,
                九型HEIGHT: int | None = None) -> tuple[int, int]:
        ratio = _parse_ratio(wh_ratio)
        if not 联动开关 or ratio is None:
            if 联动开关:
                # Q6:想用建议值但解析失败 → 中文警告后回退(不炸队列)
                print(
                    f"[MyQi21WhSuggest] 画幅比例 wh_ratio={wh_ratio!r} 解析失败"
                    "(应为「宽:高」数字形,如 16:9),已回退九型宽高"
                    f"({九型WIDTH}×{九型HEIGHT})继续")
            if 九型WIDTH is None or 九型HEIGHT is None:
                raise ValueError(
                    f"[MyQi21WhSuggest] 画幅无值可用:wh_ratio={wh_ratio!r} "
                    "解析失败且九型 WIDTH/HEIGHT 槽未接线(至少其一无值)"
                    "——请把底座节点的 WIDTH/HEIGHT 连到本节点对应槽,"
                    "或修正 wh_ratio 为「宽:高」数字形;不猜不代选")
            return (九型WIDTH, 九型HEIGHT)

        # 4.2MP 联立 + 8 倍数取整:原 [155][156] widgets_values[0] 逐字
        #   [155] round(a*sqrt(4.2*1024*1024/(a*b))/8)*8
        #   [156] round(b*sqrt(4.2*1024*1024/(a*b))/8)*8
        a, b = ratio
        w = round(a * math.sqrt(4.2 * 1024 * 1024 / (a * b)) / 8) * 8
        h = round(b * math.sqrt(4.2 * 1024 * 1024 / (a * b)) / 8) * 8
        return (w, h)
