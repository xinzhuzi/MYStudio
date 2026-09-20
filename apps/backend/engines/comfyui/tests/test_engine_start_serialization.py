"""启动串行化(09-11 深审 P2 根修)。

原实现「判活→Popen」裸奔秒级窗口:job 线程与生图 ensure_engine_ready 并发
穿窗=双拉引擎(双进程/端口决议两次/账本口被后写覆盖)。现在 start_sync 全程
持 _start_lock,后到者快路径等健康才放行。零真进程:Popen/健康探针/watchdog
全打桩。
"""
from __future__ import annotations

import json
import threading
import time
import types

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


class DyingProc:
    """判活时活着,健康等待期死掉(预热中途退出的时序)。"""

    def __init__(self):
        self.polls = 0

    def poll(self):
        self.polls += 1
        return None if self.polls == 1 else 1


def _stub_spawn_path(monkeypatch, mgr, popen, real_resolve=False):
    if not real_resolve:
        monkeypatch.setattr(em, "resolve_launch_port", lambda *a, **k: 17001)
    monkeypatch.setattr(mgr, "_orphan_is_comfyui", lambda port: False)
    monkeypatch.setattr(em.subprocess, "Popen", popen)
    monkeypatch.setattr(em, "_spawn_engine_watchdog", lambda *a: None)
    monkeypatch.setattr(mgr, "is_healthy", lambda port=None, timeout=2.0: True)
    monkeypatch.setattr(mgr, "_enable_guard", lambda: None)
    monkeypatch.setattr(mgr, "node_count", lambda: 0)
    monkeypatch.setattr(em, "_write_extra_model_paths", lambda *a: None)


def test_concurrent_start_spawns_exactly_once(home, monkeypatch):
    mgr = em.EngineManager()
    spawn_count = {"n": 0}

    def slow_popen(*_argv, **_kw):
        spawn_count["n"] += 1
        time.sleep(0.4)  # 拉宽窗口:并发者必须在 _start_lock 上排队而非穿窗双拉
        return FakeProc()

    _stub_spawn_path(monkeypatch, mgr, slow_popen)

    results, errors = [], []

    def worker():
        try:
            results.append(mgr.start_sync())
        except Exception as exc:  # noqa: BLE001 测试收集任意失败
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)

    assert not errors
    assert len(results) == 3
    assert spawn_count["n"] == 1  # 三方并发只允许一次 Popen
    assert all(r["running"] and r["port"] == 17001 for r in results)


def test_fast_path_waits_for_real_health(home, monkeypatch):
    """proc 活着≠就绪:预热期快路径须等到健康探针通过才返回(防假阳性放行)。"""
    mgr = em.EngineManager()
    mgr._proc = FakeProc()  # 活着但前两轮探针不健康
    probes = {"n": 0}

    def flaky_health(port=None, timeout=2.0):
        probes["n"] += 1
        return probes["n"] >= 3

    monkeypatch.setattr(mgr, "is_healthy", flaky_health)
    monkeypatch.setattr(em, "time", types.SimpleNamespace(
        monotonic=time.monotonic, sleep=lambda _s: None))  # 探针间隔不真睡

    result = mgr.start_sync()
    assert result == {"running": True, "port": 17001}
    assert probes["n"] >= 3  # 确实等过,而非首探即返回


def test_string_port_busy_falls_to_resolved_port_consistently(home, monkeypatch):
    """09-11 红条总根修:串口 17598 被占顺延到 17000 时,argv、账本回写、
    健康检查三处必须是同一个口——旧实现 argv 仍用串口,引擎绑 17598 而账本
    记 17000,健康检查探决议口两头不挨,永报「健康检查超时」。"""
    mgr = em.EngineManager()
    spawn_argv = {}

    def popen(argv, **_kw):
        spawn_argv["port"] = argv[argv.index("--port") + 1]
        return FakeProc()

    _stub_spawn_path(monkeypatch, mgr, popen, real_resolve=True)
    # 串口被占 → resolve 顺延(find_free 扫到 17000);manifest 起始口设 17598
    cm.mutate_manifest(lambda m: m["engine"].update({"port": 17598}))
    monkeypatch.setattr(
        em, "_port_bindable",
        lambda port, _s=None: port != 17598,
    )
    probed = {}
    monkeypatch.setattr(mgr, "is_healthy", lambda port=None, timeout=2.0: (probed.__setitem__("port", port), True)[1])

    reply = mgr.start_sync()

    assert reply["port"] == 17000  # 决议口
    assert spawn_argv["port"] == "17000"  # 引擎实际口=决议口(不再是串口 17598)
    assert probed["port"] == 17000  # 健康检查探的也是决议口
    assert cm.recorded_port() == 17000  # 账本回写一致


def test_fast_path_proc_dies_while_waiting_raises(home, monkeypatch):
    mgr = em.EngineManager()
    mgr._proc = DyingProc()  # 判活时活着 → 快路径进入健康等待 → 中途退出
    monkeypatch.setattr(mgr, "is_healthy", lambda port=None, timeout=2.0: False)

    with pytest.raises(em.EngineOpError, match="引擎进程启动后立刻退出了"):
        mgr.start_sync()


def test_fast_path_probes_running_port_not_stale_manifest(home, monkeypatch):
    """09-11 实弹根修:启动串钉口(spawn 口)与账本口分叉时,快路径必须探
    运行口——探账本死口=干等 120 秒假报「健康检查超时」(引擎更新失败案)。"""
    mgr = em.EngineManager()
    spawn_count = {"n": 0}

    def popen(*_argv, **_kw):
        spawn_count["n"] += 1
        return FakeProc()

    _stub_spawn_path(monkeypatch, mgr, popen)

    # 第一次启动:spawn 在 17001,运行口落值
    assert mgr.start_sync()["port"] == 17001
    assert mgr._running_port == 17001

    # 账本口被外部改成另一个值(与运行口分叉)
    cm.mutate_manifest(lambda m: m["engine"].update({"port": 17999}))

    probed = {}
    monkeypatch.setattr(mgr, "is_healthy", lambda port=None, timeout=2.0: (probed.__setitem__("port", port), True)[1])

    reply = mgr.start_sync()  # 快路径
    assert reply["port"] == 17001  # 回的是运行口,不是账本口
    assert probed["port"] == 17001  # 探的也是运行口
    assert spawn_count["n"] == 1  # 没有重复 spawn

    # stop 清零运行口,回落账本口语义恢复(桩掉对 FakeProc 的真实 kill 路径)
    monkeypatch.setattr(em, "_stop_engine_proc", lambda proc: setattr(proc, "poll", lambda: 0))
    mgr.stop()
    assert getattr(mgr, "_running_port", None) is None


def test_failed_spawn_closes_log_and_releases_ownership(home, monkeypatch):
    mgr = em.EngineManager()
    logs = []
    def fail_spawn(*args, **kwargs):
        logs.append(kwargs["stdout"])
        raise OSError("spawn failed")
    _stub_spawn_path(monkeypatch, mgr, fail_spawn)
    with pytest.raises(OSError, match="spawn failed"):
        mgr.start_sync()
    assert mgr._proc is None
    assert mgr._log_file is None
    assert logs[0].closed
    assert not em.engine_lock_path().exists()
