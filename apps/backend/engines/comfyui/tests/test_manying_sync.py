# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""manying_nodes 拷入链(plugin_manager.sync_manying_nodes)测试。"""

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


def test_sync_copies_source_into_custom_nodes(home):
    result = pm.sync_manying_nodes()
    target = home / "ComfyUI" / "custom_nodes" / pm.MANYING_DIR
    assert (target / "__init__.py").is_file()
    assert (target / "nodes" / "manying_prompt.py").is_file()
    assert result["copied"] >= 4
    assert not (target / "tests").exists()  # 测试不进引擎
    assert not list(target.rglob("__pycache__"))  # 缓存不进引擎
    assert pm.manying_sync_state()["synced"] is True


def test_sync_is_idempotent(home):
    pm.sync_manying_nodes()
    first = pm.sync_manying_nodes()
    assert first["copied"] >= 4  # 二次同步不炸不重复
