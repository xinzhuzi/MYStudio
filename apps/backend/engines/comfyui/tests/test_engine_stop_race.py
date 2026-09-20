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
    stopped = False

    def poll(self):
        return 0 if self.stopped else None


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
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: (killed.append(proc), setattr(proc, "stopped", True)))

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
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: (killed.append(proc), setattr(proc, "stopped", True)))
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


def test_user_stop_during_restart_delay_prevents_restart(home, monkeypatch):
    mgr = em.EngineManager()
    spawned = []
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: spawned.append(True) or FakeProc())
    monkeypatch.setattr(em.time, "sleep", lambda _: mgr.stop())
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.restart()
    assert spawned == []


def test_user_stop_during_restart_start_handoff_prevents_restart(home, monkeypatch):
    mgr = em.EngineManager()
    spawned = []
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: spawned.append(True) or FakeProc())
    monkeypatch.setattr(em.time, "sleep", lambda _: None)
    original_start = mgr.start_sync
    def stop_before_start(*args, **kwargs):
        mgr.stop()
        return original_start(*args, **kwargs)
    monkeypatch.setattr(mgr, "start_sync", stop_before_start)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.restart()
    assert spawned == []


@pytest.mark.parametrize("fast_path", [False, True])
def test_successful_health_response_after_stop_does_not_commit_start(home, monkeypatch, fast_path):
    """A successful in-flight HTTP response must not resurrect a stopped generation."""
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    if fast_path:
        mgr._proc = FakeProc()
        mgr._running_port = 17001
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: setattr(proc, "stopped", True))
    monkeypatch.setattr(mgr, "_enable_guard", lambda: setattr(mgr, "_guard_enabled", True))

    def health(port=None, timeout=2.0):
        if port is not None:
            mgr.stop()
            return True
        return False

    monkeypatch.setattr(mgr, "is_healthy", health)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.start_sync()
    assert not mgr._guard_enabled
    assert not em.engine_lock_path().exists()


def test_stop_during_orphan_probe_cancels_adoption(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    monkeypatch.setattr(mgr, "_enable_guard", lambda: setattr(mgr, "_guard_enabled", True))

    def probe(port):
        mgr.stop()
        return True

    monkeypatch.setattr(mgr, "_orphan_is_comfyui", probe)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.start_sync()
    assert mgr._running_port is None
    assert not mgr._guard_enabled
    assert not em.engine_lock_path().exists()


def test_stale_guard_does_not_adopt_after_stop(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    monkeypatch.setattr(mgr, "_orphan_is_comfyui", lambda port: True)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.start_sync(from_guard=True)


def test_stop_during_node_count_does_not_commit_success(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: None)

    def node_count():
        mgr.stop()
        return 7

    monkeypatch.setattr(mgr, "node_count", node_count)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.start_sync()


def test_start_waits_until_previous_stop_reaps_and_closes_its_log(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    mgr.start_sync()
    old_log = mgr._log_file
    reaping = threading.Event()
    release_reap = threading.Event()
    start_entered = threading.Event()
    errors = []

    def reap(proc):
        reaping.set()
        assert release_reap.wait(5), "test must release the fake process reap"
        proc.stopped = True

    monkeypatch.setattr(em, "_stop_engine_proc", reap)

    def stop():
        try:
            mgr.stop()
        except Exception as exc:
            errors.append(exc)

    def start():
        start_entered.set()
        try:
            mgr.start_sync()
        except Exception as exc:
            errors.append(exc)

    stopping = threading.Thread(target=stop)
    starting = threading.Thread(target=start)
    stopping.start()
    assert reaping.wait(5)
    starting.start()
    assert start_entered.wait(5)
    # The event timeout exercises the old implementation's complete second start;
    # the fixed implementation must wait for teardown to finish before spawning.
    starting.join(timeout=0.1)
    release_reap.set()
    stopping.join(timeout=5)
    starting.join(timeout=5)
    assert not stopping.is_alive() and not starting.is_alive()
    assert not errors
    assert old_log.closed
    assert mgr._log_file is not None and not mgr._log_file.closed
    assert em.engine_lock_path().exists(), "old stop must not release the new start's ownership"
    mgr._log_file.close()


def test_guard_restarts_preserve_circuit_breaker_history(home, monkeypatch):
    mgr = em.EngineManager()
    mgr._guard_enabled = True
    mgr._restart_times = [10.0, 20.0]
    class LiveGuard:
        def is_alive(self):
            return True
    mgr._guard_thread = LiveGuard()
    mgr._enable_guard()
    assert mgr._restart_times == [10.0, 20.0]


def test_failed_stop_retains_process_and_ownership_for_retry(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    mgr.start_sync()
    proc, log = mgr._proc, mgr._log_file
    killed = []
    monkeypatch.setattr(em, "_stop_engine_proc", lambda process: killed.append(process))
    assert mgr.stop()["stopped"] is False
    assert mgr._proc is proc
    assert mgr._running_port == 17001
    assert em.engine_lock_path().exists()
    assert not log.closed
    mgr.stop()
    assert killed == [proc, proc]
    log.close()


def test_start_queued_before_stop_does_not_start_after_stop(home, monkeypatch):
    mgr = em.EngineManager()
    spawn = []
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: spawn.append(True) or FakeProc())
    entered = threading.Event()
    allow_start = threading.Event()
    errors = []

    class QueuedStart:
        def __enter__(self):
            entered.set()
            assert allow_start.wait(5)
        def __exit__(self, *args):
            return False

    mgr._start_lock = QueuedStart()
    def start():
        try:
            mgr.start_sync()
        except Exception as exc:
            errors.append(exc)
    thread = threading.Thread(target=start)
    thread.start()
    assert entered.wait(5)
    mgr.stop()
    allow_start.set()
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert errors and isinstance(errors[0], em.EngineOpError)
    assert "停止" in str(errors[0])
    assert spawn == []


def test_ensure_ready_rejects_health_response_from_stopped_generation(home, monkeypatch):
    mgr = em.EngineManager()
    mgr._proc = FakeProc()
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: None)

    def health(port=None, timeout=2.0):
        if mgr._proc is not None:
            mgr._proc = None
            mgr.stop()
            return True
        return False

    monkeypatch.setattr(mgr, "is_healthy", health)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.ensure_engine_ready()


def test_cancelled_health_wait_does_not_advance_stop_generation_again(home, monkeypatch):
    mgr = em.EngineManager()
    mgr._stop_generation = 3
    monkeypatch.setattr(mgr, "is_healthy", lambda *a, **k: False)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr._await_startup_health(17001, stop_generation=2)
    assert mgr._stop_generation == 3, "cleanup must not cancel starts requested after the user's stop"


def test_ensure_ready_does_not_restart_after_stop_during_failed_health(home, monkeypatch):
    mgr = em.EngineManager()
    mgr._proc = FakeProc()
    started = []
    def health():
        mgr._proc = None
        mgr._stop_generation += 1
        return False
    monkeypatch.setattr(mgr, "is_healthy", health)
    monkeypatch.setattr(mgr, "start_sync", lambda: started.append(True))
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.ensure_engine_ready()
    assert started == []


def test_explicit_start_restores_guard_after_failed_stop(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    monkeypatch.setattr(mgr, "_enable_guard", lambda: setattr(mgr, "_guard_enabled", True))
    mgr.start_sync()
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: None)
    assert mgr.stop()["stopped"] is False
    assert mgr.start_sync()["running"] is True
    assert not mgr._stopping
    assert mgr._guard_enabled
    mgr._log_file.close()


def test_stop_during_ownership_probe_cancels_existing_start_request(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    def holder():
        mgr.stop()
        return None
    monkeypatch.setattr(em, "engine_lock_holder", holder)
    with pytest.raises(em.EngineOpError, match="停止"):
        mgr.start_sync()


def test_accepted_start_job_is_cancelled_before_worker_runs(home, monkeypatch):
    mgr = em.EngineManager()
    spawned, queued = [], []
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: spawned.append(True) or FakeProc())
    monkeypatch.setattr(em.jobs, "start", lambda job_id, target: queued.append((job_id, target)))
    mgr.start_job()
    mgr.stop()
    job_id, target = queued[0]
    with pytest.raises(em.EngineOpError, match="停止"):
        target(job_id)
    assert spawned == []


@pytest.mark.parametrize("replace", [False, True])
def test_old_health_response_cannot_authorize_dead_or_replaced_process(home, monkeypatch, replace):
    mgr = em.EngineManager()
    old = FakeProc()
    mgr._proc = old
    waited = []

    def health():
        old.stopped = True
        if replace:
            mgr._proc = FakeProc()
        return True

    def wait_for_current_start(**kwargs):
        waited.append(True)
        raise em.EngineOpError("当前进程尚未就绪")

    monkeypatch.setattr(mgr, "is_healthy", health)
    monkeypatch.setattr(mgr, "start_sync", wait_for_current_start)
    with pytest.raises(em.EngineOpError, match="尚未就绪"):
        mgr.ensure_engine_ready()
    assert waited == [True]


def test_restart_reports_failure_when_old_process_cannot_stop(home, monkeypatch):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    mgr.start_sync()
    proc = mgr._proc
    monkeypatch.setattr(em, "_stop_engine_proc", lambda _: None)
    monkeypatch.setattr(em.time, "sleep", lambda _: None)
    try:
        with pytest.raises(em.EngineOpError, match="停止"):
            mgr.restart()
        assert mgr._proc is proc
        assert not mgr._guard_enabled
    finally:
        mgr._log_file.close()


@pytest.mark.parametrize("fast_path", [False, True])
def test_start_rejects_health_response_when_process_dies(home, monkeypatch, fast_path):
    mgr = em.EngineManager()
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: FakeProc())
    if fast_path:
        mgr._proc = FakeProc()
        mgr._running_port = 17001

    def health(port=None, timeout=2.0):
        mgr._proc.stopped = True
        return True

    monkeypatch.setattr(mgr, "is_healthy", health)
    with pytest.raises(em.EngineOpError, match="退出"):
        mgr.start_sync()
    assert mgr._proc is None


def test_restart_does_not_claim_to_restart_adopted_external_process(home, monkeypatch):
    mgr = em.EngineManager()
    spawned = []
    _stub_spawn_path(monkeypatch, mgr, lambda *a, **k: spawned.append(True) or FakeProc())
    monkeypatch.setattr(mgr, "_orphan_is_comfyui", lambda _: True)
    monkeypatch.setattr(em.time, "sleep", lambda _: None)
    assert mgr.start_sync()["adopted"] is True
    with pytest.raises(em.EngineOpError, match="接管|外部"):
        mgr.restart()
    assert spawned == []
