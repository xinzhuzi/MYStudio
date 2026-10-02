# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""漫影 qi21 最终文本合成器(MyQi21PromptSelect,1001 S8 R7 集成轮裁定 A 拆件
形态=装配链下游件;主对话裁定 A / design §10.4 修订)。

道劫 t2i [40] 装配子图文本段集成的下游件(吞原 [141] 提示词开关+[209] 透明文本
开关+[206] 词族剥离+[216] W1收束拼+[207][208] W1包裹+[162][163] RGBA公式拼接
+[160][161] 头尾常量+[215] W1收束句):PE 路选择+透明文本包裹合成,两口产出。

裁定 A 拆件缘起(在档):一件式三口形态下「装配全文→[140].prompt」与
「[140].positive_prompt→装配器.PE出文」构成数据环,引擎验证层实测拒绝
(execution.validate_inputs 对全部连线输入递归环检,lazy 边无豁免;最小同构环
venv 实测=「Dependency cycle detected」valid=False)。拆件成链后:
MyQi21PromptAssembly(141)→[140] PE改写→本件(152),环变链。

输入口(1002 ⑭ 接口批重排:连线槽前置/参数 widget 下沉——required 置空,
全部槽住 optional 按新序声明;槽位映射表=research/slot-map.md):
  optional(声明序=前端渲染序)
    装配全文   ← [141] MyQi21PromptAssembly.装配全文(**连线槽,前置**;直写路/
               透明直写路真源);缺键(None)语义=pe关路降级空串+中文警告
               (裁定 A 自洽语义)
    PE出文     ← [140] PE改写.positive_prompt(**连线槽,前置**;lazy=True:
               pe关×联动关时 [140] 无人消费其输出→不进执行图→零 PE TE 装载;
               1001 深审修复轮起成立——修前 [151].wh_ratio 非懒必填槽强拉
               [140],实弹证违在档 s8-integration-report.json lazyVerdict=
               VIOLATED,已随 wh_ratio lazy 化根治,引擎实码最小同构图三拍复验)
    pe开关     接 -10槽5(宿主面板「PE开关」,默认 true;独立手动,不再与透明
               共布尔;**参数 widget,下沉**;1002 ⑭ 随迁 optional,缺键兜底
               =True 与 widget default 同态=0926 裁定1 语义不漂)
    透明模式   接 [150].透明值(1001 ④⑥⑦:纯 BOOLEAN 跨子图边界,解析住底座件;
               不参与文本计算=机械双产出,RGBA 用否由下游 [144] conditioning
               开关裁决)
    RGBA官方头句 / RGBA官方尾句 / W1收束句
               三固定句参数面(原 [160][161][215] 迁入;multiline 大框=Q4
               「固定句都要输入框」;default=1001 t2i 工作流值逐字;**下沉**)

逻辑(1002 Q4 补强:pe关透明路同包 W1 收束句——grill 五问 Q4 裁定,
此前仅 pe开路包 W1,pe关透明文本少收束句=裸拼;两路统一后):
  最终文本 = PE出文 if pe开关 else (装配全文 or "")
  透明 mid = 剥离(PE出文)+" "+W1收束句 if pe开关
             else (装配全文 or "")+" "+W1收束句     (Q4:两路同包 W1)
  透明文本 = RGBA官方头句+" "+透明 mid+" "+RGBA官方尾句
  剥离(s)  = re.sub(词族pattern, "", s, flags=IGNORECASE)   (原 [206] 语义)

两口(RETURN_NAMES,口序即返回元组序):
  最终文本(口0)→ [142].prompt + 子图输出口「最终文本」(-20 槽4 IO 预览);
  透明文本(口1)→ [143].prompt(机械双产出:透明模式输入不参与文本计算,
            RGBA 用否由下游 [144] conditioning 开关裁决=R7.4 不可吞边界)。

懒执行协议(SpeedSelect 实名协议,自一件式装配器随裁定 A 挪本件;引擎实码
对拍 execution.py:507-520 + graph.py:169-170):
  - PE出文 声明 lazy=True=执行图对该槽默认不建强依赖,pe 关时 [140] 无人消费
    其输出→不进执行图→零 PE TE 装载。**成立条件=pe开关关×联动开关关**
    ([151] MyQi21WhSuggest.wh_ratio 亦已 lazy 化,1001 深审修复轮;联动开
    时 wh_ratio 请求仍拉 [140]=建议路既有语义,详见该件 docstring);
  - 钩子实名 check_lazy_status(本版引擎只认此名):pe关→[];pe开且 PE出文
    已接线未求值(执行器投 None)→请求名单;未接线槽(kwargs 缺键)绝不请求
    ——引擎对未接线槽 make_input_strong_link 抛 NodeInputError
    (graph.py:132-133);
  - 请求名单=**纯字符串列表**(SpeedSelect 同款,my_qi21_speed_select.py:104):
    引擎把名单 sum() 摊平后按 isinstance(x,str) 过滤再建强链
    (execution.py:513-516)——元组形条目会被静默丢弃,取 ["PE出文"] 字符串形;
  - pe开而 PE出文 未接线=合成中文报错(不猜不代选,SpeedSelect「选中档未接线」
    同款)。

词族单源化(R7.3):剥离 pattern 真源=同目录 qi21_strip_lexicon.json(从原
[206] widgets_values[1] 程序提取,SHA256 前16位 09008edcd2998efc 对拍),
json.load 现读+进程内缓存(mtime 无关=design §10.5 钦定:词族属代码级常量
非热改数据)。注册(import+NODE_CLASS_MAPPINGS+DISPLAY「道劫·qi21最终文本
合成器」)在 my_nodes/__init__.py,本文件不自带注册。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# ── 三固定句 default(1001 t2i 工作流值逐字迁入,脚本注入禁手敲;sha256 前16位 ──
# ── 对拍锚=[160]头句 fe7eca21a0b8dd10 / [161]尾句 eb30fffec9f87437 / ──
# ── [215]W1 c17fba67932284ed;改值须走 05 库「从库刷参数」同批过账并更新锚)──
_RGBA_HEAD = 'This is an RGBA format image with transparency.'  # 原 [160] RGBA官方头句
_RGBA_TAIL = 'The image has an alpha channel and a transparent background.'  # 原 [161] RGBA官方尾句
_W1_TAIL = 'The subject reads as a clean flat cutout, a single isolated asset held entirely within the frame, surrounded on all sides by empty transparency, with a crisp unbroken silhouette out to its very edges.'  # 原 [215] W1收束句

# 词族数据文件(单源真源;判据件/审计脚本同此路径取 pattern)
_LEXICON_PATH = Path(__file__).resolve().parent / "qi21_strip_lexicon.json"

# 进程内缓存(mtime 无关,design §10.5):词族=代码级常量,改它=改节点代码,
# 重载引擎生效——与 qi21_bases.json 热改即时生效纪律相反,勿混。
_lexicon_cache: dict[str, Any] | None = None


def _load_lexicon() -> tuple[str, bool]:
    """词族真源现读:pattern+case_insensitive;首读后进程内缓存。

    结构校验(S8 深审 L-3):json 合法≠结构合法——pattern 须非空 str、
    case_insensitive 须 bool;不合法视同损坏,同款 RuntimeError 中文兜底
    且**不写缓存**(坏 dict 钉死缓存=修文件不自愈须重启,就此根除:
    校验不过缓存恒 None,修好文件下次调用即现读自愈)。
    """
    global _lexicon_cache
    if _lexicon_cache is None:
        try:
            data = json.loads(_LEXICON_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError(
                "qi21 词族库缺失或损坏:my_nodes/nodes/qi21_strip_lexicon.json "
                f"读取失败({exc})——请在漫影设置里重新同步自研节点,或重启"
                "漫影工作室") from exc
        if (not isinstance(data, dict)
                or not isinstance(data.get("pattern"), str)
                or not data.get("pattern")
                or not isinstance(data.get("case_insensitive"), bool)):
            raise RuntimeError(
                "qi21 词族库缺失或损坏:my_nodes/nodes/qi21_strip_lexicon.json "
                "结构不合法(须含 pattern=非空字符串与 case_insensitive=布尔)"
                "——请在漫影设置里重新同步自研节点,或重启漫影工作室")
        _lexicon_cache = data
    return _lexicon_cache["pattern"], bool(_lexicon_cache["case_insensitive"])


def strip_word_family(text: str) -> str:
    """词族整句剥离(原 [206] 语义):命中词族的整句删,词边界匹配;pattern
    自带句界包裹与可选拖尾句读符;大小写由数据文件 case_insensitive 驱动
    (=true);count=0 全局替换(逐项对拍 comfy_extras/nodes_string.py:406)。"""
    pattern, case_insensitive = _load_lexicon()
    return re.sub(pattern, "", text, flags=re.IGNORECASE if case_insensitive else 0)


class MyQi21PromptSelect:
    """漫影道劫 qi21 最终文本合成器:PE 路选择+透明文本包裹,两口产出。

    最终文本(口0)=pe开关?PE出文:装配全文;透明文本(口1)=头句+空格+
    (PE路=剥离(PE出文) / 直写路=装配全文)+空格+W1收束句+空格+尾句
    (1002 Q4:两路同包 W1),机械双产出(透明模式输入不参与计算,[144]
    下游裁决,R7.4 不可吞边界)。
    """

    CATEGORY = "my"
    DESCRIPTION = ("道劫最终文本合成器:pe开=PE出文为最终文本/pe关=装配全文;"
                   "透明文本=RGBA 包裹+词族整句剥离(PE路)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 1002 ⑭ 接口批:两连线槽(装配全文/PE出文)前置=节点顶部连线区,五个
        # 参数 widget(开关/布尔/三大框)下沉=节点下部参数区——required 置空全住
        # optional:连线槽保「可不接」语义(装配全文缺键=降级/PE出文缺键=pe关路
        # 零装载,required 化会被引擎验证层拒=breaking);widget 缺键=签名 default
        # 兜底。渲染序=required 序+optional 序,故声明序即面板序。
        return {
            "required": {},
            "optional": {
                "装配全文": ("STRING", {"tooltip": "装配好的完整提示词原文,连「装配"
                                                "全文件」节点的输出;不连=直写路空文,"
                                                "日志有中文警告"}),
                "PE出文": ("STRING", {"lazy": True,
                                       "tooltip": "PE 改写好的英文长提示词,连 PE 改写"
                                                  "节点的 positive_prompt 输出;开关关"
                                                  "时它不会被拉起"}),
                "pe开关": ("BOOLEAN", {"default": True,
                                        "tooltip": "总开关:开=先用 PE 把中文短句改写"
                                                   "成英文长提示词;关=直接用装配好的"
                                                   "原文"}),
                "透明模式": ("BOOLEAN", {"default": False,
                                          "tooltip": "要不要出透明底图,自动跟着所选型"
                                                     "走(接底座节点的「透明值」),"
                                                     "一般不用管"}),
                "RGBA官方头句": ("STRING", {"multiline": True, "default": _RGBA_HEAD,
                                             "tooltip": "教模型输出透明图的官方英文"
                                                        "开头句,一般不用改"}),
                "RGBA官方尾句": ("STRING", {"multiline": True, "default": _RGBA_TAIL,
                                             "tooltip": "告诉模型图带透明通道的官方"
                                                        "英文收尾句,一般不用改"}),
                "W1收束句": ("STRING", {"multiline": True, "default": _W1_TAIL,
                                          "tooltip": "让主体变成干净抠图素材的收尾"
                                                     "描述(独占画面+四周留透明),"
                                                     "一般不用改"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("最终文本", "透明文本")
    FUNCTION = "compose"

    def check_lazy_status(self, pe开关: bool | None = None,
                          **kwargs: Any) -> list[str]:
        """只请求「pe开×PE出文已接线×尚未求值」的槽,其余一律空名单。

        执行器以 kwargs 投递当前输入(经典节点,execution.py:511):缺键=该槽
        未接线(optional 不投递)→绝不请求(引擎对未接线槽 make_input_strong_link
        抛 NodeInputError);None=已接线未求值→请求;有值=已求值→放行。pe关时
        即便 PE出文 已接线未求值也不请求([140] 无人消费其输出→不进执行图)。

        1002 ⑭ optional 化补:pe开关 缺键(None,仅手写 API prompt 省略槽时
        可达;前端 widget 值恒投递)按 widget default=True 兜底(0926 裁定1
        「画布默认 PE 开路」语义不随槽位搬家漂移)。
        """
        if pe开关 is None:
            pe开关 = True
        if not pe开关:
            return []
        if "PE出文" in kwargs and kwargs["PE出文"] is None:
            return ["PE出文"]
        return []

    def compose(self, 装配全文: str | None = None, PE出文: str | None = None,
                pe开关: bool | None = None, 透明模式: bool = False,
                RGBA官方头句: str = _RGBA_HEAD, RGBA官方尾句: str = _RGBA_TAIL,
                W1收束句: str = _W1_TAIL) -> tuple[str, str]:
        """两口合成:最终文本/透明文本(返回元组序=RETURN_NAMES 序)。

        形参序=⑭ 新槽序(两连线槽前置);引擎按名投递与形参序无关,直接调用方
        (单测/脚本)用关键字传参零波及。1002 ⑭ optional 化:全参数有 default,
        缺投不炸 TypeError;pe开关 None 兜底 True(同 widget default/懒钩子)。

        透明模式形参在场但不参与计算(R7.4:[144] conditioning 开关保留在下游
        裁决,本件机械双产出;形参名=输入槽名,引擎按名投递不可改名)。

        装配全文 None(未接线)语义(裁定 A 自洽):pe开路不消费它=照常;pe关路
        降级空串+中文 print 警告(缺真源=缺整段文本,日志可查,不猜不代选)。
        """
        if pe开关 is None:
            pe开关 = True
        if 装配全文 is None:
            print("[MyQi21PromptSelect] 装配全文输入未接线:pe关路(直写/透明直写)"
                  "无真源文本可用,最终文本降级为空串——请把 [141] "
                  "MyQi21PromptAssembly 的 装配全文 输出连到本节点 装配全文 "
                  "输入,或检查该连线是否被改动")
            direct = ""
        else:
            direct = 装配全文
        if pe开关:
            if PE出文 is None:
                raise ValueError(
                    "pe开关=开但 PE出文 输入未接线:PE 路需要 [140] PE改写的"
                    "positive_prompt 出文——请把 [140] 出文连到本节点 PE出文 "
                    "输入,或把 pe开关 关掉走直写路")
            final_text = PE出文
            transparent_mid = strip_word_family(PE出文) + " " + W1收束句
        else:
            # 1002 Q4 补强(grill 五问 Q4 裁定):pe关透明路同包 W1 收束句——
            # 修前=裸拼装配全文,与 pe开路(剥离+W1)不对称,透明素材收束缺位
            final_text = direct
            transparent_mid = direct + " " + W1收束句
        transparent_text = f"{RGBA官方头句} {transparent_mid} {RGBA官方尾句}"
        return (final_text, transparent_text)
