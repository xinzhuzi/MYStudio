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
作用域:MyQi21ApiPE=t2i 全路;MyQi21PromptAssembly=「新建资产/无底座出图」
全查+i2i 路(局部编辑/画风转换)否定式门(1017 用户令「4,开始做」扩展,
09 篇两落法豁免退役——「去掉/摘掉」去除操作与肯定枚举本就不在禁词族,
合法路零波及;光学/两可/写实等族仍豁免=i2i 换色写光理是 09 篇§四合法
纪律,光理措辞与禁词零重叠)。
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

# 1018 用户门禁令:人械同句握姿必须写清、人物发色必写(违者任务级拒收)
_SHEATHED = ("收在鞘中", "挂定", "鞘", "佩刀", "佩剑", "悬一柄")
_HILT_GRIP = re.compile(r"(握住|握着|扣住|按在|按住|轻按)[^。；]{0,10}(剑柄|刀柄|枪柄|柄身)")
_GRIP_WEAPON = re.compile(r"(握|持|执)[^。；，,]{0,4}(剑|刀)")
_GRIP_DETAIL = ("鞘身", "上端", "三分之一", "剑鞘", "刀鞘", "护手", "剑格", "鞘口", "中段", "柄身", "剑柄", "刀柄")
_HAIR = re.compile(r"长发|短发|头发|束发|发髻|马尾|发丝|双髻|披发|发辫|鬓发|须发")
_HAIR_COLOR = re.compile(
    r"(?:乌黑|墨黑|玄色|漆黑|墨色|乌丝|银白|雪白|灰白|银灰|金黄|棕褐|赤红|紫黑|黑|白|银|灰|乌|墨)"
    r"[^。；,，]{0,6}(?:长发|短发|头发|发髻|马尾|发丝|双髻|披发|发辫|辫|鬓|发)")


def _weapon_grip_violations(t: str) -> list[str]:
    out = []
    if _HILT_GRIP.search(t) and any(m in t for m in _SHEATHED):
        out.append("握柄（挂定未拔时手不得按/握剑柄——握柄＝拔剑预备式；改「虚握住挂定的剑鞘上端三分之一处，"
                   "剑的重量仍由腰间剑绦承担」）")
    if _GRIP_WEAPON.search(t) and not any(d in t for d in _GRIP_DETAIL):
        out.append("握姿须写明接触部位与位置（如「虚握住挂定的剑鞘上端三分之一处，五指环拢鞘身」）")
    return out



# 1018 用户门禁令二:人物像衣色/配饰/鞋履必须描述清楚(按取景分档)
_CLOTH = re.compile(r"衣|袍|装|裙|衫|服|裳")
_CLOTH_COLOR = re.compile(
    r"((?:白|黑|玄|青|红|紫|灰|褐|绿|黄|银|金|素|朱)(?:衣|袍|裙|衫|装|服|履|靴|鞋)"
    r"|[一-龥]{1,4}色[一-龥]{0,3}(?:袍|衣|装|裙|衫|服|裳|带|绦|履|鞋|靴|巾|帽))")
_FULLBODY = re.compile(r"全身(?!仅)|足底|从头到脚|双脚")
_SHOE = re.compile(r"鞋|靴|履|屐|袜")
_ACCESSORY = re.compile(r"簪|钗|环|镯|链|佩|囊|袋|带|绦|剑|刀|扇|伞|笛|珠|冠|巾|帽")
_MAT_COLOR = re.compile(r"[一-龥]{0,3}色|乌黑|墨黑|漆黑|银白|雪白|灰白|乌发|黑革|黑鲨皮|黄铜|乌木|白玉|素银|旧金|灰银|银|金|铜|铁|玉|木|革|丝|布|绸|缎")


def _outfit_violations(t: str) -> list[str]:
    out = []
    if _CLOTH.search(t) and not _CLOTH_COLOR.search(t):
        out.append("衣色必写（服装描述必须带明确颜色，如「青玉色道袍」「玄色劲装」）")
    if _FULLBODY.search(t) and not _SHOE.search(t):
        out.append("全身像鞋履必写（如「足蹬青布道履」；半身/特写不受此条）")
    if _ACCESSORY.search(t) and not (_MAT_COLOR.search(t) or _CLOTH_COLOR.search(t)):
        out.append("配饰须写明颜色或材质（如「素银簪」「黑革带」「黄铜刀格」）")
    return out

def _hair_color_violation(t: str) -> str | None:
    if _HAIR.search(t) and not _HAIR_COLOR.search(t):
        return "发色必写（头发描述必须带明确颜色，如「乌黑长发」「墨黑短发」）"
    return None



def _strip_verbatim(text: str) -> str:
    return _VERBATIM.sub("", text or "")


def prompt_violations(text: str, *, is_subject: bool, negation_only: bool = False) -> list[str]:
    """返回违规清单(空=过)。is_subject=主体句层(人写输入,多两组检查);
    is_subject=False=终稿层(含 canon,只查毒词族,主体句专属组豁免);
    negation_only=True=i2i 指令路(1017 用户令扩展:只查否定式族,余族豁免)。"""
    out: list[str] = []
    t = _strip_verbatim(text)
    m = _NEG.search(t)
    if m:
        out.append(f"否定式「{m.group(0)}」——模型不吃否定词,改直陈(不画X→只画Y)"
                   ";i2i 合法落法=去除操作(「去掉颈间玉坠」动词领头锚定图内实存物)或肯定枚举(「仅旧布绳束发」)")
    if negation_only:
        return out
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
        out.extend(_weapon_grip_violations(t))
        hv = _hair_color_violation(t)
        if hv:
            out.append(hv)
        out.extend(_outfit_violations(t))
    return out


def assert_prompt_gates(text: str, *, is_subject: bool, context: str = "",
                        negation_only: bool = False) -> None:
    """产线门:违规即 raise ValueError(ComfyUI 任务级报错)。空文本=未接线正常态,放行。"""
    if not (text or "").strip():
        return
    violations = prompt_violations(text, is_subject=is_subject, negation_only=negation_only)
    if violations:
        raise ValueError(
            f"[道劫提示词门禁]{context} " + ";".join(violations)
            + "。修主体句后重跑;门禁规则详见 docs/prompts/Qwen-Image-2.1/12-毁风格词错题集.md")
