# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""0929 动态续接+单实例唯一性回归(含深审 R1 快路径枚举窗)。

病灶:外部会话(keeper/终端)拉起的引擎跑在非账本口时,旧 start_sync 只认
账本口孤儿——既不收编也不察觉,下一轮 resolve_launch_port 只测口可绑,
漂移实例占口即 auto-shift 换口 spawn=第二实例。本役:ps 枚举按 argv 双判据
(venv python+源码 main.py,与 cm 家解析同源)发现自家实例→收编门(账本口
回写)/停旧(枚举 pid 兜底);R1 补快路径窗:already_running 提前返回前同样
枚举收敛(多余停掉/自持保留/枚举 None 不阻塞)。全部临时
MYSTUDIO_COMFYUI_HOME+桩替身,零网络零真实子进程零真杀零真占口。
"""
from __future__ import annotations

import os

import pytest

from engines.comfyui import engine_manager as em
from engines.comfyui import manifest as cm
from engines.comfyui.engine_manager import EngineManager, EngineOpError


def _plant_installed_engine(tmp_path, monkeypatch, port: int = 17600):
    """已装引擎的家:账本带版本+端口,源码目录一棵小树(照 token_heal 口径)。"""
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    cm._read_cache.clear()
    cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": port}}))
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


# ── 纯函数:ps 解析与端口提取 ────────────────────────────────────────

class TestParsePsPidArgs:
    def test_parses_multi_line_output(self):
        stdout = "  PID ARGS\n 29436 /Users/x/Library/Application Support/漫影工作室/comfyui/venv/bin/python main.py --port 17001\n61399 /usr/bin/python3 -c other\n"
        assert em._parse_ps_pid_args(stdout) == [
            (29436, "/Users/x/Library/Application Support/漫影工作室/comfyui/venv/bin/python main.py --port 17001"),
            (61399, "/usr/bin/python3 -c other"),
        ]

    def test_skips_garbage_and_header_and_blank_lines(self):
        stdout = "  PID ARGS\n?? kernel-ish\n\nnot a pid line\n0 zero-pid\n-1 neg\n"
        assert em._parse_ps_pid_args(stdout) == []

    def test_empty_and_none_stdout(self):
        assert em._parse_ps_pid_args("") == []
        assert em._parse_ps_pid_args(None) == []  # type: ignore[arg-type]


class TestExtractPortFromArgs:
    def test_space_form(self):
        assert em._extract_port_from_args("/p/python main.py --listen 127.0.0.1 --port 17001") == 17001

    def test_equals_form(self):
        assert em._extract_port_from_args("/p/python main.py --port=17005 --quick") == 17005

    def test_no_port_returns_none(self):
        assert em._extract_port_from_args("/p/python main.py --listen 127.0.0.1") is None

    def test_last_port_wins(self):
        """消费规则镜像 parse_launch_args_string(argparse 后写胜出)。"""
        assert em._extract_port_from_args("python main.py --port 17001 --port 17005") == 17005

    def test_invalid_values_are_ignored(self):
        assert em._extract_port_from_args("python main.py --port 0") is None
        assert em._extract_port_from_args("python main.py --port 65536") is None
        assert em._extract_port_from_args("python main.py --port abc") is None
        assert em._extract_port_from_args("python main.py --port") is None  # 尾 token 缺值
        # 无效值不覆盖已记录的合法口(镜像 parse_launch_args_string 的消费规则)
        assert em._extract_port_from_args("python main.py --port 17001 --port 99999") == 17001

    def test_valid_after_invalid_still_found(self):
        assert em._extract_port_from_args("python main.py --port abc --port 17005") == 17005


# ── 组装层:自家出身判据(来源=cm 现算,B7 锚定) ──────────────────────

class TestEngineHomeProcesses:
    def _fake_ps(self, monkeypatch, lines: list[str]):
        def fake_run(argv, **kwargs):
            class _R:
                stdout = "\n".join(["  PID ARGS", *lines]) + "\n"
                returncode = 0

            return _R()

        monkeypatch.setattr(em.subprocess, "run", fake_run)

    def test_home_venv_and_main_py_hit(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py = str(cm.venv_python())
        main_py = str(cm.engine_source_dir() / "main.py")
        self._fake_ps(monkeypatch, [
            f"29436 {venv_py} {main_py} --listen 127.0.0.1 --port 17001",
            "61399 /opt/other-venv/bin/python /opt/other/ComfyUI/main.py --port 8188",
        ])
        found = em._engine_home_processes()
        assert found == [{"pid": 29436, "port": 17001,
                          "args": f"{venv_py} {main_py} --listen 127.0.0.1 --port 17001"}]

    def test_foreign_comfyui_and_unrelated_python_excluded(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py = str(cm.venv_python())
        main_py = str(cm.engine_source_dir() / "main.py")
        self._fake_ps(monkeypatch, [
            "61399 /opt/other-venv/bin/python /opt/other/ComfyUI/main.py --port 8188",  # 别家 ComfyUI
            f"70001 {venv_py} -m pytest",  # 自家 venv 但非引擎
            f"70002 /usr/bin/python3 {main_py} --port 17002",  # 引擎源码但非自家 venv
            "70003 /usr/bin/python3 -c sleep 60",  # 无关 python
        ])
        assert em._engine_home_processes() == []

    def test_ps_failure_returns_unavailable_none(self, monkeypatch):
        """0929 深审 R1:枚举失败=不可知(None),绝不降级成「确证空表」——
        空表会被 start_sync 当全机无自家实例消费,漂移实例旁盲启第二台。"""

        def fake_run(argv, **kwargs):
            raise OSError("no ps")

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() is None

    def test_ps_timeout_returns_unavailable_none(self, monkeypatch):
        import subprocess as _sp

        def fake_run(argv, **kwargs):
            raise _sp.TimeoutExpired(cmd="ps", timeout=5.0)

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() is None

    def test_ps_nonzero_exit_returns_unavailable_none(self, monkeypatch):
        """ps 非零退出=清单没拿到(空 stdout 不是「确证无实例」)。"""

        def fake_run(argv, **kwargs):
            class _R:
                stdout = ""
                returncode = 1

            return _R()

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() is None

    def test_windows_returns_unavailable_none_without_ps(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        monkeypatch.setattr(os, "name", "nt")  # monkeypatch 自动还原

        def must_not_run(argv, **kwargs):
            raise AssertionError("Windows 不得跑 ps")

        monkeypatch.setattr(em.subprocess, "run", must_not_run)
        assert em._engine_home_processes() is None

    def test_markers_follow_comfy_home_override(self, tmp_path, monkeypatch):
        """B7 锚定:判据来源=cm 现算——MYSTUDIO_COMFYUI_HOME 改判据即跟走。"""
        home_a = _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        venv_a = str(cm.venv_python())
        main_a = str(cm.engine_source_dir() / "main.py")
        home_b = tmp_path / "comfyui-b"
        monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home_b))
        cm._read_cache.clear()
        self._fake_ps(monkeypatch, [f"29436 {venv_a} {main_a} --port 17001"])
        assert em._engine_home_processes() == [], "旧家的实例对新家判据不可见(已知限制由文档记档)"


# ── 快路径收敛决策(纯函数):自持 pid 之外=多余名单 ──────────────────

class TestExtraHomeInstances:
    def test_own_pid_excluded_extras_kept(self):
        procs = [{"pid": 4321, "port": 17600, "args": "own"},
                 {"pid": 61399, "port": 17005, "args": "extra"}]
        assert em._extra_home_instances(procs, 4321) == [
            {"pid": 61399, "port": 17005, "args": "extra"}]

    def test_all_kept_when_own_not_enumerated(self):
        """自持实例未被枚举命中(ps 截断等)不影响多余判定:清单全数多余。"""
        procs = [{"pid": 100, "port": 1, "args": "a"}, {"pid": 200, "port": 2, "args": "b"}]
        assert em._extra_home_instances(procs, 999) == procs

    def test_none_and_empty_yield_no_extras(self):
        assert em._extra_home_instances(None, 4321) == []
        assert em._extra_home_instances([], 4321) == []

    def test_unknown_own_pid_conservative(self):
        """自持 pid 不可知(测试桩无 pid 等)=无法区分多余者,一台不杀(纯守不杀)。"""
        procs = [{"pid": 100, "port": 1, "args": "a"}]
        assert em._extra_home_instances(procs, None) == []
        assert em._extra_home_instances(procs, 0) == []
        assert em._extra_home_instances(procs, -5) == []
        assert em._extra_home_instances(procs, "4321") == []  # type: ignore[arg-type]


# ── _retire_orphan_engine:枚举 pid 补充源(M3 杀前身份复核硬要求) ────

class TestRetireExtraPids:
    def test_legacy_signature_unchanged(self, monkeypatch):
        """M7:不传 extra_pids 与旧签名行为逐字节一致(既有 0928 路径零变化)。"""
        terminated: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [os.getpid(), 86156])
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: terminated.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(17001) is True
        assert terminated == [[86156]]

    def test_extra_pid_verified_and_merged_dedup(self, monkeypatch):
        terminated: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [86156])
        monkeypatch.setattr(em, "_pid_is_home_engine", lambda pid: True)
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: terminated.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(17005, extra_pids=[86156, 61399]) is True
        assert terminated == [[61399, 86156]], "与监听者去重后按 pid 升序停旧"

    def test_extra_pid_fails_identity_recheck_not_killed(self, monkeypatch):
        """pid 复用窗口:枚举→停旧之间命令行已变(复核不过)=绝不杀。"""
        calls: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [])
        monkeypatch.setattr(em, "_pid_is_home_engine", lambda pid: False)  # 复核失败
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: calls.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(17005, extra_pids=[61399]) is False
        assert calls == [], "身份复核不过的 pid 不进停旧名单"

    def test_self_pid_in_extra_never_killed(self, monkeypatch):
        calls: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [])
        monkeypatch.setattr(em, "_pid_is_home_engine", lambda pid: True)
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: calls.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(17005, extra_pids=[os.getpid()]) is False
        assert calls == []

    def test_cold_start_unbound_port_uses_enumerated_pid_only(self, monkeypatch):
        """B2 冷启动窗:实例未绑口(lsof 空)→枚举 pid 是唯一停旧来源。"""
        terminated: list[list[int]] = []
        monkeypatch.setattr(em, "_port_listener_pids", lambda port: [])
        monkeypatch.setattr(em, "_pid_is_home_engine", lambda pid: True)
        monkeypatch.setattr(em, "_terminate_pids", lambda pids: terminated.append(pids) or True)
        manager = EngineManager()
        assert manager._retire_orphan_engine(0, extra_pids=[61399]) is True
        assert terminated == [[61399]]


# ── start_sync 动态续接主战场 ────────────────────────────────────────

class TestDynamicContinuationStartSync:
    def _stub_discovery(self, monkeypatch, procs: list[dict]):
        monkeypatch.setattr(em, "_engine_home_processes", lambda: procs)

    def test_drifted_home_instance_adopted_with_ledger_rewrite(self, tmp_path, monkeypatch):
        """主战场:账本 17600/自家实例漂在 17005 → 收编+账本回写+运行口跟新。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [{"pid": 61399, "port": 17005, "args": "…"}])
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: port == 17005)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retire_calls.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result == {"running": True, "port": 17005, "adopted": True}
        assert cm.recorded_port() == 17005, "账本必须回写发现口(桥/execute/uploads 按账本寻址)"
        assert manager._running_port == 17005
        assert retire_calls == [], "收编路径零停旧"
        assert _FakePopen.calls == [], "收编路径不得 spawn"

    def test_token_mismatch_retires_before_port_resolution(self, tmp_path, monkeypatch):
        """失配漂移实例:先停旧(带枚举 pid 兜底)再决议再 spawn——停旧必须先于
        resolve_launch_port,否则漂移实例占着决议口,auto-shift=第二实例。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [{"pid": 61399, "port": 17005, "args": "…"}])
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")  # 病灶签名
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        order: list[str] = []
        retire_calls: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retire_calls.append({"port": port, "extra_pids": extra_pids})
            order.append("retire")
            return True

        def fake_resolve(args_string, recorded, policy):
            order.append("resolve")
            return 17600

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        monkeypatch.setattr(em, "resolve_launch_port", fake_resolve)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert order == ["retire", "resolve"], "停旧必须先于端口决议(防 auto-shift 第二台)"
        assert retire_calls == [{"port": 17005, "extra_pids": [61399]}]
        assert len(_FakePopen.calls) == 1, "停旧后恰 spawn 一台"
        assert _FakePopen.calls[0]["kwargs"]["env"]["MYSTUDIO_BRIDGE_TOKEN"] == "tok-sidecar"
        assert result == {"running": True, "port": 17600}

    def test_cold_start_instance_retired_not_shifted(self, tmp_path, monkeypatch):
        """B2 第三态:枚举发现但 HTTP 无应答(torch 导入冷启动窗)→一律停旧
        (枚举 pid 兜底,口可能未绑)再 spawn,绝不 auto-shift 第二台。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [{"pid": 61399, "port": None, "args": "…"}])
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: False)  # 无应答
        retire_calls: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retire_calls.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert retire_calls == [{"port": 0, "extra_pids": [61399]}], "未绑口也要用枚举 pid 停旧"
        assert len(_FakePopen.calls) == 1
        assert result["running"] is True

    def test_multiple_home_instances_all_retired_single_spawn(self, tmp_path, monkeypatch):
        """M2 多实例收敛:两台自家实例→全部停旧→恰 spawn 一台(绝不双引擎)。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [
            {"pid": 61399, "port": 17005, "args": "…"},
            {"pid": 62200, "port": 17600, "args": "…"},
        ])
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retired: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retired.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert retired == [{"port": 17005, "extra_pids": [61399]},
                           {"port": 17600, "extra_pids": [62200]}]
        assert len(_FakePopen.calls) == 1, "绝不双引擎"
        assert result["running"] is True

    def test_restart_rejects_discovered_instance_without_retire(self, tmp_path, monkeypatch):
        """B1:allow_adoption=False(restart 深二级 job 流)对枚举发现同样拒绝
        收编与停旧——收编=插件态旧实例假成功;retire=杀无所有权的进程。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [{"pid": 61399, "port": 17005, "args": "…"}])
        retire_calls: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retire_calls.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        _stub_spawn_success(monkeypatch, manager)

        with pytest.raises(EngineOpError) as ctx:
            manager.start_sync(allow_adoption=False)

        assert "无法确认其已重启" in str(ctx.value)
        assert "17005" in str(ctx.value)
        assert retire_calls == [], "restart 不得杀无所有权的进程"
        assert _FakePopen.calls == []

    def test_home_instance_wins_over_foreign_engine_on_ledger_port(self, tmp_path, monkeypatch):
        """B3 优先序:账本口被外部 ComfyUI 占据+自家实例漂在 17005 → 优先接管
        自家那台;外部实例不杀不收编(让口)。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [{"pid": 61399, "port": 17005, "args": "…"}])
        probes: list[int] = []
        monkeypatch.setattr(manager, "_orphan_is_comfyui",
                            lambda port: probes.append(port) or port == 17005)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retire_calls.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result == {"running": True, "port": 17005, "adopted": True}
        assert probes == [17005], "枚举优先:被外部占据的账本口 17600 不再被探测收编"
        assert retire_calls == [], "外部实例不杀"
        assert cm.recorded_port() == 17005, "账本让口到自家实例(旧账本口留给外部实例)"

    def test_retire_failure_aborts_without_second_engine(self, tmp_path, monkeypatch):
        """停旧失败:如实报错收场,绝不带着旧引擎启第二台(单引擎红线)。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [{"pid": 61399, "port": 17005, "args": "…"}])
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        monkeypatch.setattr(manager, "_retire_orphan_engine", lambda port, *, extra_pids=None: False)
        _stub_spawn_success(monkeypatch, manager)

        with pytest.raises(EngineOpError) as ctx:
            manager.start_sync()

        assert "以免出现双引擎" in str(ctx.value)
        assert _FakePopen.calls == [], "双引擎红线:停旧失败不得 spawn"

    def test_no_discovery_falls_back_to_ledger_port_adoption(self, tmp_path, monkeypatch):
        """枚举确证无命中(ps 正常跑完零命中)→既有账本口孤儿语义原样保留
        (枚举**不可用**是另一态,见 TestEnumerationUnavailable)。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._stub_discovery(monkeypatch, [])
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retire_calls.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result == {"running": True, "port": 17600, "adopted": True}
        assert retire_calls == []
        assert _FakePopen.calls == []


# ── 0929 深审 R1:枚举不可用=拒绝盲启(三态根修回归) ──────────────────

class TestEnumerationUnavailable:
    """ps 枚举不可用(None)时 start_sync 的唯一性闸。

    实弹红条(第 1 轮深审):monkeypatch subprocess.run 抛 OSError+漂移实例
    占 17005(_orphan_is_comfyui 恒 False、账本口 17600 空闲)→旧降级路径
    spawn 出第二台。根修=「看不见」≠「没有」:枚举不可用一律拒绝 spawn,
    只放行不 spawn 的账本口纯收编。全部桩替身,零真实子进程零真占口。
    """

    def _break_ps(self, monkeypatch):
        def fake_run(argv, **kwargs):
            raise OSError("no ps")

        monkeypatch.setattr(em.subprocess, "run", fake_run)  # 真 _engine_home_processes 路径

    def test_spawn_refused_when_enumeration_unavailable(self, tmp_path, monkeypatch):
        """深审 R1 主战场:枚举不可用+账本口无应答(漂移实例不可见)→拒绝
        spawn 如实报错,绝不盲启第二台。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._break_ps(monkeypatch)
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: False)  # 账本口空闲
        retire_calls: list[dict] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retire_calls.append(port) or True)
        resolve_calls: list[tuple] = []
        monkeypatch.setattr(em, "resolve_launch_port",
                            lambda *a: resolve_calls.append(a) or 17600)
        _stub_spawn_success(monkeypatch, manager)

        with pytest.raises(EngineOpError) as ctx:
            manager.start_sync()

        assert "拒绝启动" in str(ctx.value)
        assert resolve_calls == [], "端口决议(auto-shift 的门)不得被触达"
        assert retire_calls == [], "看不清全机时不得停旧"
        assert _FakePopen.calls == [], "盲启第二台铁则:枚举不可用绝不 spawn"

    def test_ledger_port_pure_adoption_still_allowed(self, tmp_path, monkeypatch):
        """枚举不可用只封 spawn:账本口实例 HTTP 核验+令牌一致→纯收编照常
        (收编不造新进程,不存在第二台;0928 语义在降级态仍可兑现)。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._break_ps(monkeypatch)
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "tok-sidecar")
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[dict] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retire_calls.append(port) or True)
        _stub_spawn_success(monkeypatch, manager)

        result = manager.start_sync()

        assert result == {"running": True, "port": 17600, "adopted": True}
        assert retire_calls == []
        assert _FakePopen.calls == []

    def test_token_heal_refused_when_enumeration_unavailable(self, tmp_path, monkeypatch):
        """令牌失配的停旧自愈在枚举不可用时拒绝执行——停旧后必 spawn 一台,
        而「全机无其它自家实例」此刻不可证;半程自愈不如不动手(引擎原样留)。"""
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        self._break_ps(monkeypatch)
        monkeypatch.setattr(manager, "_orphan_is_comfyui", lambda port: True)
        monkeypatch.setattr(manager, "_engine_bridge_token", lambda port: "")  # 病灶签名
        monkeypatch.setattr(em.bridge_contract, "resolve_bridge_token", lambda: "tok-sidecar")
        retire_calls: list[dict] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retire_calls.append(port) or True)
        _stub_spawn_success(monkeypatch, manager)

        with pytest.raises(EngineOpError) as ctx:
            manager.start_sync()

        assert "无法安全执行停旧自愈" in str(ctx.value)
        assert retire_calls == [], "枚举不可用不得杀引擎(半程自愈=引擎白下线)"
        assert _FakePopen.calls == []


# ── 0929 深审 R1 快路径枚举窗:already_running 提前返回也要收敛 ────────

class _LiveProc:
    """快路径自持引擎替身:活着、带 pid(收敛的排除项)。"""

    pid = 4321

    def poll(self):
        return None


class TestFastPathConvergence:
    """自管引擎活着时旧快路径提前 return 永不枚举——外部会话再拉一台自家实例
    即双活,且每次生图 ensure 都走快路径,双活无人察觉。R1 修法:放行前枚举
    收敛(多余的停掉、自持的保留;枚举 None 不阻塞只记「唯一性未证」;任何
    异常不抛——热路径纪律)。全部桩替身,零真杀进程零真占口零真 ps。
    """

    def _fastpath_manager(self, tmp_path, monkeypatch) -> EngineManager:
        _plant_installed_engine(tmp_path, monkeypatch, port=17600)
        manager = EngineManager()
        manager._proc = _LiveProc()
        manager._running_port = 17600
        from engines.comfyui import plugin_manager as pm_mod
        monkeypatch.setattr(pm_mod, "my_nodes_drifted", lambda: False)  # 不真同步种子
        monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: True)
        monkeypatch.setattr(manager, "_enable_guard", lambda: None)
        return manager

    def test_extra_instance_retired_own_kept(self, tmp_path, monkeypatch):
        """主战场:自持 4321 在跑+外部拉了 61399(漂 17005)→多余的停掉、
        自持的保留,快路径照常放行。"""
        manager = self._fastpath_manager(tmp_path, monkeypatch)
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 4321, "port": 17600, "args": "own"},
            {"pid": 61399, "port": 17005, "args": "extra"},
        ])
        retired: list[dict] = []

        def fake_retire(port, *, extra_pids=None):
            retired.append({"port": port, "extra_pids": extra_pids})
            return True

        monkeypatch.setattr(manager, "_retire_orphan_engine", fake_retire)

        result = manager.start_sync()

        assert result == {"running": True, "port": 17600}
        assert retired == [{"port": 17005, "extra_pids": [61399]}], "多余的停掉、自持的保留"

    def test_unbound_extra_retired_with_enumerated_pid(self, tmp_path, monkeypatch):
        """冷启动窗的多余实例未绑口(port=None)→retire 口记 0、枚举 pid 兜底。"""
        manager = self._fastpath_manager(tmp_path, monkeypatch)
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 4321, "port": 17600, "args": "own"},
            {"pid": 61399, "port": None, "args": "cold extra"},
        ])
        retired: list[dict] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(
                                {"port": port, "extra_pids": extra_pids}) or True)

        assert manager.start_sync() == {"running": True, "port": 17600}
        assert retired == [{"port": 0, "extra_pids": [61399]}]

    def test_enumeration_unavailable_does_not_block(self, tmp_path, monkeypatch):
        """枚举不可用(None)→不阻塞不放行错乱:已有引擎在跑、快路径不启新的,
        绝不停旧也绝不报错(与主路径 spawn 拒绝不同态——这里无 spawn 可拒)。"""
        manager = self._fastpath_manager(tmp_path, monkeypatch)
        monkeypatch.setattr(em, "_engine_home_processes", lambda: None)
        retired: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(port) or True)

        result = manager.start_sync()

        assert result == {"running": True, "port": 17600}, "唯一性未证≠放行错乱:照常放行"
        assert retired == [], "看不清全机时不得停旧"

    def test_enumeration_exception_never_breaks_ensure(self, tmp_path, monkeypatch):
        """热路径铁则:枚举炸了也不得抛错拖垮每次生图 ensure。"""

        def boom():
            raise RuntimeError("ps exploded")

        manager = self._fastpath_manager(tmp_path, monkeypatch)
        monkeypatch.setattr(em, "_engine_home_processes", boom)

        assert manager.start_sync() == {"running": True, "port": 17600}

    def test_retire_failure_logged_not_raised(self, tmp_path, monkeypatch):
        """停旧失败只如实打日志,不拖垮生图(自管引擎活着且本路径不 spawn)。"""
        manager = self._fastpath_manager(tmp_path, monkeypatch)
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 61399, "port": 17005, "args": "extra"},
        ])
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: False)

        assert manager.start_sync() == {"running": True, "port": 17600}

    def test_only_own_instance_no_retire(self, tmp_path, monkeypatch):
        """全机恰一台=自持:零停旧,快路径原语义不动。"""
        manager = self._fastpath_manager(tmp_path, monkeypatch)
        monkeypatch.setattr(em, "_engine_home_processes", lambda: [
            {"pid": 4321, "port": 17600, "args": "own"},
        ])
        retired: list[int] = []
        monkeypatch.setattr(manager, "_retire_orphan_engine",
                            lambda port, *, extra_pids=None: retired.append(port) or True)

        assert manager.start_sync() == {"running": True, "port": 17600}
        assert retired == []


# ── B4 后端兜底:start_job 防重入 ────────────────────────────────────

class TestStartJobReentry:
    def test_running_job_reused_then_new_after_terminal(self, monkeypatch):
        monkeypatch.setattr(em.jobs, "start", lambda job_id, target: None)  # 不真跑线程
        manager = EngineManager()
        try:
            first = manager.start_job()
            second = manager.start_job()
            assert first == second, "在跑的 engine-start job 直接复用 id(跨视图并发 ensure 合流)"
            em.jobs.update(first, result={"port": 17600})  # 终结
            third = manager.start_job()
            assert third != first, "job 终结后的显式新启动照常新建"
        finally:
            for job_id in {first, second, third}:
                em.jobs.update(job_id, result={"done": True})  # 单例跨测试,清理防污染
