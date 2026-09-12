# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""插件更新链准入测试(09-11 用户裁定:不是最新的插件要有可点的「更新」)。

拉取资格按目录里有无 .git 判,不再按台账 source 一刀切——自旧库收编的
local 源带着完整 git 历史(如 ComfyUI-Manager),此前拒收会让可更新行
的按钮点了就报错。
"""

from __future__ import annotations

import json

import pytest

from engines.comfyui import manifest as cm
from engines.comfyui import plugin_manager as pm
from engines.comfyui.engine_manager import EngineOpError


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    yield tmp_path / "comfyui"
    cm._read_cache.clear()


def _install_plugin(home, plugin_id: str, source: str, with_git: bool) -> None:
    target = cm.custom_nodes_dir() / plugin_id
    target.mkdir(parents=True)
    (target / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\n", encoding="utf-8")
    if with_git:
        (target / ".git").mkdir()
    cm.mutate_manifest(lambda m: m["plugins"].setdefault(plugin_id, {
        "source": source, "commit": "a" * 40, "version": "aaaaaaaa",
    }))


def test_local_source_with_git_history_is_updatable(home):
    """local 源但有 .git(旧库收编形态,如 ComfyUI-Manager)=放行拉取。"""
    _install_plugin(home, "ComfyUI-Manager", source="local", with_git=True)
    job_id = pm.update_plugin_job("ComfyUI-Manager")
    assert job_id  # 准入通过,job 已创建(执行面走引擎链,不在本测试范围)


def test_registry_zip_or_bare_dir_still_rejected(home):
    """无 .git(Registry zip/裸目录)=保持拒收,提示卸载重装。"""
    _install_plugin(home, "some-zip-pack", source="registry", with_git=False)
    with pytest.raises(EngineOpError, match="没有 git 历史"):
        pm.update_plugin_job("some-zip-pack")


def test_ledger_entry_missing_still_rejected(home):
    with pytest.raises(EngineOpError, match="账本里没有这个插件"):
        pm.update_plugin_job("ghost-plugin")


def test_pip_manager_row_and_update_branch(home, monkeypatch):
    """Manager 运行时组件(pip 线):合成行随 venv 安装露面;更新走 pip 分流,不做 git 检查。"""
    # venv 未装包:不露面
    assert pm._pip_manager_row() is None
    # 装 4.2.2(伪造 venv 解释器输出):露面带版本与 source=pip
    def fake_version(package, _self=pm):
        return "4.2.2" if package == pm.PIP_MANAGER_PACKAGE else None
    monkeypatch.setattr(pm, "_venv_metadata_version", fake_version)
    row = pm._pip_manager_row()
    assert row and row["id"] == "comfyui-manager" and row["version"] == "4.2.2" and row["source"] == "pip"
    # 更新分流:走 pip job(不触 git 检查,不真执行)
    started = []
    monkeypatch.setattr(pm.jobs, "create", lambda kind, message="排队中": "job-1")
    monkeypatch.setattr(pm.jobs, "start", lambda jid, target: started.append(jid))
    assert pm.update_plugin_job("comfyui-manager") == "job-1"
    assert started == ["job-1"]
