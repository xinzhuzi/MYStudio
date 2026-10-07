# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21WhSuggest 契约测试(1001 S8 L1-2 造件;1008 建议路清退重锚)。

1008 清退(用户令「无用就清理了」):1006 API-PE 换装后 wh_ratio 出口撤销、
建议路全链休眠,故 wh_ratio/联动开关 槽、4.2MP 公式(旧锚 16:9→(2800,1576)
等三档)、取比正则 _parse_ratio、懒协议 check_lazy_status 及其全部用例随源
码删除(历史真源=git 本文件旧版);本件改为锁现役行为契约。

现役锁(源码位 sidecar 零引擎依赖):
  ①九型原样直通(缺省(0,0)/缺键 None 两态=旧行为不变)
  ②手动宽高成对非 0 优先直出(不串九型)
  ③半填(恰一非 0)中文报错,不猜不代选(不会替补 0/不拿九型补另一边;
    半填先于九型缺判)
  ④九型槽未接线且无手填 → 中文报错(无值可用,不猜)
  ⑤槽形状:required 置空全住 optional,声明序=九型W/H 连线槽前置+手动宽高
    下沉(1002 ⑭ 序的清退后形态);手动槽 INT default 0/min 0/max 8192/
    step 8;RETURN=(INT,INT) width/height
  ⑥全部控件 tooltip 在场(大白话一行,⑰)
"""

from __future__ import annotations

import pytest

from engines.comfyui.my_nodes.nodes.my_qi21_wh_suggest import MyQi21WhSuggest

# 九型宽高哨兵(回传语义用任意值即证「原样」;非九型真值,真值住
# qi21_bases.json types[]——1004 集中化,原 daojie_bases.json 已退役并入,
# 与本件回传行为无关)
_W, _H = 1328, 1328


# ── ① 九型原样直通(缺省/缺键两态=旧行为不变) ────────────────────────
def test_nine_type_passthrough_default_and_missing():
    node = MyQi21WhSuggest()
    # 显式 0(=跟型哨兵):九型原样
    assert node.suggest(手动宽=0, 手动高=0, 九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # 缺键(引擎对未接线 optional 不投递):九型原样
    assert node.suggest(九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)


# ── ② 手动宽高成对非 0 优先直出 ────────────────────────────────────────
def test_manual_pair_takes_priority_over_nine_type():
    node = MyQi21WhSuggest()
    assert node.suggest(手动宽=2048, 手动高=1152,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (2048, 1152)


# ── ③ 半填中文报错(不猜不代选;半填先于九型缺判) ──────────────────────
def test_manual_half_filled_raises_chinese_error():
    node = MyQi21WhSuggest()
    # 只填宽
    with pytest.raises(ValueError) as ei:
        node.suggest(手动宽=2048, 手动高=0, 九型WIDTH=_W, 九型HEIGHT=_H)
    msg = str(ei.value)
    assert "只填了一个" in msg and "手动宽=2048" in msg and "手动高=0" in msg
    assert "不猜不代选" in msg
    # 只填高(对称)
    with pytest.raises(ValueError, match="只填了一个"):
        node.suggest(手动宽=0, 手动高=1152, 九型WIDTH=_W, 九型HEIGHT=_H)
    # 半填先于九型缺判(手填路需要时即报,不静默落九型)
    with pytest.raises(ValueError, match="只填了一个"):
        node.suggest(手动宽=2048, 手动高=0)


# ── ④ 九型未接线且无手填 → 无值可用报错 ────────────────────────────────
def test_no_value_available_raises_chinese_error():
    node = MyQi21WhSuggest()
    with pytest.raises(ValueError) as ei:
        node.suggest()
    msg = str(ei.value)
    assert "无值可用" in msg and "九型" in msg and "不猜不代选" in msg
    # 单侧接线同判(至少其一无值)
    with pytest.raises(ValueError, match="无值可用"):
        node.suggest(九型WIDTH=_W)


# ── ⑤ 槽形状(1008 清退后四槽形态) ────────────────────────────────────
def test_slot_shape_after_1008_retirement():
    it = MyQi21WhSuggest.INPUT_TYPES()
    assert it["required"] == {}, "required 应置空(1002 ⑭ 连线槽前置重排)"
    assert list(it["optional"]) == ["九型WIDTH", "九型HEIGHT", "手动宽", "手动高"], \
        f"optional 声明序应=连线槽前置+手动宽高下沉(1002 ⑭×1008 清退)," \
        f"得 {list(it['optional'])}"
    # 旧建议路两槽必须彻底不在(清退防回潮)
    for gone in ("wh_ratio", "联动开关"):
        assert gone not in it["optional"] and gone not in it["required"], \
            f"旧槽「{gone}」应已清退(1008)"
    for slot in ("手动宽", "手动高"):
        kind, opts = it["optional"][slot]
        assert kind == "INT", (slot, kind)
        assert opts["default"] == 0 and opts["min"] == 0
        assert opts["max"] == 8192 and opts["step"] == 8, (slot, opts)
    assert not hasattr(MyQi21WhSuggest, "check_lazy_status"), \
        "懒协议应随 wh_ratio 清退(1008;轻值节点无懒钩子)"
    assert MyQi21WhSuggest.RETURN_TYPES == ("INT", "INT")
    assert MyQi21WhSuggest.RETURN_NAMES == ("width", "height")


# ── ⑥ 全部控件 tooltip 在场(大白话一行,⑰) ───────────────────────────
def test_tooltips_present_plain_language():
    """⑰(1002 用户测试批):全部控件 tooltip 在场(大白话一行)。"""
    it = MyQi21WhSuggest.INPUT_TYPES()
    tips = {name: spec[1].get("tooltip")
            for group in ("required", "optional") for name, spec in it[group].items()}
    for name, tip in tips.items():
        assert isinstance(tip, str) and tip.strip(), f"{name} 应有非空 tooltip(⑰),得 {tip!r}"
    assert "跟所选型" in tips["手动宽"] and "跟所选型" in tips["手动高"]
