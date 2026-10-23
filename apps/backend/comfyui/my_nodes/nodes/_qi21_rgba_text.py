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
    """逐行、行内按「。」句级剔除中文透明声明句;剔空的行整行去掉,其余行与句原样保留。"""
    lines = []
    for line in (text or "").split("\n"):
        if not _has_marker(line):
            lines.append(line)
            continue
        kept = "".join(s for s in re.split(r"(?<=[。])", line) if not _has_marker(s)).strip()
        if kept:
            lines.append(kept)
    return "\n".join(lines)
