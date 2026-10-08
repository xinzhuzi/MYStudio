# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""负向 token 格式回归锁(1008 终审token化修正立)。

用户终审质询「禁止电影级主光/填充/轮廓光三点布光在负向里面是这么写可以吗」定谳:
负向通道本身即禁止,清单=逗号分隔的裸视觉 token,一词一概念。四条硬规:
①零指令词开头(禁止/不得/不要/避免/严禁/防止/没有——元语言不入画面词汇);
②零斜杠复合(斜杠焊长串削弱 token 压制力;一词一概念拆立——「扇贝状/破损/分叉的裙摆或袍摆」案);
③单 token <12 字(句子碎片按词拆,12 字=现行最长合法 token「男性超大号通用工靴」9 字留余量);
④同列表零重复(重复=挤占负向预算)。
覆盖=art_style_base.negative_text + types[].negative_text 全十型;改词违规格即红。
"""

from __future__ import annotations

import json
import re

from engines.comfyui.my_nodes.nodes import my_daojie_base

_DIRECTIVE = re.compile(r"^(禁止|不得|不要|避免|严禁|防止|没有)")


def _tokens(text: str) -> list[str]:
    return [t.strip() for t in text.split("，") if t.strip()]


def _assert_clean(name: str, text: str) -> None:
    toks = _tokens(text)
    assert toks, f"{name}: 负向清单不应为空"
    for t in toks:
        assert not _DIRECTIVE.search(t), \
            f"{name}: 指令词开头 token={t!r}(元语言不入负向——1008 终审)"
        assert "/" not in t, \
            f"{name}: 斜杠复合 token={t!r}(一词一概念拆立——1008 终审)"
        assert len(t) < 12, \
            f"{name}: 超长 token={t!r}({len(t)} 字,按词拆分)"
    dup = sorted({t for t in toks if toks.count(t) > 1})
    assert not dup, f"{name}: 同列表重复 token={dup}"


def test_negative_token_format_baseline_1008():
    """锁层+十型负向全量格式门:违规格即红,防 1004 拆开轮式「整句搬入」回潮。"""
    data = json.loads(my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
    _assert_clean("art_style_base", data["art_style_base"]["negative_text"])
    for ty in data["types"]:
        _assert_clean(f"types[{ty.get('zh')}]", ty.get("negative_text", ""))
