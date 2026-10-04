# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫数据位拷入链(plugin_manager.sync_daojie_data,1004 design §十六 Step1)测试。

三段式中段播种者:种子家四件(dev 真源家/装机固定位)→sha256 校验→引擎家
<comfy-home>/daojie-data/(幂等,与 my-styles-thumbs 平级)。门禁=§十六
Step1「单测(mock 家目录)」:MYSTUDIO_COMFYUI_HOME 指临时家+种子候选
monkeypatch 隔离(不依赖本机 /Applications 装机位)。
"""

from __future__ import annotations

import hashlib

import pytest

from engines.comfyui import manifest as cm
from engines.comfyui import plugin_manager as pm
from engines.comfyui.engine_manager import EngineOpError


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    yield tmp_path / "comfyui"
    cm._read_cache.clear()


@pytest.fixture()
def seed(tmp_path, monkeypatch):
    """隔离种子家:四件内容确定性写入,候选链只留它(免依赖本机装机位)。"""
    seed_dir = tmp_path / "seed" / "json"
    seed_dir.mkdir(parents=True)
    for i, fn in enumerate(pm.DAOJIE_DATA_FILES):
        (seed_dir / fn).write_text(f'{{"n": {i}}}', encoding="utf-8")
    monkeypatch.setattr(pm, "daojie_data_seed_candidates", lambda: [seed_dir])
    return seed_dir


def _sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_sync_seeds_engine_home_data_dir(home, seed):
    # 数据位=<comfy-home>/daojie-data(§十六定名,与 my-styles-thumbs 平级;
    # 不进 custom_nodes 代码区)
    assert pm.daojie_data_drifted() is True  # 空家=漂移
    result = pm.sync_daojie_data()
    target = home / "daojie-data"
    assert result["seed"] == str(seed)
    assert result["target"] == str(target)
    for fn in pm.DAOJIE_DATA_FILES:
        assert (target / fn).is_file(), f"数据位应已播种 {fn}"
        assert _sha(target / fn) == _sha(seed / fn)
    assert pm.daojie_data_drifted() is False  # 播种后不漂移


def test_sync_is_idempotent(home, seed):
    pm.sync_daojie_data()
    again = pm.sync_daojie_data()
    assert again["copied"] == 0  # 内容同种子=零重拷(启动链每拉起都跑不白拷)
    assert not list((home / "daojie-data").glob("*.tmp"))  # 半拷残件不登场


def test_drift_detected_and_repaired_on_tamper(home, seed):
    pm.sync_daojie_data()
    victim = home / "daojie-data" / pm.DAOJIE_DATA_FILES[0]
    victim.write_text('{"tampered": true}', encoding="utf-8")
    assert pm.daojie_data_drifted() is True
    result = pm.sync_daojie_data()
    assert result["copied"] == 1  # 只修被改的那件
    assert _sha(victim) == _sha(seed / pm.DAOJIE_DATA_FILES[0])


def test_drift_detected_on_missing_file(home, seed):
    pm.sync_daojie_data()
    (home / "daojie-data" / pm.DAOJIE_DATA_FILES[2]).unlink()
    assert pm.daojie_data_drifted() is True


def test_seed_missing_tolerated(tmp_path, monkeypatch):
    # 种子缺失容错(§十六 Step1):drifted=False 不拦启动;直接 sync=如实报错
    monkeypatch.delenv("MYSTUDIO_COMFYUI_HOME", raising=False)
    monkeypatch.setattr(
        pm, "daojie_data_seed_candidates",
        lambda: [tmp_path / "no-such-seed"])
    assert pm.daojie_data_seed_dir() is None
    assert pm.daojie_data_drifted() is False
    with pytest.raises(EngineOpError):
        pm.sync_daojie_data()


def test_default_seed_candidates_lead_with_truth_home():
    # 候选链首=dev 仓库真源家(§十六:种子=装机固定位 json 家四件;dev 仓内
    # 即真源家本身),且四件齐——test_prompt_source_single_truth 同清单口径
    first = pm.daojie_data_seed_candidates()[0]
    assert first.name == "json" and first.parent.name == "daojie_ink_guofeng"
    assert pm.daojie_data_seed_dir() == first
    for fn in pm.DAOJIE_DATA_FILES:
        assert (first / fn).is_file(), f"真源家应含 {fn}"


def test_node_chain_env_loud_degrade(monkeypatch, capsys, tmp_path):
    """节点候选链 env 纪律(§十六 Step2×MYSTUDIO_ART_SKILLS 先例):显式设置
    但文件不在=响亮降级原路返回,不偷偷滑落低层(否则错配 env 会静默读到
    仓库真源家/生产包)。dev 真源家在本仓恒在位——若滑落即断言红。"""
    from engines.comfyui.my_nodes.nodes import my_qi21_base
    bogus = tmp_path / "no-such-daojie-home"
    monkeypatch.setenv("MYSTUDIO_DAOJIE_DATA", str(bogus))
    got = my_qi21_base._daojie_data("qi21_bases.json")
    assert got == bogus / "qi21_bases.json"  # 原路返回缺失路径,不兜底真源家
    assert "MYSTUDIO_DAOJIE_DATA" in capsys.readouterr().out  # 响亮降级有指路
