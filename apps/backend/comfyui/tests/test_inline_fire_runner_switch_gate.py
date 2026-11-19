"""inline_fire_runner_1118 双开关注入门单测(1119 双档役,任务 2①)。

被测=apps/build/scripts/inline_fire_runner_1118.py::inject_switches 纯函数:
  ① 5111 可注入(--hd→g["5111"].value=true;1118 现状只注 1065,5111 残值透传)
  ② 四态联动校验:1065=false ∧ 5111=true=非法态(高清段被计算却在 5100 被丢弃=
     静默剪枝,README 9999 刻碑)→ 拒发「高清修脸需先开修脸总开关(1065)」
     ——含 config 自带 5111=true 而 state=bypass 的残值态(发车器对终图状态负责)
  ③ config 缺 5111(非 1119 双档臂模板)开 --hd → 拒发缺节点
零引擎依赖纯函数;实弹面(AC1/AC2)不在本测试。
"""
from __future__ import annotations

import importlib.util
import pathlib

_TESTS = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS.parents[3]
_RUNNER = _REPO / "apps/build/scripts/inline_fire_runner_1118.py"

_spec = importlib.util.spec_from_file_location("inline_fire_runner_1118", _RUNNER)
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)


def _graph(hd_default: bool = False, with_5111: bool = True) -> dict:
    g = {"1065": {"class_type": "PrimitiveBoolean", "inputs": {"value": False}},
         "25": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "x"}}}
    if with_5111:
        g["5111"] = {"class_type": "PrimitiveBoolean", "inputs": {"value": hd_default}}
    return g


def test_illegal_combo_rejected_exact_message():
    """非法组合拒:--hd(bypass 态)→ 1065=false ∧ 5111=true,报文逐字。"""
    g = _graph()
    err = runner.inject_switches(g, "bypass", hd=True)
    assert err == "高清修脸需先开修脸总开关(1065)", f"拒发报文逐字不符: {err!r}"


def test_config_native_illegal_state_rejected():
    """config 残值态拒:模板自带 5111=true 而 state=bypass(未开 --hd)同非法态。"""
    g = _graph(hd_default=True)
    err = runner.inject_switches(g, "bypass", hd=False)
    assert err == "高清修脸需先开修脸总开关(1065)", f"残值态须拒: {err!r}"


def test_hd_on_config_without_5111_rejected():
    """config 缺 5111(非双档臂模板)开 --hd → 拒发缺节点。"""
    g = _graph(with_5111=False)
    err = runner.inject_switches(g, "repair", hd=True)
    assert err is not None and "缺节点 5111" in err


def test_legal_states_pass_and_inject_values():
    """三合法态放行+注入值落位:bypass 双 False / repair 远景(5111=False)/ repair+hd 高清。"""
    g = _graph()
    assert runner.inject_switches(g, "bypass", hd=False) is None
    assert g["1065"]["inputs"]["value"] is False and g["5111"]["inputs"]["value"] is False

    g = _graph()
    assert runner.inject_switches(g, "repair", hd=False) is None
    assert g["1065"]["inputs"]["value"] is True and g["5111"]["inputs"]["value"] is False

    g = _graph()
    assert runner.inject_switches(g, "repair", hd=True) is None
    assert g["1065"]["inputs"]["value"] is True and g["5111"]["inputs"]["value"] is True


def test_no_5111_legacy_config_still_fires():
    """1118 旧模板(无 5111 键)不开 --hd 照常放行(向后兼容,1065 注入不受影响)。"""
    g = _graph(with_5111=False)
    assert runner.inject_switches(g, "repair", hd=False) is None
    assert g["1065"]["inputs"]["value"] is True


def test_hd_normalizes_true_over_false_default():
    """--hd 显式注入覆盖出厂 False(注入语义:flag 即终值,非 OR)。"""
    g = _graph(hd_default=False)
    assert runner.inject_switches(g, "repair", hd=True) is None
    assert g["5111"]["inputs"]["value"] is True
