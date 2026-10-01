# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21WhSuggest 契约测试(1001 S8 L1-2 造件;implement.md S8 步骤 3
五例清单;与 test_my_qi21_speed_select.py 同目录同纪律,源码位 sidecar
零引擎依赖。本件尚待步骤 6 注册进 NODE_CLASS_MAPPINGS,故此处不锁注册面,
只锁行为契约——注册面断言归装配器轮(同批两件)统一落)。

期望值手验(implement.md S8 步骤 3 指定命令,本会话实跑):
  python3 -c "import math;a,b=16,9;w=round(a*math.sqrt(4.2*1024*1024/(a*b))/8)*8;print(w)"
  → 实跑输出 2800(implement.md:69 注释「→ 2560」系誊写误;三比值全表
  16:9→(2800,1576) / 1:1→(2096,2096) / 9:16→(1576,2800),≈4.2MP 且
  8 倍数)。implement.md:67 清单①③的 (2560,1440)/(1440,2560) 与②
  (2096,2096,=公式值)内部不自洽(2560×1440=3.69MP 系 3.52MP 口径);
  prd.md:36「4.2MP/8倍取整公式逐字迁移」+ design §10.6 + 工作流 [155][156]
  widgets_values[0] 现值三方一致锚 4.2MP——断言按真值落,非改弱。

锁:①②③ 三档建议值精确数(4.2MP 联立+8 倍数取整,公式=[155][156]
逐字)④联动关=九型宽高原样直通(建议路不串)⑤非法 wh_ratio 回退九型
不抛+中文警告(Q6)+九型槽也未接线中文报错(无值可用,不猜)。
"""

from __future__ import annotations

import pytest

from engines.comfyui.my_nodes.nodes.my_qi21_wh_suggest import (
    MyQi21WhSuggest, _parse_ratio)

# 九型宽高哨兵(回传语义用任意值即证「原样」;非九型真值,真值住
# daojie_bases.json,与本件回传行为无关)
_W, _H = 1328, 1328


# ── ①②③ 三档建议值:4.2MP 联立 + 8 倍数取整(公式逐字手验) ──────────
def test_ratio_16_9_suggests_landscape_pair():
    result = MyQi21WhSuggest().suggest("16:9", True,
                                       九型WIDTH=_W, 九型HEIGHT=_H)
    assert result == (2800, 1576)  # 手验实跑 2800;4.208MP;均为 8 倍数
    assert all(isinstance(v, int) for v in result)
    assert result != (_W, _H)  # 建议路生效,不串九型


def test_ratio_1_1_suggests_square_pair():
    assert MyQi21WhSuggest().suggest("1:1", True,
                                     九型WIDTH=_W, 九型HEIGHT=_H) == (2096, 2096)


def test_ratio_9_16_suggests_portrait_pair():
    # 与①对称换位(原 [151][152] 取比次序=前段宽/尾段高,9:16 竖幅)
    assert MyQi21WhSuggest().suggest("9:16", True,
                                     九型WIDTH=_W, 九型HEIGHT=_H) == (1576, 2800)


# ── ④ 联动关:九型宽高原样直通(wh_ratio 合法也不消费) ────────────────
def test_linkage_off_passes_nine_type_through():
    node = MyQi21WhSuggest()
    # wh_ratio 合法("16:9")但联动关 → 建议 路 整条不走,九型原样
    assert node.suggest("16:9", False, 九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # wh_ratio 非法且联动关 → 同样九型原样,不发警告(回退非因解析失败)
    assert node.suggest("abc", False, 九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # 默认联动开关=False(原 [157][158] widgets [false] 默认关=恒九型)
    spec = MyQi21WhSuggest.INPUT_TYPES()
    assert spec["required"]["联动开关"][1]["default"] is False
    assert MyQi21WhSuggest.RETURN_TYPES == ("INT", "INT")
    assert MyQi21WhSuggest.RETURN_NAMES == ("width", "height")


# ── ⑤ Q6 容错:解析失败回退+中文警告;九型槽也未接线→中文报错 ──────────
def test_invalid_ratio_falls_back_with_warning_and_raises_when_both_missing(
        capsys):
    node = MyQi21WhSuggest()
    # 5a. 非法 wh_ratio("abc")+联动开+九型接线 → 不抛,回退九型,中文警告
    assert node.suggest("abc", True, 九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    out = capsys.readouterr().out
    assert "解析失败" in out and "回退" in out and "九型" in out  # 中文警告一条
    # 5b. 同场景九型槽也未接线 → 中文报错(无值可用,不猜)
    with pytest.raises(ValueError) as ei:
        node.suggest("abc", True)
    msg = str(ei.value)
    assert "无值可用" in msg and "九型" in msg and "wh_ratio" in msg
    # 双缺场景警告先于报错(Q6:解析失败即警告,回退无值才 raise)
    assert "解析失败" in capsys.readouterr().out
    # 附:取比器契约(正则=[151][152] 逐字语义)
    assert _parse_ratio("16:9") == (16, 9)
    assert _parse_ratio("  16 : 9  ") == (16, 9)   # 前导空白/冒号后空白容忍
    assert _parse_ratio("16:9 extra") is None      # 尾缀污染=tail 锚串尾判失败
    assert _parse_ratio("0:9") is None             # 0 值比例=除零前置防御
    assert _parse_ratio(None) is None              # 非字符串归 Q6
