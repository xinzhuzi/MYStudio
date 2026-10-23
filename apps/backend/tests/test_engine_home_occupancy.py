"""10-19 引擎外部占用复发:M1 判据归一化(相对 argv+exe 二道门)+ M2 端点血统自愈。

绿地锚(PRD §八终版验收 2/3;tests 下此前零覆盖——rg _engine_home_processes/
_pid_is_home_engine/_home_engine_markers 零命中):
  M1 ①相对 argv(keeper/装机配方 ./venv/bin/python ./ComfyUI/main.py 形态)
     枚举命中 + _pid_is_home_engine 放行;
     ②别家同布局(可执行文件不在本家 venv)不命中;
     ③二道门三级工具全不可用=维持现状(相对形态视同不命中,保守不杀);
     ④绝对 argv 语义照旧:自家绝对命中不过二道门、外部绝对/无关 python 不命中;
  M2 ⑤端口占用者应答 /my_bridge/config(JSON dict)=自家血统→停旧自愈后落入
     正常 spawn;⑥端点不在=真外部→维持原报错且不杀;⑦枚举不可用时即便端点
     在也拒绝停旧(0929 R1「看不清就动手=拒」口径同源)。

ps 桩沿用 engine_manager.py 枚举体注释明示的既有约定——测试桩替身 monkeypatch
em 命名空间的 subprocess 符号(ps -axo 枚举 / ps -p 单查按 argv 分流应答)。
"""
from __future__ import annotations

import json
import os
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

from comfyui import engine_manager as em

# 假家(测试专用):markers 现算=/H/venv/bin/python + /H/ComfyUI/main.py,
# 相对判据末段=/venv/bin/python 与 /ComfyUI/main.py。
_HOME_VENV_PY = Path("/H/venv/bin/python")
_HOME_VENV_DIR = Path("/H/venv")
_HOME_SOURCE_DIR = Path("/H/ComfyUI")

# keeper 实录形态(2026-10-19 18:21:37 ps):/bin/sh -c cd … && nohup 相对双串。
_KEEPER_ARGV = ("/bin/sh -c cd /H/ComfyUI && nohup ./venv/bin/python "
                "./ComfyUI/main.py --port 17001 --listen 127.0.0.1")
_ABS_HOME_ARGV = "/H/venv/bin/python /H/ComfyUI/main.py --port 17002"
_OTHER_ABS_ARGV = "/opt/other/venv/bin/python /opt/other/ComfyUI/main.py --port 8188"
_OTHER_REL_ARGV = "./venv/bin/python ./ComfyUI/main.py --port 8188"
_UNRELATED_ARGV = "/usr/bin/python3 -m http.server 8000"


def _ps_stub(axo_stdout: str = "", per_pid_argv: dict[int, str] | None = None):
    """subprocess.run 桩:ps -axo 给全表,ps -p <pid> 给单查命令行;其余炸(AssertionError)。"""

    def fake_run(argv, *args, **kwargs):  # noqa: ANN002, ANN003 — 桩签名宽容
        if list(argv[:2]) == ["ps", "-axo"]:
            return NS(returncode=0, stdout=axo_stdout, stderr="")
        if list(argv[:2]) == ["ps", "-p"]:
            pid = int(argv[2])
            return NS(returncode=0, stdout=per_pid_argv.get(pid, "") if per_pid_argv else "", stderr="")
        raise AssertionError(f"unexpected subprocess.run call: {argv}")

    return fake_run


class HomeMarkersFixture(unittest.TestCase):
    """cm 家三函数钉假家(markers/二道门/门判定同源取值)。"""

    def setUp(self) -> None:
        stack = ExitStack()
        for stub in (
            patch.object(em.cm, "venv_python", lambda: _HOME_VENV_PY),
            patch.object(em.cm, "venv_dir", lambda: _HOME_VENV_DIR),
            patch.object(em.cm, "engine_source_dir", lambda: _HOME_SOURCE_DIR),
        ):
            stack.enter_context(stub)
        self.addCleanup(stack.close)


class HomeEngineEnumerationTests(HomeMarkersFixture):
    """M1 锚①②③④:_engine_home_processes 枚举归一化。"""

    def test_relative_keeper_argv_is_enumerated_after_exe_gate(self):
        # 锚①:相对形态(keeper/装机配方)命中 + 二道门过 → 枚举收录(不再假确证空表)
        stdout = f"  PID ARGS\n50670 {_KEEPER_ARGV}\n"
        with patch.object(em.subprocess, "run", side_effect=_ps_stub(stdout)), \
                patch.object(em, "_pid_executable_in_home_venv", return_value=True) as gate:
            procs = em._engine_home_processes()
        self.assertEqual([(p["pid"], p["port"]) for p in procs], [(50670, 17001)])
        gate.assert_called_once_with(50670)

    def test_other_layout_relative_argv_is_rejected_by_exe_gate(self):
        # 锚②:别家同布局(相对 argv 同构但 exe 不在本家 venv)→ 二道门挡下,不收录
        stdout = f"  PID ARGS\n9911 {_OTHER_REL_ARGV}\n"
        with patch.object(em.subprocess, "run", side_effect=_ps_stub(stdout)), \
                patch.object(em, "_pid_executable_path", return_value="/opt/other/venv/bin/python"):
            procs = em._engine_home_processes()
        self.assertEqual(procs, [])

    def test_absolute_markers_keep_semantics_without_exe_gate(self):
        # 锚④(自家绝对):argv 自带本家绝对双串=自证,不走二道门(零额外开销)
        stdout = f"  PID ARGS\n53802 {_ABS_HOME_ARGV}\n"
        with patch.object(em.subprocess, "run", side_effect=_ps_stub(stdout)), \
                patch.object(em, "_pid_executable_in_home_venv") as gate:
            procs = em._engine_home_processes()
        self.assertEqual([(p["pid"], p["port"]) for p in procs], [(53802, 17002)])
        gate.assert_not_called()

    def test_foreign_absolute_and_unrelated_python_are_never_home(self):
        # 锚④(外部绝对/无关):外部绝对 argv 靠二道门挡(相对末段命中的兜底语义),
        # 无关 python(无 main.py 双条件)连候选都不算,门不被调。
        stdout = f"  PID ARGS\n9912 {_OTHER_ABS_ARGV}\n9913 {_UNRELATED_ARGV}\n"
        with patch.object(em.subprocess, "run", side_effect=_ps_stub(stdout)), \
                patch.object(em, "_pid_executable_in_home_venv", return_value=False) as gate:
            procs = em._engine_home_processes()
        self.assertEqual(procs, [])
        gate.assert_called_once_with(9912)  # 仅别家绝对(=相对末段命中)触门


class PidIdentityRecheckTests(HomeMarkersFixture):
    """M1 锚①②③④:_pid_is_home_engine 杀前身份复核同步。"""

    def test_relative_argv_pid_passes_with_exe_gate(self):
        with patch.object(em.subprocess, "run",
                          side_effect=_ps_stub(per_pid_argv={50670: _KEEPER_ARGV})), \
                patch.object(em, "_pid_executable_in_home_venv", return_value=True):
            self.assertTrue(em._pid_is_home_engine(50670))

    def test_relative_argv_pid_fails_without_home_venv_exe(self):
        # 锚②:exe 在别家 venv → 复核不过=不杀(误伤面收死)
        with patch.object(em.subprocess, "run",
                          side_effect=_ps_stub(per_pid_argv={9911: _OTHER_REL_ARGV})), \
                patch.object(em, "_pid_executable_path", return_value="/opt/other/venv/bin/python"):
            self.assertFalse(em._pid_is_home_engine(9911))

    def test_exe_probe_unavailable_keeps_conservative_denial(self):
        # 锚③:三级工具全不可用(proc_pidpath//proc/exe/lsof)→ 相对形态视同不命中
        # (=改动前的现状:保守不杀)
        with patch.object(em.subprocess, "run",
                          side_effect=_ps_stub(per_pid_argv={50670: _KEEPER_ARGV})), \
                patch.object(em, "_pid_executable_path", return_value=None):
            self.assertFalse(em._pid_is_home_engine(50670))

    def test_absolute_argv_pid_passes_and_empty_command_fails(self):
        with patch.object(em.subprocess, "run",
                          side_effect=_ps_stub(per_pid_argv={53802: _ABS_HOME_ARGV})):
            self.assertTrue(em._pid_is_home_engine(53802))
        with patch.object(em.subprocess, "run", side_effect=_ps_stub()):
            self.assertFalse(em._pid_is_home_engine(53802))  # 查不到命令行=复核不过


class ExeGateUnitTests(HomeMarkersFixture):
    """G7 二道门单元锚:exe 真实路径 → 本家 venv 判定与三级解析。"""

    def test_exe_path_membership_rules(self):
        self.assertTrue(em._exe_path_in_home_venv("/H/venv/bin/python"))
        self.assertTrue(em._exe_path_in_home_venv("/H/venv/bin/python3.11"))  # 前缀(venv 内)
        self.assertTrue(em._exe_path_in_home_venv("/H/venv/../venv/bin/python"))  # 词法对齐
        self.assertFalse(em._exe_path_in_home_venv("/opt/other/venv/bin/python"))
        self.assertFalse(em._exe_path_in_home_venv(""))
        self.assertFalse(em._exe_path_in_home_venv("/H/venv-other/bin/python"))  # 同头不同目录

    def test_gate_denies_when_probe_unavailable(self):
        with patch.object(em, "_pid_executable_path", return_value=None):
            self.assertFalse(em._pid_executable_in_home_venv(1234))

    @unittest.skipIf(os.name == "nt", "POSIX/darwin only")
    def test_exe_probe_resolves_current_process(self):
        # 冒烟:本进程三级解析至少一级可用(darwin=proc_pidpath;Linux=/proc/self/exe)
        self.assertTrue(em._pid_executable_path(os.getpid()))


class BridgeLineageProbeTests(unittest.TestCase):
    """M2 血统探针锚(§八 Q6/G3):判端点存在性(JSON dict),不用令牌值。"""

    def setUp(self) -> None:
        self.manager = em.EngineManager()

    def test_dict_payload_with_empty_token_is_own_lineage(self):
        # G3 关键态:端点在、令牌空串(50670 实录形态)→ 自家血统(不按令牌值判)
        with patch.object(em, "_get_json", return_value={"bridgeToken": ""}):
            self.assertTrue(self.manager._engine_speaks_bridge(17001))

    def test_dict_payload_without_token_field_is_own_lineage(self):
        # 字段缺失但端点在(dict 应答)→ 自家血统;_engine_bridge_token 会给 None,
        # 两者语义由此分开(G3 修正的核心)
        with patch.object(em, "_get_json", return_value={"version": "1"}):
            self.assertTrue(self.manager._engine_speaks_bridge(17001))

    def test_non_dict_payload_is_foreign(self):
        with patch.object(em, "_get_json", return_value=["not-a-config"]):
            self.assertFalse(self.manager._engine_speaks_bridge(17001))

    def test_endpoint_missing_or_broken_is_foreign(self):
        for exc in (OSError("refused"), json.JSONDecodeError("bad", "doc", 0)):
            with self.subTest(exc=exc), patch.object(em, "_get_json", side_effect=exc):
                self.assertFalse(self.manager._engine_speaks_bridge(17001))


class RestartOccupancySelfHealTests(unittest.TestCase):
    """M2 锚⑤⑥⑦:start_sync(restart 深二级流,allow_adoption=False)空表+端口被占分支。

    到达证明:resolve_launch_port 桩抛 sentinel RuntimeError —— 自愈成功后代码
    必须落到端口决议(=正常 spawn 段入口,令牌注入随其后的 launch_env/Popen)。
    """

    SENTINEL = RuntimeError("spawn-reached")

    def setUp(self) -> None:
        self.manager = em.EngineManager()

    def _armed(self, *, speaks: bool, home_procs, retire_ok: bool = True):
        """start_sync(allow_adoption=False) 全链前置桩;返回 retire mock。"""
        stack = ExitStack()
        for stub in (
            patch.object(em.cm, "engine_installed", lambda *a, **k: True),
            patch.object(em.cm, "recorded_port", lambda *a, **k: 17001),
            patch.object(em.cm, "engine_launch_args", lambda *a, **k: ""),
            patch.object(em.cm, "engine_port_conflict_policy", lambda *a, **k: "shift"),
            patch.object(em, "engine_lock_holder", return_value=None),
            patch.object(em, "acquire_engine_lock", return_value=True),
            patch.object(em, "release_engine_lock", lambda: None),
            patch("comfyui.plugin_manager.my_nodes_drifted", return_value=False),
            patch("comfyui.plugin_manager.daojie_data_drifted", return_value=False),
            patch("comfyui.plugin_manager.seeded_custom_nodes_drifted", return_value=False),
            patch.object(em, "_engine_home_processes", return_value=home_procs),
            patch.object(em.EngineManager, "_orphan_is_comfyui", return_value=True),
            patch.object(em.EngineManager, "_engine_speaks_bridge", return_value=speaks),
            patch.object(em, "resolve_launch_port", side_effect=self.SENTINEL),
        ):
            stack.enter_context(stub)
        retire_mock = stack.enter_context(
            patch.object(em.EngineManager, "_retire_orphan_engine", return_value=retire_ok))
        self.addCleanup(stack.close)
        return retire_mock

    def test_own_lineage_occupier_is_retired_then_falls_through_to_spawn(self):
        # 锚⑤:端点在(自家脱管)+ 枚举空表 → 停旧自愈,落入正常 spawn 段入口
        # (=端口决议;令牌注入随其后的 launch_env/Popen,带令牌复活)
        retire_mock = self._armed(speaks=True, home_procs=[])
        with self.assertRaises(RuntimeError) as ctx:
            self.manager.start_sync(allow_adoption=False)
        self.assertEqual(str(ctx.exception), "spawn-reached")
        retire_mock.assert_called_once_with(17001)

    def test_foreign_occupier_keeps_error_and_never_kills(self):
        # 锚⑥:端点不在(真外部 ComfyUI)→ 维持原报错话术,绝不越权杀外部进程
        retire_mock = self._armed(speaks=False, home_procs=[])
        with self.assertRaises(em.EngineOpError) as ctx:
            self.manager.start_sync(allow_adoption=False)
        self.assertEqual(str(ctx.exception),
                         "端口仍由外部 ComfyUI 占用,无法确认其已重启;请先停止外部实例")
        retire_mock.assert_not_called()

    def test_own_lineage_but_enumeration_unavailable_refuses_self_heal(self):
        # 锚⑦:枚举不可用(None)时即便端点在也拒绝停旧——「看不清就动手=拒」
        # (0929 R1 口径同源:停旧后须 spawn,而全机唯一性此刻不可证)
        retire_mock = self._armed(speaks=True, home_procs=None)
        with self.assertRaises(em.EngineOpError) as ctx:
            self.manager.start_sync(allow_adoption=False)
        self.assertIn("枚举不可用", str(ctx.exception))
        retire_mock.assert_not_called()

    def test_own_lineage_retire_failure_reports_and_never_spawns_second(self):
        # ⑤b(停旧失败半边):retire 失败 → 如实报错收场,绝不带旧引擎启第二台
        retire_mock = self._armed(speaks=True, home_procs=[], retire_ok=False)
        with self.assertRaises(em.EngineOpError) as ctx:
            self.manager.start_sync(allow_adoption=False)
        self.assertIn("无法停止", str(ctx.exception))
        retire_mock.assert_called_once_with(17001)


if __name__ == "__main__":
    unittest.main()
