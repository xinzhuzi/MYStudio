"""目录搜索已装标记:Registry 小写 id 与台账目录名(大小写不一)归一比对。

09-10 实弹根修:Registry 渠道 id=comfyui-manager,台账键=目录名 ComfyUI-Manager,
精确比对恒判「未装」→ 已装插件在目录里显示「可安装」。归一化小写后单源比对。
零网络零落盘:_registry_get/load_curated/plugin_ledger 全部打桩。
"""
from __future__ import annotations

import pytest

from engines.comfyui import plugin_manager
from engines.comfyui.plugin_manager import catalog_search


@pytest.fixture
def stub_ledger(monkeypatch):
    """台账在册一个目录名大小写混合的插件。"""
    monkeypatch.setattr(
        plugin_manager.cm,
        "plugin_ledger",
        lambda manifest=None: {"ComfyUI-Manager": {"source": "git"}},
    )


def _registry_node(node_id: str) -> dict:
    return {
        "id": node_id,
        "name": node_id,
        "description": "stub",
        "publisher": {"name": "ltdrdata"},
        "latest_version": {"version": "4.2.1", "status": "active"},
    }


def test_registry_installed_match_is_case_insensitive(monkeypatch, stub_ledger):
    monkeypatch.setattr(plugin_manager, "load_curated", lambda: [])
    monkeypatch.setattr(
        plugin_manager,
        "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": [_registry_node("comfyui-manager")]},
    )

    reply = catalog_search("manager")
    row = next(r for r in reply["registry"] if r["id"] == "comfyui-manager")
    assert row["installed"] is True


def test_registry_not_in_ledger_stays_installable(monkeypatch, stub_ledger):
    monkeypatch.setattr(plugin_manager, "load_curated", lambda: [])
    monkeypatch.setattr(
        plugin_manager,
        "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": [_registry_node("some-other-pack")]},
    )

    reply = catalog_search("other")
    row = next(r for r in reply["registry"] if r["id"] == "some-other-pack")
    assert row["installed"] is False


def test_curated_dir_exact_and_id_case_insensitive(monkeypatch, stub_ledger):
    monkeypatch.setattr(
        plugin_manager,
        "load_curated",
        lambda: [
            {"id": "manager", "name": "插件管理器", "dir": "ComfyUI-Manager"},  # dir 精确命中
            {"id": "ComfyUI-Manager", "name": "同名策展"},  # 仅 id 归一化命中
            {"id": "nothing", "name": "无关策展"},  # 不命中
        ],
    )
    monkeypatch.setattr(
        plugin_manager,
        "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": []},
    )

    reply = catalog_search("")
    by_name = {r["name"]: r["installed"] for r in reply["curated"]}
    assert by_name == {"插件管理器": True, "同名策展": True, "无关策展": False}
