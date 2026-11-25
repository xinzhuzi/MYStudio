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
        if "venv" in cmd:
            # 1125 销账复核:venv 里 gguf 确实缺 → 欠账如实保留(本测主旨=账本可见)
            return 0, '{"gguf": false}'
        raise AssertionError("unexpected cmd: " + cmd)

    instance.run_remote_command = fake_run
    health = instance.get_engine_plugin_health()
    assert health["failedCount"] == 1 and health["loadedCount"] == 2
    assert health["plugins"]["CRT-Nodes"]["loaded"] is False
    assert health["plugins"]["my-nodes"]["loaded"] is True
    # pip 欠账:GGUF 装载成功但近期有 FAIL 行且 venv 复核确实缺 → 欠账可见
    assert list(health["depsFailures"]) == ["ComfyUI-GGUF"]
    assert "FAIL" in health["depsFailures"]["ComfyUI-GGUF"][0]


# ── 1125 销账机制 ────────────────────────────────────────────────────────────

def test_spec_base_strips_version_constraints():
    for spec, want in (
        ("triton", "triton"),
        ("gguf>=0.13.0", "gguf"),
        ("opencv-python-headless", "opencv-python-headless"),
        ("requests >=2.28.0", "requests"),
        ("Pillow[extra]~=9", "pillow"),
    ):
        assert service._spec_base(spec) == want, spec


def test_collect_dep_debts_ledger_order_discounts():
    tail = (
        "[2026-11-11 14:41:24] FAIL (ComfyUI-ReCaVSR): triton\n"
        "[2026-11-20 10:00:00] OK (ComfyUI-ReCaVSR): triton\n"        # 其后 OK=销账
        "[2026-11-21 10:00:00] FAIL (A): pkg1>=1.0\n"
        "[2026-11-22 10:00:00] OK (A): pkg2\n"                        # 同插件不同包=不销
        "[2026-11-23 10:00:00] OK (B): pkg3\n"
        "[2026-11-24 10:00:00] FAIL (B): pkg3\n"                      # OK 后又 FAIL=重挂
        "非账本行(无时间戳/RECONCILE 标题)不参与\n"
    )
    debts, bases = service._collect_dep_debts(tail)
    assert set(debts) == {("A", "pkg1"), ("B", "pkg3")}
    assert bases == ["pkg1", "pkg3"]


def test_health_discounts_debt_satisfied_at_runtime():
    """账本里的 FAIL(triton,11-11 实案)venv 复核可导入(torch 自带副本)→ 不再标欠账。"""
    instance = service.SSHService()
    instance._win_custom_nodes_names = lambda: {"ComfyUI-ReCaVSR"}
    deps_tail = "[2026-11-11 14:41:24] FAIL (ComfyUI-ReCaVSR): triton\n"

    def fake_run(cmd, timeout):
        if "engine.log" in cmd:
            return 0, "Total VRAM\n** ComfyUI startup time: ok\n"
        if "deps-install.log" in cmd:
            return 0, deps_tail
        if "venv" in cmd:
            return 0, '{"triton": true}\n'
        raise AssertionError("unexpected cmd: " + cmd)

    instance.run_remote_command = fake_run
    health = instance.get_engine_plugin_health()
    assert health["depsFailures"] == {}
    assert health["plugins"]["ComfyUI-ReCaVSR"]["loaded"] is True


def test_health_keeps_debt_when_runtime_check_fails():
    """venv 复核通道挂了(fail-open)→ 欠账如实保留,不因销账复核失败放大红面。"""
    instance = service.SSHService()
    instance._win_custom_nodes_names = lambda: {"ComfyUI-ReCaVSR"}
    deps_tail = "[2026-11-11 14:41:24] FAIL (ComfyUI-ReCaVSR): triton\n"

    def fake_run(cmd, timeout):
        if "engine.log" in cmd:
            return 0, "Total VRAM\n"
        if "deps-install.log" in cmd:
            return 0, deps_tail
        if "venv" in cmd:
            return 1, "boom"
        raise AssertionError("unexpected cmd: " + cmd)

    instance.run_remote_command = fake_run
    health = instance.get_engine_plugin_health()
    assert list(health["depsFailures"]) == ["ComfyUI-ReCaVSR"]
