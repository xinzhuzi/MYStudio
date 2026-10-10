# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""第三方 custom_nodes 种子链(plugin_manager.sync_seeded_custom_nodes)测试。

1010 立:viggle-turbo 等无上游仓库的本地件,引擎家重建即蒸发——种子随包
(resources backend 平铺)→ spawn 前漂移补投,照 my_nodes 拷入链同款测试。
"""

from __future__ import annotations

import pytest

from engines.comfyui import manifest as cm
from engines.comfyui import plugin_manager as pm


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    yield tmp_path / "comfyui"
    cm._read_cache.clear()


def test_seeded_names_list_viggle():
    """种子家在册件含 viggle-turbo(仓库种子位随包,dev checkout 恒可见)。"""
    names = pm.seeded_custom_node_names()
    assert "viggle-turbo" in names


def test_sync_seeds_into_custom_nodes(home):
    """空引擎家:种子件硬拷到 custom_nodes/<件名>,两 .py 齐、缓存不进引擎。"""
    result = pm.sync_seeded_custom_nodes()
    target = home / "ComfyUI" / "custom_nodes" / "viggle-turbo"
    assert "viggle-turbo" in result["synced"]
    assert result["failed"] == []
    assert (target / "__init__.py").is_file()
    assert (target / "viggle_turbo.py").is_file()
    assert not list(target.rglob("__pycache__"))  # 缓存不进引擎


def test_sync_is_idempotent(home):
    pm.sync_seeded_custom_nodes()
    second = pm.sync_seeded_custom_nodes()
    assert "viggle-turbo" in second["synced"]  # 二次同步不炸不重复
    assert second["failed"] == []


def test_drift_gate(home):
    """漂移判据:缺位=漂移;同步后=不漂移;运行位改动/多余件=漂移;
    __pycache__ 字节码不计(引擎跑过不等于漂移,免每拉起白拷)。"""
    assert pm.seeded_custom_nodes_drifted() is True  # 引擎家尚无种子件
    pm.sync_seeded_custom_nodes()
    assert pm.seeded_custom_nodes_drifted() is False
    cache = home / "ComfyUI" / "custom_nodes" / "viggle-turbo" / "__pycache__"
    cache.mkdir()
    (cache / "viggle_turbo.cpython-312.pyc").write_bytes(b"bytecode")
    assert pm.seeded_custom_nodes_drifted() is False  # 缓存字节不计
    (home / "ComfyUI" / "custom_nodes" / "viggle-turbo" / "viggle_turbo.py").write_text(
        "# locally patched", encoding="utf-8")
    assert pm.seeded_custom_nodes_drifted() is True  # 运行位改动=漂移(种子是真源)


def test_seed_dirs_exempt_from_orphan_cleanup(home):
    """孤儿防线:种子件无台账无 .git,不豁免即被 doctor 误报+清理误删。"""
    assert pm._is_managed_nodes_dir("viggle-turbo") is True
    assert pm._is_managed_nodes_dir("my-nodes") is True  # 原有豁免不回归
    assert pm._is_managed_nodes_dir("some-random-plugin") is False
