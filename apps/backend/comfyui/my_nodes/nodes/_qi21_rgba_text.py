# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""透明声明句级剔除单源(10-09-qi21-prompt-layer-conflict P5/P6)。

透明语义全英文承载(2008 架构令,[4014] 程序化包裹头尾),型文/rgba_positive
自带的中文透明声明句(「图为带透明通道…背景透明」)不得入 PE 输入与装配类型句。
ApiPE 回退极简公式、ApiPE 透明开 direct、MyQi21PromptAssembly 透明路三处共用,
防各写各的漂移(旧装配器按行滤→道具 L0 正文与声明同行被整行吞没)。
"""
import re

RGBA_DECL_MARKERS = ("带透明通道", "背景透明")


def _has_marker(s: str) -> bool:
    return any(m in s for m in RGBA_DECL_MARKERS)


def strip_rgba_decl(text: str) -> str:
    """逐行、行内按句级剔除中文透明声明句;剔空的行整行去掉,其余行与句原样保留。

    句界=。;；(1108 修):型文以分号连句,声明句常与正文糊在同一「。」句内——
    仅按。切会把末句号后的全部正文一并吞掉(v0.1 无衣物定妆后半段实弹丢失、
    单句号型文整段归零实录);三符号切界,声明句只剔自身。"""
    lines = []
    for line in (text or "").split("\n"):
        if not _has_marker(line):
            lines.append(line)
            continue
        kept = "".join(s for s in re.split(r"(?<=[。;；])", line) if not _has_marker(s)).strip()
        if kept:
            lines.append(kept)
    return "\n".join(lines)


def assert_strip_survival(original: str, stripped: str, context: str = "",
                          min_retention: float = 0.5) -> None:
    """剥除存活断言(1108 装配即验证令):声明剥除只准吃声明句。

    原文非空而剥后为空、或正文保有率低于 min_retention=层丢失级事故,
    响亮报错拦在提交口——静默丢层=废图正常出图(1108 无衣物定妆整层
    归零实录:句界按。切而型文以;连,正文陪葬)。三处 strip 调用位
    (ApiPE direct/lean、PromptAssembly 透明路)接线后,数据侧动标点
    再丢层会在生成口炸响而不是出货。"""
    src = (original or "").strip()
    if not src:
        return
    kept = len((stripped or "").strip())
    if kept == 0:
        raise RuntimeError(
            f"[漫影 透明剥除] {context}: 正文整段被吞(原文{len(src)}字→0)"
            "——剥除器句界与文本标点不契,拒出图")
    if kept < len(src) * min_retention:
        raise RuntimeError(
            f"[漫影 透明剥除] {context}: 正文保有率过低"
            f"({kept}/{len(src)}={kept / len(src):.0%}<{min_retention:.0%}),"
            "疑似误吞正文,拒出图")
