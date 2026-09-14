# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影云端收编钩子契约(系统 python3 可跑:comfy_api_nodes 用伪模块注入)。"""

from __future__ import annotations

import sys
import types

from engines.comfyui.my_nodes import cloud_takeover


def _install_fake_helpers(monkeypatch) -> types.ModuleType:
    """伪造 comfy_api_nodes.util._helpers(照上游形态:get_comfy_api_headers
    调用期经模块全局查 get_auth_header)。"""
    fake_pkg = types.ModuleType("comfy_api_nodes")
    fake_util = types.ModuleType("comfy_api_nodes.util")
    fake_helpers = types.ModuleType("comfy_api_nodes.util._helpers")

    def get_auth_header(node_cls):  # noqa: ANN001 — 与上游签名对齐
        return {}

    def get_comfy_api_headers(node_cls):  # noqa: ANN001
        # 忠实还原上游形态:调用期经「模块全局」查 get_auth_header——
        # 上游两函数同住 _helpers,其 __globals__ 即本伪模块 __dict__。
        current = fake_helpers.get_auth_header
        return {**current(node_cls), "Comfy-Env": "desktop"}

    fake_helpers.get_auth_header = get_auth_header
    fake_helpers.get_comfy_api_headers = get_comfy_api_headers
    fake_pkg.util = fake_util
    fake_util._helpers = fake_helpers
    monkeypatch.setitem(sys.modules, "comfy_api_nodes", fake_pkg)
    monkeypatch.setitem(sys.modules, "comfy_api_nodes.util", fake_util)
    monkeypatch.setitem(sys.modules, "comfy_api_nodes.util._helpers", fake_helpers)
    return fake_helpers


def test_no_token_is_zero_touch(monkeypatch):
    monkeypatch.delenv(cloud_takeover.TOKEN_ENV, raising=False)
    assert cloud_takeover.apply_cloud_takeover() is False


def test_no_comfy_api_nodes_module_is_silent(monkeypatch):
    monkeypatch.setenv(cloud_takeover.TOKEN_ENV, "sk-my")
    monkeypatch.setattr(sys, "modules", {k: v for k, v in sys.modules.items()
                                         if not k.startswith("comfy_api_nodes")})
    assert cloud_takeover.apply_cloud_takeover() is False


def test_takeover_swaps_auth_header_everywhere(monkeypatch):
    fake = _install_fake_helpers(monkeypatch)
    monkeypatch.setenv(cloud_takeover.TOKEN_ENV, "sk-my")
    assert cloud_takeover.apply_cloud_takeover() is True
    # 直接调用面:凭据恒=漫影令牌(杂散 comfy.org token 不被采用)
    assert fake.get_auth_header(object()) == {"Authorization": "Bearer sk-my"}
    # client.py/nodes_sonilo 按名引 get_comfy_api_headers 的路径同样生效
    headers = fake.get_comfy_api_headers(object())
    assert headers["Authorization"] == "Bearer sk-my"
    assert headers["Comfy-Env"] == "desktop"


def test_takeover_is_idempotent(monkeypatch):
    fake = _install_fake_helpers(monkeypatch)
    monkeypatch.setenv(cloud_takeover.TOKEN_ENV, "sk-my")
    assert cloud_takeover.apply_cloud_takeover() is True
    assert cloud_takeover.apply_cloud_takeover() is False  # 二次不重贴
    assert fake.get_auth_header(object()) == {"Authorization": "Bearer sk-my"}


def test_upstream_shape_drift_falls_back_silently(monkeypatch):
    """上游改名/删函数(get_auth_header 不在)= 不贴补丁不炸,回落上游行为。"""
    fake_pkg = types.ModuleType("comfy_api_nodes")
    fake_util = types.ModuleType("comfy_api_nodes.util")
    fake_helpers = types.ModuleType("comfy_api_nodes.util._helpers")  # 空模块
    fake_pkg.util = fake_util
    fake_util._helpers = fake_helpers
    monkeypatch.setitem(sys.modules, "comfy_api_nodes", fake_pkg)
    monkeypatch.setitem(sys.modules, "comfy_api_nodes.util", fake_util)
    monkeypatch.setitem(sys.modules, "comfy_api_nodes.util._helpers", fake_helpers)
    monkeypatch.setenv(cloud_takeover.TOKEN_ENV, "sk-my")
    assert cloud_takeover.apply_cloud_takeover() is False
