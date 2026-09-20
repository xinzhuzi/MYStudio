# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available: see COMMERCIAL_LICENSE.md.
"""引擎实例锁(双 sidecar 互斥;09-09 风暴根修;09-14 身份校验+stop 释放)。"""

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


def _install_stub_manifest(home):
    # 已装态才走到锁检查(version+port 让 engine_installed 为真)
    home.mkdir(parents=True, exist_ok=True)
    (home / "manifest.json").write_text(json.dumps(
        {"schemaVersion": 1, "engine": {"version": "v0.34.6", "port": 17001}}), encoding="utf-8")
    cm._read_cache.clear()


def test_acquire_release_roundtrip(home):
    assert em.acquire_engine_lock("test-holder") is True
    holder = em.engine_lock_holder()
    assert holder is None  # 自己持有=非他者
    em.release_engine_lock()
    assert not em.engine_lock_path().exists()


def test_other_live_process_denies(home, monkeypatch):
    _install_stub_manifest(home)
    # 伪装成"活的漫影管理进程":身份校验打桩放行(真实验证在
    # test_reused_pid_lock_is_takeoverable / _pid_is_manager_process 单测)
    monkeypatch.setattr(em, "_pid_is_manager_process", lambda pid: True)
    em.acquire_engine_lock("other-sidecar")
    path = em.engine_lock_path()
    data = json.loads(path.read_text())
    data["pid"] = os.getppid() if os.getppid() != os.getpid() else 1
    path.write_text(json.dumps(data))
    assert em.engine_lock_holder() is not None
    with pytest.raises(em.EngineOpError, match="另一个漫影进程管理"):
        em.engine_manager().start_sync()
    # guard 让位判定:他者持有时守卫不拉起(逻辑在循环里,这里验 holder 原语)
    assert em.engine_lock_holder()["pid"] == data["pid"]


def test_reused_pid_lock_is_takeoverable(home):
    """09-14 P2:侧车退出后 pid 被无关进程复用——活但非漫影管理进程=可接管。

    旧实现只看 pid 存活,这里会假报「正被另一个漫影进程管理」卡死启动。
    """
    _install_stub_manifest(home)
    path = em.engine_lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # 活进程(pytest 父进程)但命令行不含 image_gen.main → 身份不匹配
    path.write_text(json.dumps(
        {"pid": os.getppid() if os.getppid() != os.getpid() else 1, "note": "old", "at": 0}))
    assert em.engine_lock_holder() is None
    assert em.acquire_engine_lock("new-holder") is True


def test_pid_identity_unavailable_falls_back_to_alive(home, monkeypatch):
    """ps 查不到命令行(平台差异):退回"活即持有"的保守旧行为,不误放行。"""
    _install_stub_manifest(home)
    monkeypatch.setattr(em, "_pid_command", lambda pid: "")
    path = em.engine_lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        {"pid": os.getppid() if os.getppid() != os.getpid() else 1, "note": "old", "at": 0}))
    assert em.engine_lock_holder() is not None


def test_pid_is_manager_process_matches_sidecar_command(monkeypatch):
    commands = {
        111: "/usr/bin/python3 -m image_gen.main --host 127.0.0.1 --port 17595",
        222: "/usr/bin/python3 -m pytest backend/tests",
    }
    monkeypatch.setattr(em, "_pid_command", lambda pid: commands.get(pid, ""))
    assert em._pid_is_manager_process(111) is True
    assert em._pid_is_manager_process(222) is False


def test_stop_releases_engine_lock(home):
    """09-14 P2:stop() 收尾释放锁——退出后不再恒留死锁文件。"""
    em.acquire_engine_lock("engine-manager")
    assert em.engine_lock_path().exists()
    result = em.engine_manager().stop()
    assert result["stopped"] is True
    assert not em.engine_lock_path().exists()


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


def test_lock_acquisition_is_serialized_before_metadata_publication(home, monkeypatch):
    """Two callers observing an empty file must not both become the owner."""
    import threading

    first_writing = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()
    results = {}
    monkeypatch.setattr(em.os, "getpid", threading.get_ident)
    monkeypatch.setattr(em, "_pid_alive", lambda pid: True)
    monkeypatch.setattr(em, "_pid_is_manager_process", lambda pid: True)

    def timestamp():
        if threading.current_thread().name == "first-owner":
            first_writing.set()
            assert release_first.wait(5)
        return 1

    monkeypatch.setattr(cm, "timestamp_ms", timestamp)

    def acquire(name):
        if name == "second":
            second_entered.set()
        results[name] = em.acquire_engine_lock(name)

    first = threading.Thread(target=acquire, args=("first",), name="first-owner")
    second = threading.Thread(target=acquire, args=("second",), name="second-owner")
    first.start()
    assert first_writing.wait(5)
    second.start()
    assert second_entered.wait(5)
    second.join(timeout=0.1)
    release_first.set()
    first.join(timeout=5)
    second.join(timeout=5)
    assert not first.is_alive() and not second.is_alive()
    assert results == {"first": True, "second": False}
    assert json.loads(em.engine_lock_path().read_text())["note"] == "first"


def test_lock_io_failure_refuses_ownership(home, monkeypatch):
    def unavailable():
        raise OSError("disk unavailable")
    monkeypatch.setattr(em, "engine_lock_path", unavailable)
    assert em.acquire_engine_lock("no-disk") is False


def test_start_refuses_failed_acquisition_before_probing_or_spawning(home, monkeypatch):
    _install_stub_manifest(home)
    mgr = em.EngineManager()
    probes = []
    monkeypatch.setattr(em, "acquire_engine_lock", lambda note: False)
    monkeypatch.setattr(mgr, "_orphan_is_comfyui", lambda port: probes.append(port) or True)
    monkeypatch.setattr(mgr, "_enable_guard", lambda: None)
    monkeypatch.setattr(mgr, "node_count", lambda: 0)
    with pytest.raises(em.EngineOpError, match="管理权"):
        mgr.start_sync()
    assert probes == []
