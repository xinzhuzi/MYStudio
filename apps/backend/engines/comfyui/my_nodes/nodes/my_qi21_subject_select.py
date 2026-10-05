# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 主体句选择件(MyQi21SubjectSelect,1005 ㉜ 管线重序役)。

用户令(1005):**主体句经过 PE,再拼类型句,再拼美术风格底座,最终 1 个提示词**
——PE 只吃主体句(官方 PE 的本职:短句→长文),型底座与锁层A 以中文原文由
装配器拼在 PE 输出之后。本件=管线重序后的第一道选择闸:

  宿主主体句 ──┐
               ├─ pe开:选 PE 扩写文(懒请求) → [4011] 装配器.主体句槽
  [4013]PE出文 ┘  pe关:选原主体句直通(全中文三层直拼)

链位:[4013]PE → 本件 → [4011]装配(扩写主体句+BASE+锁层A) → [4014]合成。
此前管线是整段装配文全喂 PE(PE 重写全部含型/底座)——1005 用户令推翻:
资产层(型/锁层A)固定中文不过 PE,只有每图变的主体句过 PE。

懒执行协议(同 MyQi21PromptSelect 实名协议,引擎实码对拍 execution.py:507-520):
pe关→[] 不请求(旧链 [4013] 无人消费其输出→不进执行图→零 PE TE 装载);
pe开且 PE出文 已接线未求值(执行器投 None)→请求名单 ["PE出文"](纯字符串
列表);未接线槽(kwargs 缺键)绝不请求。pe开关 缺键兜底 True(与 widget
default/0926 裁定1 同态)。

容错:pe开而 PE出文 为空串/None(PE 透传失败等)→退回原主体句(资产拼装
不断链,不猜不代选)。注册(import+NODE_CLASS_MAPPINGS+DISPLAY「道劫·qi21
主体句选择件」)在 my_nodes/__init__.py,本文件不自带注册。
"""

from __future__ import annotations

from typing import Any


class MyQi21SubjectSelect:
    """漫影道劫 qi21 主体句选择件:pe开=PE 扩写文,pe关=原主体句,喂装配器。"""

    CATEGORY = "漫影"
    DESCRIPTION = (
        "道劫主体句选择件:PE 只扩写主体句(1005 管线重序)——"
        "pe开选 PE 扩写文、pe关选原主体句直通,输出喂 [4011] 装配器"
        "主体句槽(型底座与锁层A 中文原文由装配器拼在其后)"
    )

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 连线槽前置(渲染序=声明序);required 恒空(optional 连线槽保
        # 「可不接」语义,required 化会被引擎验证层拒=breaking)。
        return {
            "required": {},
            "optional": {
                "主体句": ("STRING", {
                    "tooltip": "宿主面板主体句原文,连子图入口「主体句」;"
                               "PE 关时直通进装配"}),
                "PE出文": ("STRING", {
                    "lazy": True,
                    "tooltip": "PE 改写好的主体句扩写长文,连 PE 改写节点"
                               "的 positive_prompt;开关关时不被拉起"}),
                "PE宽高比": ("STRING", {
                    "lazy": True,
                    "tooltip": "PE 改写给出的宽高比(如 16:9);开关关时不请求,PE 零执行零装载"}),
                "pe开关": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "与 [4014] 同源总开关:开=主体句先过 PE 再"
                               "拼型/底座;关=主体句直拼(全中文三层)"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("选定的主体句", "宽高比")
    FUNCTION = "select_subject"
    OUTPUT_NODE = False

    def check_lazy_status(self, pe开关: bool | None = None,
                          **kwargs: Any) -> list[str]:
        """只请求「pe开×已接线×未求值」的 PE出文,其余一律空名单。

        执行器以 kwargs 投递当前输入(execution.py:511):缺键=未接线→
        绝不请求(引擎对未接线槽 make_input_strong_link 抛
        NodeInputError);None=已接线未求值→请求;有值=已求值→放行。
        pe开关 缺键兜底 True(0926 裁定1 语义不漂)。
        """
        if pe开关 is None:
            pe开关 = True
        if not pe开关:
            return []
        requests: list[str] = []
        for slot in ("PE出文", "PE宽高比"):
            if slot in kwargs and kwargs[slot] is None:
                requests.append(slot)
        return requests

    def select_subject(self, 主体句: str | None = None,
                       PE出文: str | None = None,
                       PE宽高比: str | None = None,
                       pe开关: bool | None = None) -> tuple[str, str]:
        """单口输出:pe开且 PE出文 非空→PE出文;否则→原主体句。

        全参数有 default,缺投不炸 TypeError;pe开而 PE出文 空/None
        (PE 透传失败)=退回原主体句(装配链不断,不猜不代选)。
        """
        if pe开关 is None:
            pe开关 = True
        wh = ""
        if pe开关:
            pe_text = (PE出文 or "").strip()
            wh = (PE宽高比 or "").strip()
            if pe_text:
                return (pe_text, wh)
        return ((主体句 or "").strip(), wh)
