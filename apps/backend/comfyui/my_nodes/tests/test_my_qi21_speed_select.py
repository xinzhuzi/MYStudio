# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21SpeedSelect 契约测试(0929 加速区并行化·方案 B 自研件;与
test_my_qi21_base.py 同目录同纪律,源码位 sidecar 零引擎依赖)。

锁:注册面(双表+类目+无旧名别名)/combo 闭集(1017 增档令+1023 E混动增档:五档精确串,
首项=默认=「0 · Turbo 8步」(1021 用户令,所有型均走 Turbo);自动档居末且
仍按型名∈{设定卡,美宣,概念气氛图}→原生出图,其余含空→Turbo;
手动档字符串不变;分隔符码位 U+00B7 防全角漂移;自动档
配 optional「型名」STRING 信号槽,非 lazy)/三态选择各回各支路/
懒协议(三槽 lazy 声明+check_lazy_status 只请求「选中×已接线×未求值」槽,
绝不请求未接线槽——引擎对未接线槽 make_input_strong_link 抛
NodeInputError,graph.py:132-133)/未选档未接线容错(未选槽缺键或投
None 均不报错不请求)/选中档未接线中文报错(档名+槽名+已接线清单)/
未知档位枚举报错。旧→新档位串映射=任务档 research/slot-map.md §5。
"""

from __future__ import annotations

import pytest

from comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from comfyui.my_nodes.nodes.my_qi21_base import bases_list
from comfyui.my_nodes.nodes.my_qi21_speed_select import (
    AUTO_MODE,
    DEFAULT_MODE,
    MODES,
    SPEED_MODES,
    MyQi21SpeedSelect,
    slot_for_mode,
)

# 三档哨兵 latent(支路身份标记;LATENT 真身是 dict,同形)
_TURBO = {"branch": "turbo"}
_VIGGLE = {"branch": "viggle"}
_DIRECT = {"branch": "direct"}
_E = {"branch": "e"}
_TYPE_INPUTS = [*bases_list(), "", None, ...]


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_speed_select():
    assert NODE_CLASS_MAPPINGS.get("MyQi21SpeedSelect") is MyQi21SpeedSelect
    assert NODE_DISPLAY_NAME_MAPPINGS["MyQi21SpeedSelect"] == \
        "Q2-1 加速档位(四选一·默认Turbo 8步)"  # 1016turbo 换臂官方 Turbo(承 1002 提首位)
    assert MyQi21SpeedSelect.CATEGORY == "漫影"  # 类目随包内现行目录(兄弟件同区)
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingQi21SpeedSelect" not in NODE_CLASS_MAPPINGS


# ── combo 闭集:四档精确串+首项=默认 Turbo,自动档仍可手选 ──────
def test_combo_closed_set_first_item_is_default_turbo():
    """新建节点默认 Turbo;显式手动档及自动档仍属同一闭集。"""
    spec = MyQi21SpeedSelect.INPUT_TYPES()
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"mode"}
    assert set(spec["optional"]) == {"latent_turbo", "latent_viggle",
                                     "latent_direct", "型名", "latent_e"}
    # 1017:型名=自动档信号槽(STRING 非 lazy,接底座件「型名」出;未接线/
    # 留空=按 Turbo 缺省安全侧)
    assert spec["optional"]["型名"][0] == "STRING"
    assert not spec["optional"]["型名"][1].get("lazy")
    combo = spec["required"]["mode"]
    assert isinstance(combo[0], list)
    assert combo[0] == ["0 · Turbo 8步", "1 · 原生出图", "2 · viggle",
                        "3 · 混动 40步+缓存", "自动 · 按型"]
    assert combo[1]["default"] == "0 · Turbo 8步"
    assert DEFAULT_MODE == MODES[0] == "0 · Turbo 8步"
    assert MODES[-1] == AUTO_MODE
    # 分隔符码位锁:U+00B7 中点(防誊写漂移成全角·/・——combo 列表即契约)
    for mode in MODES:
        assert " \u00b7 " in mode, mode
    # 档位↔槽名单源映射全覆盖(自动档无固有槽=位 None,实际槽按型名现算;
    # 手动档 combo 序=默认优先,档号=序位号)
    assert [s for _m, s in SPEED_MODES] == ["latent_turbo", "latent_direct",
                                          "latent_viggle", "latent_e", None]
    assert slot_for_mode("自动 · 按型") is None  # 自动档不经 slot_for_mode(按型名现算)
    assert slot_for_mode("0 · Turbo 8步") == "latent_turbo"
    assert slot_for_mode("1 · 原生出图") == "latent_direct"
    assert slot_for_mode("2 · viggle") == "latent_viggle"
    assert slot_for_mode("3 · 混动 40步+缓存") == "latent_e"  # 1023 E混动档
    assert slot_for_mode("不存在的档") is None


def test_output_shape_and_three_lazy_slots():
    assert MyQi21SpeedSelect.RETURN_TYPES == ("LATENT",)
    assert MyQi21SpeedSelect.RETURN_NAMES == ("latent",)
    assert MyQi21SpeedSelect.FUNCTION == "select"
    optional = MyQi21SpeedSelect.INPUT_TYPES()["optional"]
    for slot in ("latent_turbo", "latent_viggle", "latent_direct", "latent_e"):
        assert optional[slot][0] == "LATENT"
        assert optional[slot][1].get("lazy") is True  # 懒声明=未选支路零执行零加载


# ── 三态选择:各档回各支路 ──────────────────────────────────
@pytest.mark.parametrize("mode,branch", [
    ("0 · Turbo 8步", _TURBO),
    ("1 · 原生出图", _DIRECT),
    ("2 · viggle", _VIGGLE),
    ("3 · 混动 40步+缓存", _E),
])
def test_select_routes_each_mode_branch(mode, branch):
    node = MyQi21SpeedSelect()
    result = node.select(mode, latent_turbo=_TURBO, latent_viggle=_VIGGLE,
                         latent_direct=_DIRECT, latent_e=_E)
    assert result == (branch,)  # 原样直通(同对象引用,不拷贝不改写)
    assert result[0] is branch


@pytest.mark.parametrize("type_name", _TYPE_INPUTS)
def test_select_default_mode_picks_turbo_branch(type_name):
    """全部十型/自由/空/缺键默认只接 Turbo 也可直通。"""
    kwargs = {} if type_name is ... else {"型名": type_name}
    result = MyQi21SpeedSelect().select(DEFAULT_MODE, latent_turbo=_TURBO, **kwargs)
    assert result == (_TURBO,)
    assert result[0] is _TURBO


@pytest.mark.parametrize("type_name", _TYPE_INPUTS)
def test_default_lazy_requests_only_turbo_for_every_type(type_name):
    kwargs = {} if type_name is ... else {"型名": type_name}
    node = MyQi21SpeedSelect()
    assert node.check_lazy_status(
        DEFAULT_MODE, latent_turbo=None, latent_direct=None, latent_viggle=None,
        **kwargs) == ["latent_turbo"]
    assert node.check_lazy_status(
        DEFAULT_MODE, latent_turbo=_TURBO, latent_direct=None, latent_viggle=None,
        **kwargs) is None
    assert node.check_lazy_status(
        DEFAULT_MODE, latent_direct=None, latent_viggle=None, **kwargs) is None


@pytest.mark.parametrize("type_name", _TYPE_INPUTS)
def test_explicit_auto_keeps_type_routing(type_name):
    kwargs = {} if type_name is ... else {"型名": type_name}
    direct = type_name in ("设定卡", "美宣", "概念气氛图")
    branch = _DIRECT if direct else _TURBO
    slot = "latent_direct" if direct else "latent_turbo"
    node = MyQi21SpeedSelect()
    assert node.select(AUTO_MODE, latent_turbo=_TURBO, latent_direct=_DIRECT,
                       latent_viggle=_VIGGLE, **kwargs)[0] is branch
    assert node.check_lazy_status(
        AUTO_MODE, latent_turbo=None, latent_direct=None, latent_viggle=None,
        **kwargs) == [slot]


# ── 懒裁剪返回值:check_lazy_status 只请求「选中×已接线×未求值」槽 ──
def test_check_lazy_status_requests_selected_wired_unevaluated():
    node = MyQi21SpeedSelect()
    # 选中档已接线未求值(执行器投 None)→ 请求该槽(引擎据此拉起该支路)
    assert node.check_lazy_status("2 · viggle", latent_viggle=None) == ["latent_viggle"]
    # 选中档已接线已求值 → 不再请求(放行执行)
    assert node.check_lazy_status("2 · viggle", latent_viggle=_VIGGLE) is None
    # 选中档未接线(kwargs 缺键)→ 绝不请求(引擎对未接线槽
    # make_input_strong_link 抛 NodeInputError;放行进 select 报人话)
    assert node.check_lazy_status("2 · viggle") is None
    # 未选档槽已接线未求值 → 一概不请求(未选支路不进执行图=懒裁剪本体)
    assert node.check_lazy_status(
        "1 · 原生出图", latent_turbo=None, latent_viggle=None) is None
    assert node.check_lazy_status(
        "0 · Turbo 8步", latent_viggle=None, latent_direct=None) is None
    # mode 缺席/未知 → 不请求(select 兜底报错)
    assert node.check_lazy_status() is None
    assert node.check_lazy_status("3 · 不存在", latent_turbo=None) is None


def test_lazy_engine_protocol_matrix():
    """全档×全接线态穷举:钩子请求名单恒⊆{选中档槽}且不含未接线槽。
    1017:自动档无固有槽(SPEED_MODES 槽位 None)——期望槽=按型名现算
    (型名∈{设定卡,美宣,概念气氛图}→latent_direct,其余含空/缺键→latent_turbo
    缺省安全侧);型名维四态(缺键/空串/直出三型/其余型)只对自动档展开,
    手动档忽略型名(直查固有槽,与 select 同源零漂移)。"""
    node = MyQi21SpeedSelect()
    rows = []  # (mode, 期望选中槽, 型名 kwargs 值或哨兵__ABSENT__)
    for mode, slot in SPEED_MODES:
        if slot is None:   # 自动档:型名五态展开(缺键=未接线/空串/直出三型/其余型)
            for tn in (..., "", "设定卡", "美宣", "概念气氛图", "人物"):
                rows.append((mode, "latent_direct" if tn in ("设定卡", "美宣", "概念气氛图")
                             else "latent_turbo", tn))
        else:              # 手动档:固有槽,型名缺席(不投递)
            rows.append((mode, slot, ...))
    for mode, expected, tn in rows:
        for slot in ("latent_turbo", "latent_viggle", "latent_direct", "latent_e"):
            for presence in ("absent", "none", "valued"):
                kwargs = {}
                if presence == "none":
                    kwargs[slot] = None
                elif presence == "valued":
                    kwargs[slot] = {"branch": slot}
                if tn is not ...:
                    kwargs["型名"] = tn
                need = node.check_lazy_status(mode, **kwargs)
                if need is None:
                    continue
                assert need == [expected], (mode, slot, presence, tn, need)
                assert presence == "none", (mode, slot, presence, tn)  # 只请求未求值槽


# ── 未选档未接线容错:select 不因未选槽缺席/None 报错 ──────────
def test_unselected_unwired_slots_tolerated():
    node = MyQi21SpeedSelect()
    # 画布常态 A:仅选中支路接线,其余两槽完全未接(缺键)
    assert node.select("0 · Turbo 8步", latent_turbo=_TURBO) == (_TURBO,)
    # 画布常态 B:未选支路已接线但未求值(执行器投 None 进 select)——
    # 选中支路照常路由,未选槽的 None 一概忽略
    assert node.select("0 · Turbo 8步", latent_turbo=_TURBO,
                       latent_direct=None, latent_viggle=None) == (_TURBO,)


# ── 选中档未接线:明确中文报错文案 ───────────────────────────
def test_selected_but_unwired_raises_clear_message():
    node = MyQi21SpeedSelect()
    with pytest.raises(ValueError) as ei:
        node.select("0 · Turbo 8步")  # 选中档未接线,其余档也未接
    msg = str(ei.value)
    assert "0 · Turbo 8步" in msg and "latent_turbo" in msg
    assert "已接线的档位:无" in msg
    assert "连到本节点" in msg  # 修复指引


def test_selected_but_unwired_error_lists_wired_modes():
    node = MyQi21SpeedSelect()
    with pytest.raises(ValueError, match="已接线的档位:2 · viggle"):
        node.select("0 · Turbo 8步", latent_viggle=_VIGGLE)  # 接错档=指路切档
    with pytest.raises(ValueError, match="已接线的档位:1 · 原生出图、2 · viggle"):
        node.select("0 · Turbo 8步", latent_direct=None,
                    latent_viggle=_VIGGLE)  # 缺键=未接线,None=已接线未求值,都算在册(清单纯按 SPEED_MODES 档序)


# ── 未知档位:枚举报错(combo 闭集的节点内兜底;/prompt 侧另有硬校验)──
def test_unknown_mode_raises_with_options():
    with pytest.raises(ValueError, match="未知加速档位") as ei:
        MyQi21SpeedSelect().select("11", latent_direct=_DIRECT)
    assert "0 · Turbo 8步" in str(ei.value)  # 报错枚举全部合法档位
