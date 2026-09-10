# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""孤儿引擎根修(09-10 P1)回归:看门狗回收契约 + stop 整组信号 + spawn 会话。

真子进程端到端(sleep 替身,秒级):
- 父进程死 → 看门狗 killpg 整组回收引擎(孤儿占口的病灶场景);
- 引擎先退 → 看门狗静默离场,不动任何存活进程;
- _stop_engine_proc 对会话组长连同其组内子孙一并击杀;
- start_sync 以独立会话 spawn 引擎并挂看门狗(替身桩,零真实引擎)。
"""
from __future__ import annotations

import json
import subprocess
import sys
import time

import pytest

from engines.comfyui import engine_manager as em
from engines.comfyui import manifest as cm
from engines.comfyui.engine_manager import EngineManager, EngineOpError


def _wait_exit(proc: subprocess.Popen, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return True
        time.sleep(0.2)
    return False


def _spawn_watchdog(engine_pid: int, parent_pid: int) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-c", em._ENGINE_WATCHDOG_CODE,
         str(engine_pid), str(parent_pid), ""],
        start_new_session=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def test_watchdog_reaps_engine_when_parent_dies():
    parent = subprocess.Popen(["sleep", "30"])  # sidecar 替身
    engine = subprocess.Popen(["sleep", "60"], start_new_session=True)  # 引擎替身=会话组长
    watchdog = _spawn_watchdog(engine.pid, parent.pid)
    try:
        parent.kill()
        parent.wait(timeout=5)
        assert _wait_exit(engine), "父进程死后看门狗应整组回收引擎(孤儿根修契约)"
        watchdog.wait(timeout=5)
    finally:
        for proc in (parent, engine, watchdog):
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)


def test_watchdog_exits_quietly_when_engine_dies_first():
    parent = subprocess.Popen(["sleep", "30"])
    engine = subprocess.Popen(["sleep", "60"], start_new_session=True)
    watchdog = _spawn_watchdog(engine.pid, parent.pid)
    try:
        engine.kill()
        engine.wait(timeout=5)
        watchdog.wait(timeout=10)  # 引擎先退 → 看门狗自离场
        assert parent.poll() is None  # 存活进程毫发无损
    finally:
        for proc in (parent, engine, watchdog):
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)


def test_stop_engine_proc_kills_whole_group():
    # bash 在组长会话内再留一个 sleep 子进程:整组击杀应一并回收
    leader = subprocess.Popen(["bash", "-c", "sleep 60 & sleep 60"],
                              start_new_session=True)
    try:
        assert leader.poll() is None
        em._stop_engine_proc(leader)
        assert _wait_exit(leader, timeout=em.STOP_TERM_WAIT_S + em.STOP_KILL_WAIT_S + 5)
        # 组内子孙同样被回收(pgrep -g 该进程组应再无成员)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            probe = subprocess.run(["pgrep", "-g", str(leader.pid)],
                                   capture_output=True, text=True)
            if probe.stdout.strip() == "":
                break
            time.sleep(0.2)
        probe = subprocess.run(["pgrep", "-g", str(leader.pid)],
                               capture_output=True, text=True)
        assert probe.stdout.strip() == "", "整组击杀后进程组不应再有成员"
    finally:
        if leader.poll() is None:
            leader.kill()
            leader.wait(timeout=5)


def test_start_sync_spawns_engine_in_own_session_with_watchdog(tmp_path, monkeypatch):
    """spawn 契约:独立会话 + 看门狗挂载(替身桩拦截,不真开引擎)。"""
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    cm._read_cache.clear()
    cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": 17600}}))
    src = cm.engine_source_dir()
    src.mkdir(parents=True, exist_ok=True)
    (src / "main.py").write_text("print('engine')\n", encoding="utf-8")

    manager = EngineManager()
    monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: False)
    monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: False)

    spawn_calls: list[dict] = []
    watchdog_calls: list[tuple] = []

    class _FakePopen:
        pid = 4321

        def __init__(self, argv, **kwargs):
            spawn_calls.append({"argv": argv, "kwargs": kwargs})

        def poll(self):
            return 0  # 立即退出 → start_sync 走「立刻退出」报错路径,不进健康轮询

    monkeypatch.setattr(em.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(em, "_spawn_engine_watchdog",
                        lambda proc, log_path: watchdog_calls.append((proc.pid, str(log_path))))

    with pytest.raises(EngineOpError, match="立刻退出"):
        manager.start_sync()

    assert spawn_calls, "应有一次引擎 spawn"
    assert spawn_calls[0]["kwargs"].get("start_new_session") is True, "引擎必须独立会话(组长)spawn"
    assert watchdog_calls and watchdog_calls[0][0] == 4321, "spawn 后必须立即挂看门狗"
