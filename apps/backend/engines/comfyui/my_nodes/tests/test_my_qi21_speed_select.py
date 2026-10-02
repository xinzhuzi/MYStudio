# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21SpeedSelect 契约测试(0929 加速区并行化·方案 B 自研件;与
test_my_qi21_base.py 同目录同纪律,源码位 sidecar 零引擎依赖)。

锁:注册面(双表+类目+无旧名别名)/combo 闭集(三档精确串+首项=默认=
Fun-Acc 4步 1002 用户新令推翻 0929 拉齐重放裁定+档号随新序理顺=序位号
0/1/2+分隔符码位 U+00B7 防全角漂移)/三态选择各回各支路/
懒协议(三槽 lazy 声明+check_lazy_status 只请求「选中×已接线×未求值」槽,
绝不请求未接线槽——引擎对未接线槽 make_input_strong_link 抛
NodeInputError,graph.py:132-133)/未选档未接线容错(未选槽缺键或投
None 均不报错不请求)/选中档未接线中文报错(档名+槽名+已接线清单)/
未知档位枚举报错。旧→新档位串映射=任务档 research/slot-map.md §5。
"""

from __future__ import annotations

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes.my_qi21_speed_select import (
    DEFAULT_MODE, MODES, SPEED_MODES, MyQi21SpeedSelect, slot_for_mode)

# 三档哨兵 latent(支路身份标记;LATENT 真身是 dict,同形)
_FUNACC = {"branch": "funacc"}
_VIGGLE = {"branch": "viggle"}
_DIRECT = {"branch": "direct"}


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_speed_select():
    assert NODE_CLASS_MAPPINGS.get("MyQi21SpeedSelect") is MyQi21SpeedSelect
    assert NODE_DISPLAY_NAME_MAPPINGS["MyQi21SpeedSelect"] == \
        "Q2-1 加速档位(三选一·默认Fun-Acc 4步)"  # ⑱ 1002 默认档改 Fun-Acc(随档序重排同步)
    assert MyQi21SpeedSelect.CATEGORY == "my"  # 类目随包内现行目录(兄弟件同区)
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingQi21SpeedSelect" not in NODE_CLASS_MAPPINGS


# ── combo 闭集:三档精确串+首项=默认=Fun-Acc 4步(⑱ 1002 新令) ──────
def test_combo_closed_set_first_item_is_default_funacc():
    spec = MyQi21SpeedSelect.INPUT_TYPES()
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"mode"}
    assert set(spec["optional"]) == {"latent_funacc", "latent_viggle",
                                     "latent_direct"}
    combo = spec["required"]["mode"]
    assert isinstance(combo[0], list)
    # ⑱ 1002:FunAcc 提首=默认(推翻 0929 拉齐重放);档号前导数字随新序理顺
    # =序位号 0/1/2(旧 0=直出/2=Fun-Acc/1=viggle 系旧 [30] 档位号口径废止)
    assert combo[0] == ["0 · Fun-Acc 4步", "1 · 直出40步", "2 · viggle"]
    assert combo[1]["default"] == "0 · Fun-Acc 4步"  # 首项=默认=Fun-Acc 4步
    assert DEFAULT_MODE == MODES[0] == "0 · Fun-Acc 4步"
    # 分隔符码位锁:U+00B7 中点(防誊写漂移成全角·/・——combo 列表即契约)
    for mode in MODES:
        assert " \u00b7 " in mode, mode
    # 档位↔槽名单源映射全覆盖(combo 序=默认优先,档号=序位号)
    assert [s for _m, s in SPEED_MODES] == ["latent_funacc", "latent_direct",
                                            "latent_viggle"]
    assert slot_for_mode("0 · Fun-Acc 4步") == "latent_funacc"
    assert slot_for_mode("1 · 直出40步") == "latent_direct"
    assert slot_for_mode("2 · viggle") == "latent_viggle"
    assert slot_for_mode("不存在的档") is None


def test_output_shape_and_three_lazy_slots():
    assert MyQi21SpeedSelect.RETURN_TYPES == ("LATENT",)
    assert MyQi21SpeedSelect.RETURN_NAMES == ("latent",)
    assert MyQi21SpeedSelect.FUNCTION == "select"
    optional = MyQi21SpeedSelect.INPUT_TYPES()["optional"]
    for slot in ("latent_funacc", "latent_viggle", "latent_direct"):
        assert optional[slot][0] == "LATENT"
        assert optional[slot][1].get("lazy") is True  # 懒声明=未选支路零执行零加载


# ── 三态选择:各档回各支路 ──────────────────────────────────
@pytest.mark.parametrize("mode,branch", [
    ("0 · Fun-Acc 4步", _FUNACC),
    ("1 · 直出40步", _DIRECT),
    ("2 · viggle", _VIGGLE),
])
def test_select_routes_each_mode_branch(mode, branch):
    node = MyQi21SpeedSelect()
    result = node.select(mode, latent_funacc=_FUNACC, latent_viggle=_VIGGLE,
                         latent_direct=_DIRECT)
    assert result == (branch,)  # 原样直通(同对象引用,不拷贝不改写)
    assert result[0] is branch


def test_select_default_mode_picks_funacc_branch():
    """默认档(Fun-Acc 4步,⑱ 1002)全接线直通:仅接 funacc 一槽即可走通
    (其余两档缺键容错)。"""
    result = MyQi21SpeedSelect().select(DEFAULT_MODE, latent_funacc=_FUNACC)
    assert result == (_FUNACC,)


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
        "1 · 直出40步", latent_funacc=None, latent_viggle=None) is None
    assert node.check_lazy_status(
        "0 · Fun-Acc 4步", latent_viggle=None, latent_direct=None) is None
    # mode 缺席/未知 → 不请求(select 兜底报错)
    assert node.check_lazy_status() is None
    assert node.check_lazy_status("3 · 不存在", latent_funacc=None) is None


def test_lazy_engine_protocol_matrix():
    """全档×全接线态穷举:钩子请求名单恒⊆{选中档槽}且不含未接线槽。"""
    node = MyQi21SpeedSelect()
    for mode, selected_slot in SPEED_MODES:
        for slot in ("latent_funacc", "latent_viggle", "latent_direct"):
            for presence in ("absent", "none", "valued"):
                kwargs = {}
                if presence == "none":
                    kwargs[slot] = None
                elif presence == "valued":
                    kwargs[slot] = {"branch": slot}
                need = node.check_lazy_status(mode, **kwargs)
                if need is None:
                    continue
                assert need == [selected_slot], (mode, slot, presence, need)
                assert presence == "none", (mode, slot, presence)  # 只请求未求值槽


# ── 未选档未接线容错:select 不因未选槽缺席/None 报错 ──────────
def test_unselected_unwired_slots_tolerated():
    node = MyQi21SpeedSelect()
    # 画布常态 A:仅选中支路接线,其余两槽完全未接(缺键)
    assert node.select("0 · Fun-Acc 4步", latent_funacc=_FUNACC) == (_FUNACC,)
    # 画布常态 B:未选支路已接线但未求值(执行器投 None 进 select)——
    # 选中支路照常路由,未选槽的 None 一概忽略
    assert node.select("0 · Fun-Acc 4步", latent_funacc=_FUNACC,
                       latent_direct=None, latent_viggle=None) == (_FUNACC,)


# ── 选中档未接线:明确中文报错文案 ───────────────────────────
def test_selected_but_unwired_raises_clear_message():
    node = MyQi21SpeedSelect()
    with pytest.raises(ValueError) as ei:
        node.select("0 · Fun-Acc 4步")  # 选中档未接线,其余档也未接
    msg = str(ei.value)
    assert "0 · Fun-Acc 4步" in msg and "latent_funacc" in msg
    assert "已接线的档位:无" in msg
    assert "连到本节点" in msg  # 修复指引


def test_selected_but_unwired_error_lists_wired_modes():
    node = MyQi21SpeedSelect()
    with pytest.raises(ValueError, match="已接线的档位:2 · viggle"):
        node.select("0 · Fun-Acc 4步", latent_viggle=_VIGGLE)  # 接错档=指路切档
    with pytest.raises(ValueError, match="已接线的档位:1 · 直出40步、2 · viggle"):
        node.select("0 · Fun-Acc 4步", latent_direct=None,
                    latent_viggle=_VIGGLE)  # 缺键=未接线,None=已接线未求值,都算在册(清单纯按 SPEED_MODES 档序)


# ── 未知档位:枚举报错(combo 闭集的节点内兜底;/prompt 侧另有硬校验)──
def test_unknown_mode_raises_with_options():
    with pytest.raises(ValueError, match="未知加速档位") as ei:
        MyQi21SpeedSelect().select("11", latent_direct=_DIRECT)
    assert "0 · Fun-Acc 4步" in str(ei.value)  # 报错枚举全部合法档位
