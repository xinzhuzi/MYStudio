# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available: see COMMERCIAL_LICENSE.md.
"""停止与并发启动的竞态根修(09-14 生命周期审计 P1)。

病灶:崩溃守卫的 start_sync 冷启动健康等待最长 120s,期间用户 stop() 只在
_lock 下摘旧引用,守卫/启动线程照常 spawn+转正=「停止后引擎复活」。
修法:停止代数计数器——stop() 自增,start_sync 捕获后在健康等待循环核对,
变了=中止并回收;守卫拉起额外受 spawn 提交时的守卫在岗检查(免 stop 后
过检窗口复活)。零真进程:Popen/健康探针/watchdog/杀进程全打桩。
"""
from __future__ import annotations

import json
import threading
import time

import pytest

from engines.comfyui import engine_manager as em
from engines.comfyui import manifest as cm


@pytest.fixture()
def home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    cm._read_cache.clear()
    home.mkdir(parents=True, exist_ok=True)
    (home / "manifest.json").write_text(json.dumps(
        {"schemaVersion": 1, "engine": {"version": "v0.34.6", "port": 17001}}), encoding="utf-8")
    cm._read_cache.clear()
    src = cm.engine_source_dir()
    src.mkdir(parents=True, exist_ok=True)
    (src / "main.py").write_text("# stub\n", encoding="utf-8")
    yield home
    cm._read_cache.clear()


class FakeProc:
    def poll(self):
        return None


def _stub_spawn_path(monkeypatch, mgr, popen):
    monkeypatch.setattr(em, "resolve_launch_port", lambda *a, **k: 17001)
    monkeypatch.setattr(mgr, "_orphan_is_comfyui", lambda port: False)
    monkeypatch.setattr(em.subprocess, "Popen", popen)
    monkeypatch.setattr(em, "_spawn_engine_watchdog", lambda *a: None)
    monkeypatch.setattr(mgr, "is_healthy", lambda port=None, timeout=2.0: True)
    monkeypatch.setattr(mgr, "_enable_guard", lambda: None)
    monkeypatch.setattr(mgr, "node_count", lambda: 0)
    monkeypatch.setattr(em, "_write_extra_model_paths", lambda *a: None)


def test_stop_during_startup_health_aborts_start(home, monkeypatch):
    """健康等待期用户 stop:启动线程立即中止报「被取消」,引擎被回收。"""
    mgr = em.EngineManager()
    spawn_count = {"n": 0}
    killed = []

    def popen(*_argv, **_kw):
        spawn_count["n"] += 1
        return FakeProc()

    _stub_spawn_path(monkeypatch, mgr, popen)

    gate = threading.Event()

    def slow_health(port=None, timeout=2.0):
        if port is not None:
            gate.wait(10)  # 卡住健康等待(await 循环带口调用),等主线程 stop 插队
        return False  # 恒不健康:循环醒来进下一轮 → 代数核对触发中止

    monkeypatch.setattr(mgr, "is_healthy", slow_health)
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: killed.append(proc))

    errors = []

    def starter():
        try:
            mgr.start_sync()
        except Exception as exc:  # noqa: BLE001 测试收集任意失败
            errors.append(exc)

    thread = threading.Thread(target=starter)
    thread.start()
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and mgr._proc is None:
        time.sleep(0.05)
    assert mgr._proc is not None, "spawn 应已提交并进入健康等待"

    mgr.stop()  # 用户点停止
    gate.set()  # 放行健康等待
    thread.join(timeout=10)

    assert not thread.is_alive()
    assert errors and "停止" in str(errors[0])
    assert spawn_count["n"] == 1
    assert killed and isinstance(killed[0], FakeProc), "并发停止回收刚 spawn 的引擎"
    assert mgr._proc is None
    assert mgr._running_port is None


def test_await_health_abort_branch_reclaims_untracked_spawn(home, monkeypatch):
    """中止分支直达:stop 先行、spawn 提交在后的时序,等待循环里回收新引擎。"""
    mgr = em.EngineManager()
    mgr._proc = FakeProc()
    mgr._running_port = 17001
    killed = []
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: killed.append(proc))
    monkeypatch.setattr(mgr, "is_healthy", lambda port=None, timeout=2.0: False)

    mgr._stop_generation = 5  # stop 已发生(代数前移)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr._await_startup_health(17001, stop_generation=4)

    assert killed and isinstance(killed[0], FakeProc)
    assert mgr._proc is None
    assert mgr._running_port is None


def test_guard_restart_refused_after_user_stop(home, monkeypatch):
    """守卫过检后用户 stop:守卫的拉起在 spawn 提交处被拒,不再复活引擎。"""
    mgr = em.EngineManager()
    spawn_count = {"n": 0}

    def popen(*_argv, **_kw):
        spawn_count["n"] += 1
        return FakeProc()

    _stub_spawn_path(monkeypatch, mgr, popen)

    mgr._guard_enabled = False  # 模拟用户 stop 已关守卫(守卫决策在先的窗口)
    with pytest.raises(em.EngineOpError, match="手动停止"):
        mgr.start_sync(from_guard=True)
    assert spawn_count["n"] == 0, "守卫拉起被拒,不应 spawn"

    # 非守卫来源(用户显式启动/生图链 ensure)不受该门拦截
    mgr.start_sync()
    assert spawn_count["n"] == 1


def test_restart_flow_still_works_after_stop_generation(home, monkeypatch):
    """restart()=stop()+start_sync():自身停止不误伤紧随的启动(代数捕获在 stop 之后)。"""
    mgr = em.EngineManager()
    spawn_count = {"n": 0}

    def popen(*_argv, **_kw):
        spawn_count["n"] += 1
        return FakeProc()

    _stub_spawn_path(monkeypatch, mgr, popen)

    result = mgr.restart()  # stop → sleep(1) → start_sync(from_guard=False)
    assert result["running"] is True
    assert spawn_count["n"] == 1
