# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""0930 场景B收官:守卫节拍织入自家实例收敛。

病灶:R1 快路径收敛住在 start_sync 内——自管引擎健康且令牌正确时(R2 语义
running=True 正确上报、闸门不放行是对的),纯视图切换/挂载 ensure 结构性
到不了 start_sync,外部(如另一 AI 会话)再拉一台自家出身实例即双活,该窗
内无人收敛(0929 续接役唯一遗留)。修法:_guard_loop 的「proc 活着」分支
逐拍做同一份收敛(共用 _converge_extra_home_instances,防两处漂移);
start_sync 在途(持 _start_lock)非阻塞让路;任何异常吞掉防 daemon 守卫
静默死;同类别日志 5 分钟限频防 3 秒节拍洪水。全部桩替身(枚举/retire/
时钟/健康全 mock),零真 ps 零真杀零真占口零真守卫线程——_guard_loop 由
测试主线程同步驱动恰一拍(fake time 第 2 次 sleep 抛哨打断,织入行被删时
零触达哨也照样退出,不会挂起)。
"""
from __future__ import annotations

import pytest

from engines.comfyui import engine_manager as em
from engines.comfyui.engine_manager import EngineManager


class _LiveProc:
    """自持引擎替身:活着、带 pid(收敛的排除项)。"""

    pid = 4321

    def poll(self):
        return None


class _DeadProc:
    """已退出引擎替身:poll 非 None(崩溃守卫拉起主体的触发态)。"""

    pid = 4321

    def poll(self):
        return 0


class _StopGuardLoop(Exception):
    """主线程同步驱动 _guard_loop 的打断哨:第 2 次 sleep 抛出=第 1 拍已走完。"""


class _FakeTime:
    """守卫循环替身时钟:sleep 只计数、第 2 次抛哨打断(零真延时;只换 em
    模块全局 time 引用,不污染标准库 time——pytest 自身计时不受影响)。"""

    sleeps = 0

    @staticmethod
    def sleep(seconds):
        _FakeTime.sleeps += 1
        if _FakeTime.sleeps >= 2:
            raise _StopGuardLoop()

    @staticmethod
    def monotonic():
        return 0.0


def _run_one_guard_beat(manager: EngineManager, monkeypatch) -> None:
    """同步驱动 _guard_loop 恰一拍:第 1 次 sleep 放行(完整走完一拍循环体),
    第 2 次抛哨退出——织入行被删时循环零触达哨也照样退出,测试红而不挂。"""
    _FakeTime.sleeps = 0
    monkeypatch.setattr(em, "time", _FakeTime)
    with pytest.raises(_StopGuardLoop):
        manager._guard_loop()


# ── 薄壳直测:节拍收敛决策与执行(全桩替身) ─────────────────────────

class TestGuardBeatConverge:
    def test_extra_instance_retired_own_kept(self, monkeypatch):
        """主战场:自持 4321 在跑+外部拉了 61399(漂 17005)→多余的停掉、
        自持的保留——与快路径同一份收敛决策(共用 _converge_extra_home_
        instances,防两处漂移)。"""
        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 4321, "port": 17600, "args": "own"},
            {"pid": 61399, "port": 17005, "args": "extra"},
        ])
        retired: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retired.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)

        manager._guard_beat_converge(_LiveProc())

        assert retired == [{"port": 17005, "extra_pids": [61399]}], "多余的停掉、自持的保留"

    def test_unbound_extra_retired_with_enumerated_pid(self, monkeypatch):
        """冷启动窗的多余实例未绑口(port=None)→retire 口记 0、枚举 pid 兜底。"""
        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 4321, "port": 17600, "args": "own"},
            {"pid": 61399, "port": None, "args": "cold extra"},
        ])
        retired: list[dict] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(
                                {"port": port, "extra_pids": extra_pids}) or True)

        manager._guard_beat_converge(_LiveProc())

        assert retired == [{"port": 0, "extra_pids": [61399]}]

    def test_only_own_instance_no_retire(self, monkeypatch):
        """全机恰一台=自持:零停旧(3 秒一拍的心跳卫生不得误伤正常态)。"""
        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 4321, "port": 17600, "args": "own"},
        ])
        retired: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(port) or True)

        manager._guard_beat_converge(_LiveProc())

        assert retired == []

    def test_enumeration_unavailable_never_kills(self, monkeypatch, capsys):
        """枚举不可用(None)=纯守不杀:不停旧、不抛错,「唯一性未证」日志
        带「守卫节拍」前缀(三态语义与快路径同源)。"""
        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", lambda: None)
        retired: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(port) or True)

        manager._guard_beat_converge(_LiveProc())  # 不抛

        assert retired == [], "看不清全机时不得停旧"
        out = capsys.readouterr().out
        assert "守卫节拍:引擎进程枚举不可用" in out and "唯一性未证" in out

    def test_start_lock_held_skips_beat(self, monkeypatch):
        """start_sync 在途(持 _start_lock,冷启动可 120s+)→节拍让路本拍:
        非阻塞 try-acquire,枚举都不做(严禁阻塞 acquire 拖垮崩溃检测节拍)。"""
        manager = EngineManager()
        enum_calls: list[int] = []
        monkeypatch.setattr(em, "_engine_home_processes",
                            lambda: enum_calls.append(1) or [])
        retired: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(port) or True)

        assert manager._start_lock.acquire(blocking=False)
        try:
            manager._guard_beat_converge(_LiveProc())
        finally:
            manager._start_lock.release()

        assert enum_calls == [], "锁被占=本拍让路,连枚举都不发生"
        assert retired == []

    def test_converge_exception_swallowed_and_lock_released(self, monkeypatch, capsys):
        """守卫线程存活纪律:枚举炸了也不得抛(否则 daemon 守卫静默死),
        且 finally 必须释放 _start_lock(不释放=后续 start_sync 永久让路)。"""
        def boom():
            raise RuntimeError("ps exploded")

        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", boom)

        manager._guard_beat_converge(_LiveProc())  # 不抛=守卫线程不死

        assert manager._start_lock.acquire(blocking=False), "异常路径锁必须已释放"
        manager._start_lock.release()
        assert "守卫节拍实例收敛异常" in capsys.readouterr().out

    def test_log_rate_limited_same_category(self, monkeypatch, capsys):
        """日志限频:同类别消息窗口(GUARD_CONVERGE_LOG_INTERVAL_S)内只一发
        ——3 秒节拍×「唯一性未证」=每分钟 20 条洪水,压到每窗一条。"""
        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", lambda: None)

        manager._guard_beat_converge(_LiveProc())
        manager._guard_beat_converge(_LiveProc())
        manager._guard_beat_converge(_LiveProc())

        assert capsys.readouterr().out.count("唯一性未证") == 1

        # 回拨超窗(模拟时间流逝,不碰真 time 模块)→ 同类再放行一条
        manager._guard_converge_log_at["enum-unavailable"] -= (
            em.GUARD_CONVERGE_LOG_INTERVAL_S + 1.0)
        manager._guard_beat_converge(_LiveProc())

        assert capsys.readouterr().out.count("唯一性未证") == 1

    def test_source_label_fastpath_default_vs_beat(self, monkeypatch, capsys):
        """快路径默认参数输出逐字节不变(「快路径:」前缀);节拍调用带
        「守卫节拍:」前缀——同一份收敛逻辑,两种触发面日志可区分。"""
        manager = EngineManager()
        monkeypatch.setattr(em, "_engine_home_processes", lambda: None)

        manager._converge_extra_home_instances(_LiveProc())  # 默认参=快路径现状
        assert "快路径:引擎进程枚举不可用" in capsys.readouterr().out

        manager._guard_beat_converge(_LiveProc())
        assert "守卫节拍:引擎进程枚举不可用" in capsys.readouterr().out


# ── 限频门纯逻辑直测 ────────────────────────────────────────────────

class TestGuardConvergeLogGate:
    def test_same_category_once_per_window(self):
        manager = EngineManager()
        assert manager._guard_converge_log_gate("enum-unavailable") is True
        assert manager._guard_converge_log_gate("enum-unavailable") is False
        # 回拨超窗 → 窗口重开
        manager._guard_converge_log_at["enum-unavailable"] -= (
            em.GUARD_CONVERGE_LOG_INTERVAL_S + 1.0)
        assert manager._guard_converge_log_gate("enum-unavailable") is True

    def test_categories_independent(self):
        """类别互不挤占:「发现多余」限频不影响「停旧失败」首条放行。"""
        manager = EngineManager()
        assert manager._guard_converge_log_gate("extras-found") is True
        assert manager._guard_converge_log_gate("retire-failed") is True
        assert manager._guard_converge_log_gate("extras-found") is False
        assert manager._guard_converge_log_gate("retire-failed") is False


# ── 织入点:_guard_loop 主线程同步驱动恰一拍(零真线程零真延时) ──────

class TestGuardLoopWeave:
    def _armed_manager(self) -> EngineManager:
        manager = EngineManager()
        manager._proc = _LiveProc()
        manager._guard_enabled = True
        manager._stopping = False
        return manager

    def test_proc_alive_beats_converge(self, monkeypatch):
        """织入主锚:自管进程活着(旧代码在此直接 continue 永不收敛)→
        每拍过 _guard_beat_converge,传入的正是当拍裸读的 _proc。"""
        manager = self._armed_manager()
        beats: list[object] = []
        monkeypatch.setattr(manager, "_guard_beat_converge", lambda proc: beats.append(proc))

        _run_one_guard_beat(manager, monkeypatch)

        assert len(beats) == 1
        assert beats[0] is manager._proc, "节拍收敛吃当拍 _proc(其 pid=收敛排除项)"

    def test_proc_dead_falls_through_to_restart(self, monkeypatch):
        """引擎已死走崩溃拉起主体:节拍收敛不掺和(beat 不调,start_sync
        from_guard=True 照旧)——收敛是卫生,不挤占死活检测本职。"""
        manager = self._armed_manager()
        manager._proc = _DeadProc()
        monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: False)
        monkeypatch.setattr(em, "engine_lock_holder", lambda: None)
        starts: list[bool] = []

        def fake_start(progress=None, from_guard=False, **kw):
            starts.append(from_guard)

        monkeypatch.setattr(manager, "start_sync", fake_start)
        beats: list[object] = []
        monkeypatch.setattr(manager, "_guard_beat_converge", lambda proc: beats.append(proc))

        _run_one_guard_beat(manager, monkeypatch)

        assert beats == [], "进程已死:不调节拍收敛,走拉起"
        assert starts == [True], "崩溃拉起主体不受织入影响"

    def test_stopping_skips_beat(self, monkeypatch):
        """stop 在途(_stopping=True):守卫顶闸在先,节拍收敛不新增行为
        ——stop 与节拍收敛的竞态面锚定(停旧期间不再开新收敛拍)。"""
        manager = self._armed_manager()
        manager._stopping = True
        beats: list[object] = []
        monkeypatch.setattr(manager, "_guard_beat_converge", lambda proc: beats.append(proc))

        _run_one_guard_beat(manager, monkeypatch)

        assert beats == []

    def test_guard_disabled_skips_beat(self, monkeypatch):
        """守卫熔断/停用(_guard_enabled=False):不在岗不收敛(无自持引擎
        时 guard 本就不跑;熔断后亦然——收敛跟着守卫生命周期走)。"""
        manager = self._armed_manager()
        manager._guard_enabled = False
        beats: list[object] = []
        monkeypatch.setattr(manager, "_guard_beat_converge", lambda proc: beats.append(proc))

        _run_one_guard_beat(manager, monkeypatch)

        assert beats == []
