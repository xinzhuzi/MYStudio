# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""0928 令牌链根修回归:环a spawn 令牌决议 + 环b 收编令牌核验自愈。

病灶(0926 侧栏收口役复发):keeper/终端拉起的 engine_manager 宿主 env 无
MANYING_LOCAL_IMAGE_TOKEN → spawn 注入空令牌(bridge_contract.BRIDGE_TOKEN
import 时求值恒空)→ 引擎 env 存活期不可变 → 侧栏打桥恒 403;App 侧车收编
该引擎不核令牌不重启 = 403 永久死锁。全部临时 MYSTUDIO_COMFYUI_HOME +
桩替身,零网络零真实子进程。
"""
from __future__ import annotations

import json
import os
import signal

import pytest

from engines.comfyui import bridge_contract
from engines.comfyui import engine_manager as em
from engines.comfyui import manifest as cm
from engines.comfyui.engine_manager import EngineManager, EngineOpError


def _plant_installed_engine(tmp_path, monkeypatch):
    """已装引擎的家:账本带版本+端口 17600,源码目录一棵小树(照 hardening 口径)。"""
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": 17600}}))
    src = cm.engine_source_dir()
    src.mkdir(parents=True, exist_ok=True)
    (src / "main.py").write_text("print('engine')\n", encoding="utf-8")
    return home


class _FakePopen:
    """spawn 替身:捕获 argv/env,恒存活(start_sync 正常走完健康路径)。"""

    pid = 4321
    calls: list[dict] = []

    def __init__(self, argv, **kwargs):
        self.argv = argv
        self.kwargs = kwargs
        _FakePopen.calls.append({"argv": argv, "kwargs": kwargs})

    def poll(self):
        return None


def _stub_spawn_success(monkeypatch, manager: EngineManager) -> None:
    """spawn 成功路径桩:Popen 捕获/看门狗/守卫/健康/节点数/端口全替身。"""
    _FakePopen.calls.clear()
    monkeypatch.setattr(em.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(em, "_spawn_engine_watchdog", lambda proc, log_path: None)
    monkeypatch.setattr(manager, "_enable_guard", lambda: None)
    monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: True)
    monkeypatch.setattr(manager, "node_count", lambda: 934)
    monkeypatch.setattr(em, "_port_bindable", lambda port: True)


# ── 环a:令牌决议(env → sidecar config.json controlToken)─────────────

class TestResolveBridgeToken:
    def _plant_sidecar_config(self, tmp_path, token: str) -> None:
        config = tmp_path / "python" / "profiles" / "image-gen" / "config.json"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(json.dumps({"controlToken": token}), encoding="utf-8")

    def test_env_token_wins(self, tmp_path, monkeypatch):
        monkeypatch.delenv(bridge_contract.BRIDGE_TOKEN_ENV, raising=False)
        monkeypatch.setattr(cm, "user_data_root", lambda: tmp_path)
        self._plant_sidecar_config(tmp_path, "from-config")
        monkeypatch.setenv(bridge_contract.BRIDGE_TOKEN_ENV, "from-env")
        assert bridge_contract.resolve_bridge_token() == "from-env"

    def test_falls_back_to_sidecar_control_token(self, tmp_path, monkeypatch):
        monkeypatch.delenv(bridge_contract.BRIDGE_TOKEN_ENV, raising=False)
        monkeypatch.setattr(cm, "user_data_root", lambda: tmp_path)
        self._plant_sidecar_config(tmp_path, "tok-36-chars-sidecar-fallback")
        assert bridge_contract.resolve_bridge_token() == "tok-36-chars-sidecar-fallback"

    def test_missing_everything_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.delenv(bridge_contract.BRIDGE_TOKEN_ENV, raising=False)
        monkeypatch.setattr(cm, "user_data_root", lambda: tmp_path)  # 无 config.json
        assert bridge_contract.resolve_bridge_token() == ""

    def test_malformed_config_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.delenv(bridge_contract.BRIDGE_TOKEN_ENV, raising=False)
        monkeypatch.setattr(cm, "user_data_root", lambda: tmp_path)
        config = tmp_path / "python" / "profiles" / "image-gen" / "config.json"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text("{not json", encoding="utf-8")
        assert bridge_contract.resolve_bridge_token() == ""


class TestSpawnTokenInjection:
    def test_spawn_env_injects_resolved_token(self, tmp_path, monkeypatch):
        """keeper 场景的注入面:宿主 env 无令牌也已从 config.json 决议出真令牌。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: False)
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result["running"] is True
        assert _FakePopen.calls, "应有一次引擎 spawn"
        env = _FakePopen.calls[0]["kwargs"]["env"]
        assert env["MYSTUDIO_BRIDGE_TOKEN"] == "tok-sidecar"
        assert env["MYSTUDIO_BRIDGE_URL"] == bridge_contract.BRIDGE_URL


# ── 环b:收编令牌核验与自愈 ──────────────────────────────────────────

class TestAdoptTokenMismatchTruthTable:
    def test_truth_table(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        # 引擎令牌=期望 → 不失配
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        assert manager._adopt_token_mismatch(17600) is False
        # 引擎令牌=空串(keeper 病灶签名)→ 失配
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")
        assert manager._adopt_token_mismatch(17600) is True
        # 引擎令牌=旧装机令牌(重装后残留)→ 失配
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-stale")
        assert manager._adopt_token_mismatch(17600) is True
        # 引擎无 /my_bridge/config(外部 ComfyUI)→ 放行(不越权杀外部实例)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: None)
        assert manager._adopt_token_mismatch(17600) is False
        # 本管理器解析不出令牌(env+config 双缺)→ 放行(自愈也无令牌可注入)
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "")
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")
        assert manager._adopt_token_mismatch(17600) is False


class TestAdoptTokenHeal:
    def test_mismatched_orphan_retired_and_respawned_with_token(self, tmp_path, monkeypatch):
        """主战场:keeper 空令牌引擎被收编 → 停旧 + 带真令牌重启(自愈)。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")  # 病灶签名
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port: retire_calls.append(port) or True)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert retire_calls == [17600], "失配孤儿必须先停旧(单引擎纪律)"
        assert _FakePopen.calls, "停旧后必须走正常 spawn 重启"
        assert _FakePopen.calls[0]["kwargs"]["env"]["MYSTUDIO_BRIDGE_TOKEN"] == "tok-sidecar"
        assert result == {"running": True, "port": 17600}  # 新引擎非收编,无 adopted

    def test_matching_orphan_is_adopted_without_restart(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port: retire_calls.append(port) or True)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result["adopted"] is True
        assert retire_calls == [], "令牌一致的孤儿照旧收编,零重启"
        assert _FakePopen.calls == [], "收编路径不得 spawn"

    def test_unresolvable_token_keeps_legacy_adoption(self, tmp_path, monkeypatch):
        """本管理器无令牌可注入:不自愈空转(重启也注入不了),保持旧收编语义。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "")
        retire_calls: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port: retire_calls.append(port) or True)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result["adopted"] is True
        assert retire_calls == []
        assert _FakePopen.calls == []

    def test_foreign_engine_without_bridge_endpoint_not_healed(self, tmp_path, monkeypatch):
        """无 /my_bridge/config 的外部 ComfyUI:不属本病灶,不越权杀外部实例。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: None)
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port: retire_calls.append(port) or True)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result["adopted"] is True
        assert retire_calls == []

    def test_heal_failure_aborts_without_second_engine(self, tmp_path, monkeypatch):
        """停旧失败(找不到/杀不掉监听者):如实报错收场,绝不带旧引擎启第二台。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        manager = EngineManager()
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        monkeypatch.setattr(manager, "_retire_orphan_engine", lambda port: False)
        _stub_spawn_success(monkeypatch, manager)

        with pytest.raises(EngineOpError) as ctx:
            manager.start_sync()

        assert "无法停止" in str(ctx.value)
        assert _FakePopen.calls == [], "自愈失败不得 spawn(双引擎红线)"


# ── 自愈停旧的底层件 ────────────────────────────────────────────────

class TestRetireHelpers:
    def test_port_listener_pids_parses_lsof_output(self, monkeypatch):
        def fake_run(argv, **kwargs):
            class _R:
                stdout = "86156\n"
            return _R()

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._port_listener_pids(17001) == [86156]

    def test_port_listener_pids_tolerates_garbage(self, monkeypatch):
        def fake_run(argv, **kwargs):
            class _R:
                stdout = "not-a-pid\nx\n"
            return _R()

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._port_listener_pids(17001) == []

    def test_port_listener_pids_swallows_errors(self, monkeypatch):
        def fake_run(argv, **kwargs):
            raise OSError("no lsof")

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._port_listener_pids(17001) == []

    def test_retire_filters_self_and_terminates(self, monkeypatch):
        terminated: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [os.getpid(), 86156])
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: terminated.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(17001) is True
        assert terminated == [[86156]], "绝不把自己算进停旧名单"

    def test_retire_aborts_when_no_listener_found(self, monkeypatch):
        calls: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [])
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: calls.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(17001) is False
        assert calls == []

    def test_terminate_pids_sigterm_suffices(self, monkeypatch):
        monkeypatch.setattr(em, "STOP_TERM_WAIT_S", 0.2)
        monkeypatch.setattr(em, "STOP_KILL_WAIT_S", 0.2)
        signals: list[tuple[int, int]] = []
        alive = {"state": True}

        def fake_signal(pid: int, sig: int) -> None:
            signals.append((pid, sig))
            alive["state"] = False  # SIGTERM 即退

        monkeypatch.setattr(em, "_signal_pid_group", fake_signal)
        monkeypatch.setattr(em, "_pid_alive", lambda pid: alive["state"])
        assert em._terminate_pids([86156]) is True
        assert signals == [(86156, signal.SIGTERM)]

    def test_terminate_pids_escalates_to_sigkill(self, monkeypatch):
        monkeypatch.setattr(em, "STOP_TERM_WAIT_S", 0.2)
        monkeypatch.setattr(em, "STOP_KILL_WAIT_S", 0.2)
        signals: list[tuple[int, int]] = []
        alive = {"state": True}

        def fake_signal(pid: int, sig: int) -> None:
            signals.append((pid, sig))
            if sig == signal.SIGKILL:
                alive["state"] = False  # 只有 SIGKILL 收得回

        monkeypatch.setattr(em, "_signal_pid_group", fake_signal)
        monkeypatch.setattr(em, "_pid_alive", lambda pid: alive["state"])
        assert em._terminate_pids([86156]) is True
        assert signals == [(86156, signal.SIGTERM), (86156, signal.SIGKILL)]

    def test_terminate_pids_honest_false_when_unkillable(self, monkeypatch):
        monkeypatch.setattr(em, "STOP_TERM_WAIT_S", 0.1)
        monkeypatch.setattr(em, "STOP_KILL_WAIT_S", 0.1)
        monkeypatch.setattr(em, "_signal_pid_group", lambda pid, sig: None)
        monkeypatch.setattr(em, "_pid_alive", lambda pid: True)  # 连 SIGKILL 都装死
        assert em._terminate_pids([86156]) is False
