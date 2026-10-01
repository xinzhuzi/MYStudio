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
(其内部为 simpleeval 求值器,round/sqrt 直通 Python 内建,本式数值
逐字等价;非 Python eval——勿按 eval 语义类推他式,如 ** 大指数在
simpleeval 有 safe_power/MAX_EXPONENT=4000 封顶差异)。

Q6 容错(design §10.6,产线不炸队列):
  - wh_ratio 解析失败(非「宽:高」数字形,含 0 值比例/非字符串)且联动开
    → print 一条中文警告,回退 (九型WIDTH, 九型HEIGHT) 继续;
  - 极端比例(宽高比 > 约 275251:1)建议值 8 倍取整后 w/h 含 0 且联动开
    → 同款中文警告后回退九型原样(S8 深审 L-5 计算侧防御,实测首现
    275252:1→(1101008,0);原链 [155][156] 同式直出 0,此处纯收紧,
    下游空潜在不炸);
  - 联动开而 wh_ratio 未接线(缺键,wh_ratio lazy 化后新增的可达态)
    → 中文报错(想要建议值但没有源,不猜不代选;修前该槽为必填,未接线
    由引擎验证层直接拒,语义同为拒绝、报错面从验证层挪进节点);
  - 九型槽未接线(缺键/None)且无建议值可用(解析失败,或联动关)
    → 中文报错(无值可用,不猜)。原工作流九型恒接线([150] 直连
    [157][158].on_false),联动关+未接线在画布上不可达,报错属节点级
    对称防御,非行为变更。

懒执行协议(1001 深审修复轮,SpeedSelect 实名协议同款;修前实弹证违在档
apps/output/s8-integration-1001/s8-integration-report.json lazyVerdict=VIOLATED,
根因=wh_ratio 曾为非懒必填槽,link25←[140].wh_ratio 强链恒拉 [140] 进执行图
→pe 关仍整跑 PE 改写+装载 9B PE TE):
  - wh_ratio 槽 lazy+optional:联动开关=关(默认)时 check_lazy_status 返回
    空名单→不请求 wh_ratio→[140] 无强消费者(另一消费者 [152].PE出文 同
    lazy,pe 关亦不请求)→**[140] 零执行零 PE TE 装载**(prd R7.1 懒执行
    硬约束就此成立,成立条件=pe开关关×联动开关关);
  - **边界如实注**:联动开关=开时仍请求 wh_ratio→[140] 进执行图(建议值
    语义需要其 wh_ratio 输出;此时即便 pe 关,PE 改写随件整体执行+装载
    PE TE——建议路依赖 PE 件产出的既有语义,非回归);
  - 联动开而 wh_ratio 未接线(缺键)→绝不请求(引擎对未接线槽
    make_input_strong_link 抛 NodeInputError,graph.py:132-133),由
    suggest 给中文报错(想用建议值但没接源,不猜不代选)。

九型 W/H 槽不 lazy(轻值,[150] 常驻执行图)。

手动宽高槽(1001 用户测试批 P1,design §2.3;问题②画幅规则重构的件侧
扩展——「画幅联动开关」语义由工作流侧改接 PE 开关扇出,件零改名):
  - optional 手动宽/手动高(INT,default 0=跟型,step 8,max 8192)——
    i2i/edit 不接新槽(缺键)→ 手填恒 0 → 永走九型=旧行为逐字节不变
    (向后兼容铁律);
  - 回退序(非建议路=联动关/解析失败/极端回退):手填非 0 **成对**优先
    → 九型;只填一个(一非 0 一 0)→ 中文报错(不猜不代选——半幅画幅
    无唯一合理解,替用户补 0 或取九型补另一边都是猜);
  - 半填检测惰性(仅回退到手动路时判):PE 开时手填控件被 web 扩展隐藏,
    残留半填值不该炸看不见的产线;手动路被需要时才判才报;
  - 手动槽不 lazy(轻值 INT,同九型槽口径;不参与 check_lazy_status)。

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
    (原 [155][156] 公式逐字);否则(联动关/解析失败/极端比例建议值
    含 0)回九型 WIDTH/HEIGHT 原样(原 [157][158] ComfySwitchNode
    on_false 臂)。联动开的回退(解析失败/建议值含 0)发一条中文警
    告;九型无值可用时中文报错,不猜不代选。
    """

    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            # 接线蓝图(design §10.6):wh_ratio←[140].wh_ratio;
            # 联动开关←子图输入口 -10 槽7(宿主面板「画幅联动」,默认关)
            # wh_ratio lazy+optional(1001 深审修复轮):联动关时不请求
            # →[140] 零执行零 PE TE 装载(见模块 docstring 懒执行协议)
            "required": {
                "联动开关": ("BOOLEAN", {"default": False}),
            },
            # 九型宽高←[150] MyQi21DaojieBase.WIDTH/HEIGHT(轻值不 lazy);
            # wh_ratio lazy:pe关×联动关=[140] 不进执行图(修前恒进=证违根因);
            # 手动宽/手动高(1001 用户测试批 P1,design §2.3):default 0=跟型,
            # 非 0 成对=手填优先(i2i/edit 不接=恒 0=旧行为;不 lazy,轻值同九型槽)
            "optional": {
                "wh_ratio": ("STRING", {"lazy": True}),
                "九型WIDTH": ("INT",),
                "九型HEIGHT": ("INT",),
                "手动宽": ("INT", {"default": 0, "min": 0, "max": 8192,
                                   "step": 8}),
                "手动高": ("INT", {"default": 0, "min": 0, "max": 8192,
                                   "step": 8}),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "suggest"

    def check_lazy_status(self, 联动开关: bool | None = None,
                          **kwargs: Any) -> list[str] | None:
        """只请求「联动开×wh_ratio 已接线×尚未求值」的槽,其余一律不请求。

        执行器以 kwargs 投递当前输入(经典节点,execution.py:511):缺键=该槽
        未接线(optional 不投递)→绝不请求(请求未接线槽引擎抛
        NodeInputError);None=已接线未求值→请求;有值=已求值→放行。联动关时
        即便 wh_ratio 已接线未求值也不请求([140] 无人消费→不进执行图)。
        """
        if not 联动开关:
            return []
        if "wh_ratio" in kwargs and kwargs["wh_ratio"] is None:
            return ["wh_ratio"]
        return []

    def suggest(self, 联动开关: bool = False, wh_ratio: Any = None,
                九型WIDTH: int | None = None,
                九型HEIGHT: int | None = None,
                手动宽: int | None = None,
                手动高: int | None = None) -> tuple[int, int]:
        if 联动开关 and wh_ratio is None:
            # 联动开但 wh_ratio 未接线(区别于解析失败):想要建议值却没有
            # 源,中文报错不猜不代选(check_lazy_status 对未接线槽不请求,
            # 引擎不会替我们拉值,本分支=用户手动删线场景的对称防御)
            raise ValueError(
                "[MyQi21WhSuggest] 联动开关已开但 wh_ratio 输入未接线:建议路"
                "需要 [140] PE改写的 wh_ratio 输出(如 16:9)——请把 [140] 的"
                " wh_ratio 连到本节点 wh_ratio 输入,或把联动开关关掉走九型"
                "宽高;不猜不代选")
        ratio = _parse_ratio(wh_ratio)
        if not 联动开关 or ratio is None:
            if 联动开关:
                # Q6:想用建议值但解析失败 → 中文警告后回退(不炸队列)
                print(
                    f"[MyQi21WhSuggest] 画幅比例 wh_ratio={wh_ratio!r} 解析失败"
                    "(应为「宽:高」数字形,如 16:9),已回退手动宽高/九型宽高"
                    f"({九型WIDTH}×{九型HEIGHT})继续")
            return self._manual_or_nine(wh_ratio, 九型WIDTH, 九型HEIGHT,
                                        手动宽, 手动高)

        # 4.2MP 联立 + 8 倍数取整:原 [155][156] widgets_values[0] 逐字
        #   [155] round(a*sqrt(4.2*1024*1024/(a*b))/8)*8
        #   [156] round(b*sqrt(4.2*1024*1024/(a*b))/8)*8
        a, b = ratio
        w = round(a * math.sqrt(4.2 * 1024 * 1024 / (a * b)) / 8) * 8
        h = round(b * math.sqrt(4.2 * 1024 * 1024 / (a * b)) / 8) * 8
        if w <= 0 or h <= 0:
            # Q6 计算侧同款(S8 深审 L-5):极端比例(宽高比 > 约
            # 275251:1)8 倍取整后建议出 0,下游空潜在执行期炸 → 中文
            # 警告后回退手动宽高/九型原样(原链 [155][156] 同式直出 0,
            # 本防御纯收紧,三档锚值行为不变)
            print(
                f"[MyQi21WhSuggest] 画幅比例 wh_ratio={wh_ratio!r} 过于极端"
                f"(4.2MP 建议值 {w}×{h} 含 0),已回退手动宽高/九型宽高"
                f"({九型WIDTH}×{九型HEIGHT})继续")
            return self._manual_or_nine(wh_ratio, 九型WIDTH, 九型HEIGHT,
                                        手动宽, 手动高)
        return (w, h)

    def _manual_or_nine(self, wh_ratio: Any, 九型WIDTH: int | None,
                        九型HEIGHT: int | None, 手动宽: int | None,
                        手动高: int | None) -> tuple[int, int]:
        """非建议路统一回退(1001 用户测试批 P1,design §2.3):
        手填非 0 成对优先 → 九型;只填一个=中文报错(不猜);两者皆无=报错。

        i2i/edit 不接手动槽(缺键 None)→ 按 0 处理 → 恒走九型=旧行为
        逐字节不变;半填检测惰性(仅手动路被需要时判,PE 开时控件隐藏的
        残留半填不炸看不见的产线)。
        """
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
                f"[MyQi21WhSuggest] 画幅无值可用:wh_ratio={wh_ratio!r} "
                "建议路未成,手动宽高未填(0,0)且九型 WIDTH/HEIGHT 槽未接线"
                "(至少其一无值)——请填手动宽高成对值,或把底座节点的 "
                "WIDTH/HEIGHT 连到本节点对应槽,或修正 wh_ratio 为"
                "「宽:高」数字形;不猜不代选")
        return (九型WIDTH, 九型HEIGHT)
