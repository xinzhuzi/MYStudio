# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""引擎实例锁(双 sidecar 互斥;09-09 风暴根修)。"""

from __future__ import annotations

import json
import os

import pytest

from engines.comfyui import engine_manager as em
from engines.comfyui import manifest as cm


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    yield tmp_path / "comfyui"
    cm._read_cache.clear()


def test_acquire_release_roundtrip(home):
    assert em.acquire_engine_lock("test-holder") is True
    holder = em.engine_lock_holder()
    assert holder is None  # 自己持有=非他者
    em.release_engine_lock()
    assert not em.engine_lock_path().exists()


def test_other_live_process_denies(home):
    # 已装态才走到锁检查(version+port 让 engine_installed 为真)
    home.mkdir(parents=True, exist_ok=True)
    (home / "manifest.json").write_text(json.dumps(
        {"schemaVersion": 1, "engine": {"version": "v0.34.6", "port": 17001}}), encoding="utf-8")
    cm._read_cache.clear()
    em.acquire_engine_lock("other-sidecar")
    # 伪装成他进程:锁文件 pid 改成活进程(当前 shell 的父进程)
    path = em.engine_lock_path()
    data = json.loads(path.read_text())
    data["pid"] = os.getppid() if os.getppid() != os.getpid() else 1
    path.write_text(json.dumps(data))
    assert em.engine_lock_holder() is not None
    with pytest.raises(em.EngineOpError, match="另一个漫影进程管理"):
        em.engine_manager().start_sync()
    # guard 让位判定:他者持有时守卫不拉起(逻辑在循环里,这里验 holder 原语)
    assert em.engine_lock_holder()["pid"] == data["pid"]


def test_stale_lock_taken_over(home):
    path = em.engine_lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"pid": 999_999_999, "note": "dead", "at": 0}))
    assert em.engine_lock_holder() is None  # 死 pid=无持有者
    assert em.acquire_engine_lock("new-holder") is True  # 可接管


def test_start_sync_without_engine_still_reaches_install_check(home):
    # 锁拦截发生在已装判定之后:未装时仍是「尚未安装」话术,不是锁话术
    with pytest.raises(em.EngineOpError, match="尚未安装"):
        em.engine_manager().start_sync()
