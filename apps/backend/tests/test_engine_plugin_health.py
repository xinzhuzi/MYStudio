# -*- coding: utf-8 -*-
"""get_engine_plugin_health 域测试(11-07 自愈可见化)。

纯函数(_parse_plugin_import_failures)离线直测;服务方法用 SSH mock 走通
数据流(引擎日志尾段+deps-install 尾段→健康图)。
"""
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ssh import service


def test_parse_failures_both_slashes_and_dedup():
    seg = (
        "[WARNING] Cannot import E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\custom_nodes\\CRT-Nodes "
        "module for custom nodes: No module named 'soundfile'\n"
        "[WARNING] Cannot import E:/IP/漫影工作室/comfyui/ComfyUI/custom_nodes/ComfyUI-LTXVideo "
        "module for custom nodes: Could not load this library: torchaudio\n"
        "[WARNING] Cannot import E:\\IP\\x\\custom_nodes\\CRT-Nodes "
        "module for custom nodes: 另一原因(应被去重保留首因)\n"
        "[WARNING] Cannot import 但没有 custom_nodes 路径的行 module for custom nodes: X\n"
    )
    out = service._parse_plugin_import_failures(seg)
    assert set(out) == {"CRT-Nodes", "ComfyUI-LTXVideo"}
    assert out["CRT-Nodes"]["loaded"] is False
    assert out["CRT-Nodes"]["cause"] == "No module named 'soundfile'"
    assert out["ComfyUI-LTXVideo"]["cause"].startswith("Could not load")


def test_parse_failures_empty():
    assert service._parse_plugin_import_failures("正常日志无失败") == {}


def test_health_service_merges_log_and_deps_debt():
    instance = service.SSHService()
    instance._win_custom_nodes_names = lambda: {"CRT-Nodes", "ComfyUI-GGUF", "my-nodes"}
    engine_tail = (
        "……正常加载若干……\n"
        "[WARNING] Cannot import E:\\IP\\x\\comfyui\\ComfyUI\\custom_nodes\\CRT-Nodes "
        "module for custom nodes: No module named 'soundfile'\n"
        "** ComfyUI startup time: 2026-11-07 23:11:53\n"
    )
    deps_tail = (
        "[2026-11-07 23:11:17] RECONCILE start: CRT-Nodes (21 specs)\n"
        "[2026-11-07 23:11:20] OK (CRT-Nodes): librosa\n"
        "[2026-11-07 23:11:22] FAIL (ComfyUI-GGUF): gguf>=0.13.0\n  明细行\n"
    )

    def fake_run(cmd, timeout):
        if "engine.log" in cmd:
            return 0, engine_tail
        if "deps-install.log" in cmd:
            return 0, deps_tail
        raise AssertionError("unexpected cmd: " + cmd)

    instance.run_remote_command = fake_run
    health = instance.get_engine_plugin_health()
    assert health["failedCount"] == 1 and health["loadedCount"] == 2
    assert health["plugins"]["CRT-Nodes"]["loaded"] is False
    assert health["plugins"]["my-nodes"]["loaded"] is True
    # pip 欠账:GGUF 装载成功但近期有 FAIL 行 → 欠账可见
    assert list(health["depsFailures"]) == ["ComfyUI-GGUF"]
    assert "FAIL" in health["depsFailures"]["ComfyUI-GGUF"][0]
