# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫提示词运行时门禁(1017 用户令「正常运行中出现的提示词,不符合门禁要报错,
用代码做门禁」)。

仓侧 pytest 六门只管仓库真源(随包体走但仅测试期执行);本模块=产线常跑门:
装配节点入口/出口校验主体句与终稿,违规 raise ValueError=ComfyUI 任务级报错
(画布节点红错/API 任务失败),坏提示词到不了模型。

规则与错题集十二~十四族同源;改规则三处同步(本模块+test_my_qi21_base 门禁
+错题集 12 篇)。豁免:①【文字要求】/【字体】钦定原文块(用户逐字令,含
「不要」「无错字」);②「未[指提供带]」装配逻辑条件词;③负向层(否定词合法家)。
作用域:MyQi21ApiPE=t2i 全路;MyQi21PromptAssembly 仅「新建资产」路
(i2i 局部编辑/画风转换豁免=09 篇否定式两落法纪律在册,候用户令扩展)。
"""
from __future__ import annotations

import re

# 钦定原文块豁免(用户逐字令)
_VERBATIM = re.compile(r"【文字要求】[^。]*。|【字体】[^。]*。")
# 十四族:视觉否定式(直陈化;模型不吃否定词,无大象效应)
_NEG = re.compile(
    r"不能|不得|不要|不准|禁止|不生成|不画|不拆|不挤占|不造|不强行|不见|"
    r"互不粘连|无第[一二三四五六七八九十]|无错字|无乱码|不多不少|看不见|不为填格")
# 十二族:技术光学词(叙事光词合法如暮色晨光,由型文光句转色面冷暖)
_OPTIC = re.compile(r"(?<!肤)色温|明暗关系|受光一致|光照方向")
# 十三族:两可句禁词族
_MUSH = ("或全身", "或半身", "取景为半身", "单人或多人")
# 主体句层专属:空质量词(Q2.1 官方劝退)与画风双写词(风格归底座)
_EMPTY_Q = ("masterpiece", "8K", "8k", "best quality", "超高清", "杰作", "最高质量")
# 画风双写词(恒毒:与底座双写/错误风格拉力);水墨不在此列=错题集§六条件毒药
# (用户令要水墨时反转为正资产,三国望神州方向合法,硬禁会拦死该方向——1017 复查勘正)
_STYLE_WORDS = ("工笔", "白描", "连环画", "厚涂", "赛璐璐", "photorealistic")


def _strip_verbatim(text: str) -> str:
    return _VERBATIM.sub("", text or "")


def prompt_violations(text: str, *, is_subject: bool) -> list[str]:
    """返回违规清单(空=过)。is_subject=主体句层(人写输入,多两组检查);
    is_subject=False=终稿层(含 canon,只查毒词族,主体句专属组豁免)。"""
    out: list[str] = []
    t = _strip_verbatim(text)
    m = _NEG.search(t)
    if m:
        out.append(f"否定式「{m.group(0)}」——模型不吃否定词,改直陈(不画X→只画Y)")
    m = _OPTIC.search(t)
    if m:
        out.append(f"技术光学词「{m.group(0)}」——改叙事光词(暮色/晨光),由型文转色面冷暖")
    for b in _MUSH:
        if b in t:
            out.append(f"两可句「{b}」——改确定式(全身/半身由主体句显式指定)")
            break
    if "写实" in t:
        out.append("「写实」——禁写实词,工笔线描平涂由型文程式句承担")
    if is_subject:
        for b in _EMPTY_Q:
            if b in t:
                out.append(f"空质量词「{b}」——换可见细节词(如「甲片边缘錾刻纹」)")
                break
        for b in _STYLE_WORDS:
            if b in t:
                out.append(f"画风词「{b}」——风格归底座,主体句只写画什么")
                break
    return out


def assert_prompt_gates(text: str, *, is_subject: bool, context: str = "") -> None:
    """产线门:违规即 raise ValueError(ComfyUI 任务级报错)。空文本=未接线正常态,放行。"""
    if not (text or "").strip():
        return
    violations = prompt_violations(text, is_subject=is_subject)
    if violations:
        raise ValueError(
            f"[道劫提示词门禁]{context} " + ";".join(violations)
            + "。修主体句后重跑;门禁规则详见 docs/prompts/Qwen-Image-2.1/12-毁风格词错题集.md")
