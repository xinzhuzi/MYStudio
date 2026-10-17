#!/usr/bin/env python3
"""qi21 两 fire 的「自动 · 按型」解析单测(1017 增档役;importlib 按路径加载,
零引擎发车——两 fire 均有 main guard,import 期不触 main/不发车)。

覆盖 resolve_speed_mode(speed, type_name) 全矩阵(fire 侧镜像=
my_qi21_speed_select.resolve_slot 同路由表):
- (AUTO, 设定卡/美宣)→「1 · 原生出图」直出;
- (AUTO, 人物/自由/None/'')→「0 · Turbo 8步」(型名空=按 Turbo 缺省安全侧);
- (三手动串, 任意型)→原样(手动档忽略型名);
- (未知串, 任意型)→原样(fail-closed:交引擎 /prompt combo 闭集报 400,不代选);
- 两模块(t2i/i2i)全矩阵一致(同路由表零漂移)。
"""
import importlib.util
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


def _load(fname: str, modname: str):
    spec = importlib.util.spec_from_file_location(modname, HERE / fname)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


T2I_FIRE = _load("qi21_t2i_workflow_fire.py", "qi21_t2i_fire_auto_1017")
I2I_FIRE = _load("qi21_i2i_workflow_fire.py", "qi21_i2i_fire_auto_1017")

AUTO = "自动 · 按型"
DIRECT = "1 · 原生出图"
TURBO = "0 · Turbo 8步"
VIGGLE = "2 · viggle"
MANUALS = (TURBO, DIRECT, VIGGLE)
UNKNOWN = "9 · 乱档"

# 全矩阵:自动档×型名六例 + 手动三串×三型 + 未知串
CASES = [
    (AUTO, "设定卡", DIRECT),
    (AUTO, "美宣", DIRECT),
    (AUTO, "人物", TURBO),
    (AUTO, "自由", TURBO),
    (AUTO, None, TURBO),
    (AUTO, "", TURBO),
    *[(m, tn, m) for m in MANUALS for tn in ("设定卡", "人物", None)],
    (UNKNOWN, "人物", UNKNOWN),
    (UNKNOWN, "设定卡", UNKNOWN),
]


@pytest.mark.parametrize("speed,type_name,want", CASES)
def test_t2i_resolve_matrix(speed, type_name, want):
    assert T2I_FIRE.resolve_speed_mode(speed, type_name) == want


@pytest.mark.parametrize("speed,type_name,want", CASES)
def test_i2i_resolve_matrix(speed, type_name, want):
    assert I2I_FIRE.resolve_speed_mode(speed, type_name) == want


def test_two_fires_matrix_identical():
    """两模块同输入同输出(全矩阵一致=同一路由表镜像,零漂移)。"""
    speeds = (AUTO, *MANUALS, UNKNOWN)
    type_names = ("设定卡", "美宣", "人物", "自由", "表情差分", None, "")
    for speed in speeds:
        for tn in type_names:
            assert T2I_FIRE.resolve_speed_mode(speed, tn) == \
                I2I_FIRE.resolve_speed_mode(speed, tn), \
                f"两 fire 解析漂移: ({speed!r}, {tn!r})"


def test_auto_string_glyph_locked():
    """档串码位锁:U+00B7 中点+双侧半角空格(防全角漂移),与节点件 AUTO_MODE
    同串;两 fire 常量一致。"""
    for fire in (T2I_FIRE, I2I_FIRE):
        assert fire.AUTO_MODE == "自动 · 按型"
        assert "·" in fire.AUTO_MODE and "\u00b7" == fire.AUTO_MODE[
            fire.AUTO_MODE.index("·")]
        assert fire.AUTO_DIRECT_TYPES == ("设定卡", "美宣")


def test_manual_and_unknown_passthrough_identity():
    """手动档/未知串=恒等函数(任何型名都不改写;--turbo/--tier 显式覆写语义
    由此保持:显式给的档就是生效档)。"""
    for fire in (T2I_FIRE, I2I_FIRE):
        for m in (*MANUALS, UNKNOWN):
            for tn in ("设定卡", "美宣", None, ""):
                assert fire.resolve_speed_mode(m, tn) is m
