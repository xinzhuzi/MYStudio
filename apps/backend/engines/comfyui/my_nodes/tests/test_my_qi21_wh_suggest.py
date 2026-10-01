# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
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

1001 深审修复轮增锁(⑥⑦):wh_ratio lazy 化(修前非懒必填槽经 link25
恒拉 [140] 进执行图=懒执行硬约束实弹证违根因,见
apps/output/s8-integration-1001/s8-integration-report.json lazyVerdict):
⑥ 懒协议形状(wh_ratio optional+lazy=True+check_lazy_status 实名)
⑦ check_lazy_status 行为四态+联动开×wh_ratio 未接线中文报错。

1001 S8 深审修复轮二增锁(⑧,L-5 计算侧防御):极端比例(宽高比 >
约 275251:1)建议值取整后含 0 → Q6 同款回退九型+中文警告+九型缺时
中文报错(实测 300000:1→(1149440,0)/1:1000000→(0,2098576);
原链 [155][156] 同式直出 0,本防御纯收紧)。

1001 用户测试批 P1 增锁(⑨⑩⑪,design §2.3 手动宽高槽三例):optional
手动宽/手动高(INT default 0/step 8/max 8192)——⑨回退序=非建议路手填
非 0 成对优先→九型(联动关与建议失败回退两路都走)⑩半填(恰一非 0)
中文报错不猜不代选(惰性:建议路正常时不判,PE 开隐藏控件残留半填不炸)
⑪缺省(0,0)/缺键=旧行为逐字节不变(i2i/edit 不接新槽=零波及)。
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
    result = MyQi21WhSuggest().suggest(联动开关=True, wh_ratio="16:9",
                                       九型WIDTH=_W, 九型HEIGHT=_H)
    assert result == (2800, 1576)  # 手验实跑 2800;4.208MP;均为 8 倍数
    assert all(isinstance(v, int) for v in result)
    assert result != (_W, _H)  # 建议路生效,不串九型


def test_ratio_1_1_suggests_square_pair():
    assert MyQi21WhSuggest().suggest(联动开关=True, wh_ratio="1:1",
                                     九型WIDTH=_W, 九型HEIGHT=_H) == (2096, 2096)


def test_ratio_9_16_suggests_portrait_pair():
    # 与①对称换位(原 [151][152] 取比次序=前段宽/尾段高,9:16 竖幅)
    assert MyQi21WhSuggest().suggest(联动开关=True, wh_ratio="9:16",
                                     九型WIDTH=_W, 九型HEIGHT=_H) == (1576, 2800)


# ── ④ 联动关:九型宽高原样直通(wh_ratio 合法也不消费) ────────────────
def test_linkage_off_passes_nine_type_through():
    node = MyQi21WhSuggest()
    # wh_ratio 合法("16:9")但联动关 → 建议 路 整条不走,九型原样
    assert node.suggest(联动开关=False, wh_ratio="16:9",
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # wh_ratio 非法且联动关 → 同样九型原样,不发警告(回退非因解析失败)
    assert node.suggest(联动开关=False, wh_ratio="abc",
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # 联动关+wh_ratio 未接线(lazy 化后可选态)→ 照样九型原样,不炸不猜
    assert node.suggest(联动开关=False, 九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
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
    assert node.suggest(联动开关=True, wh_ratio="abc",
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    out = capsys.readouterr().out
    assert "解析失败" in out and "回退" in out and "九型" in out  # 中文警告一条
    # 5b. 同场景九型槽也未接线 → 中文报错(无值可用,不猜)
    with pytest.raises(ValueError) as ei:
        node.suggest(联动开关=True, wh_ratio="abc")
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


# ── ⑥ 懒协议形状(1001 深审修复轮:wh_ratio lazy 化) ────────────────────
def test_lazy_protocol_shape():
    """wh_ratio 应 optional+lazy(执行器对该槽默认不建强依赖→联动关时不拉
    [140] 进执行图)+懒钩子实名 check_lazy_status(本版引擎 execution.py
    只认此名;SpeedSelect/合成器同款协议)。"""
    it = MyQi21WhSuggest.INPUT_TYPES()
    assert "wh_ratio" not in it["required"], \
        "wh_ratio 应移出 required(非懒必填槽=修前恒拉 [140] 的证违根因)"
    slot = it["optional"]["wh_ratio"]
    assert slot[0] == "STRING" and slot[1].get("lazy") is True, \
        f"wh_ratio 槽应 STRING+lazy=True,得 {slot}"
    assert hasattr(MyQi21WhSuggest, "check_lazy_status")


# ── ⑦ check_lazy_status 四态 + 联动开×未接线报错 ───────────────────────
def test_check_lazy_status_four_states():
    node = MyQi21WhSuggest()
    # 联动关 → 即便 wh_ratio 已接线未求值(None)也不请求([140] 不进执行图)
    assert node.check_lazy_status(联动开关=False, wh_ratio=None) == []
    # 联动开 × 已接线未求值(None) → 请求(引擎拉 [140] 产出 wh_ratio)
    assert node.check_lazy_status(联动开关=True, wh_ratio=None) == ["wh_ratio"]
    # 联动开 × 未接线(缺键) → 绝不请求(引擎对未接线槽建强链会抛 NodeInputError)
    assert node.check_lazy_status(联动开关=True) == []
    # 联动开 × 已求值(有值) → 不再请求
    assert node.check_lazy_status(联动开关=True, wh_ratio="16:9") == []


def test_linkage_on_without_wired_ratio_raises():
    """联动开×wh_ratio 未接线:中文报错不猜不代选(修前=必填槽验证层拒,
    lazy 化后该态可达,语义同为拒绝、报错面挪进节点)。"""
    node = MyQi21WhSuggest()
    with pytest.raises(ValueError) as ei:
        node.suggest(联动开关=True, 九型WIDTH=_W, 九型HEIGHT=_H)
    msg = str(ei.value)
    assert "联动开关" in msg and "wh_ratio" in msg and "未接线" in msg
    assert "不猜不代选" in msg


# ── ⑧ 极端比例零建议回退(S8 深审 L-5:计算侧防御,Q6 同款) ──────────
def test_extreme_ratio_zero_suggest_falls_back_with_warning(capsys):
    """宽高比 > 约 275251:1(=4.2*1024*1024/16)时 8 倍取整后建议出 0
    (本会话实算:300000:1→(1149440,0)/1:1000000→(0,2098576)/边界
    275251:1→(1101008,8) 不触发),下游空潜在执行期炸——归 Q6 回退
    九型原样+中文警告,产线不炸队列(原链 [155][156] 同式直出 0,
    本防御纯收紧,三档锚值行为不变)。"""
    node = MyQi21WhSuggest()
    # 横向极端(任务指定例):h 取整为 0 → 不抛,回退九型,中文警告一条
    assert node.suggest(联动开关=True, wh_ratio="300000:1",
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    out = capsys.readouterr().out
    assert "过于极端" in out and "回退" in out and "九型" in out
    # 纵向极端对称:w 取整为 0 → 同款回退
    assert node.suggest(联动开关=True, wh_ratio="1:1000000",
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    assert "过于极端" in capsys.readouterr().out
    # 对称防御:零建议且九型槽也未接线 → 中文报错(无值可用,不猜)
    with pytest.raises(ValueError) as ei:
        node.suggest(联动开关=True, wh_ratio="300000:1")
    msg = str(ei.value)
    assert "无值可用" in msg and "九型" in msg and "不猜不代选" in msg


# ── ⑨⑩⑪ 手动宽高槽(1001 用户测试批 P1,design §2.3 三例) ────────────
def test_manual_pair_takes_priority_over_nine_type():
    """⑨ 回退序=非建议路(联动关/建议失败)手填非 0 成对优先→九型:
    联动关+手填成对 → 手填直出(不串九型);联动开+解析失败回退路同款走
    手填(警告仍发,值不落九型)。"""
    node = MyQi21WhSuggest()
    # 联动关(pe 关=手动路,implement.md 步骤6 口径):手填成对优先于九型
    assert node.suggest(联动开关=False, 手动宽=2048, 手动高=1152,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (2048, 1152)
    # 建议失败回退路(Q6 解析失败)同款:手填成对优先,九型不串
    assert node.suggest(联动开关=True, wh_ratio="abc", 手动宽=2048, 手动高=1152,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (2048, 1152)
    # 极端比例零建议回退路同走手填(⑧ 的回退链升级后行为)
    assert node.suggest(联动开关=True, wh_ratio="300000:1",
                        手动宽=1536, 手动高=1536,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (1536, 1536)


def test_manual_half_filled_raises_chinese_error():
    """⑩ 半填(恰一非 0)=中文报错不猜不代选(不会替补 0/不拿九型补);
    惰性检测:建议路正常时半填残留不炸(PE 开时控件被 web 扩展隐藏,
    看不见的残留值不得炸产线)。"""
    node = MyQi21WhSuggest()
    # 只填宽
    with pytest.raises(ValueError) as ei:
        node.suggest(联动开关=False, 手动宽=2048, 手动高=0,
                     九型WIDTH=_W, 九型HEIGHT=_H)
    msg = str(ei.value)
    assert "只填了一个" in msg and "手动宽=2048" in msg and "手动高=0" in msg
    assert "不猜不代选" in msg
    # 只填高(对称)
    with pytest.raises(ValueError, match="只填了一个"):
        node.suggest(联动开关=False, 手动宽=0, 手动高=1152,
                     九型WIDTH=_W, 九型HEIGHT=_H)
    # 半填先于九型缺判(手填路需要时即报,不静默落九型)
    with pytest.raises(ValueError, match="只填了一个"):
        node.suggest(联动开关=False, 手动宽=2048, 手动高=0)
    # 惰性:建议路正常(联动开+wh_ratio 合法)→ 半填残留零影响,建议值直出
    assert node.suggest(联动开关=True, wh_ratio="16:9", 手动宽=2048, 手动高=0,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (2800, 1576)


def test_manual_slots_shape_and_zero_default_keeps_legacy():
    """⑪ 槽形状+缺省零行为:optional 手动宽/手动高 INT(default 0/min 0/
    max 8192/step 8);缺省(0,0)或缺键(None)→ 联动关恒九型原样=旧行为
    逐字节不变(i2i/edit 不接新槽零波及;向后兼容铁律)。"""
    it = MyQi21WhSuggest.INPUT_TYPES()
    assert set(it["optional"]) == {"wh_ratio", "九型WIDTH", "九型HEIGHT",
                                   "手动宽", "手动高"}
    for slot in ("手动宽", "手动高"):
        kind, opts = it["optional"][slot]
        assert kind == "INT", (slot, kind)
        assert opts["default"] == 0 and opts["min"] == 0
        assert opts["max"] == 8192 and opts["step"] == 8, (slot, opts)
    node = MyQi21WhSuggest()
    # 显式 0(=跟型哨兵):九型原样
    assert node.suggest(联动开关=False, 手动宽=0, 手动高=0,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # 缺键(引擎对未接线 optional 不投递):旧行为不变
    assert node.suggest(联动开关=False,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
    # 联动开+解析失败+手填 0+九型接线:回退九型(Q6 旧行为,含警告)
    assert node.suggest(联动开关=True, wh_ratio="abc", 手动宽=0, 手动高=0,
                        九型WIDTH=_W, 九型HEIGHT=_H) == (_W, _H)
