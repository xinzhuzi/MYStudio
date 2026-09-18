# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""安装撞已有目录的分产行为(09-19 根修)。

实弹背景:目录已在 custom_nodes 而账本无记录(手动克隆/上次安装断在 clone
之后)时,旧版一律报「插件目录已存在;如需重装请先卸载」——但卸载只认
账本,用户无从自救,安装死锁。新行为:账本外目录=收编登记(不删不重拉,
跳过获取直接走依赖+重启+差分);账本在册=保持拦截,提示走已装列表卸载。
引擎/jobs/获取链全部打桩,零网络零真实重启。
"""
from __future__ import annotations

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


class _EngineStub:
    def create_snapshot(self, reason, full=False):
        return "snap-stub"

    def venv_freeze(self):
        return []

    def _safe_node_names(self):
        return {"ExistingNode"}

    def restart(self, progress=None):
        if progress:
            progress(50, "restarting")

    def object_info_names(self):
        return {"ExistingNode", "ConditioningKrea2Rebalance"}


def _plan() -> dict:
    return {"dirName": "Rebalance-Pack", "repo": "https://github.com/nova452/Rebalance-Pack",
            "name": "Krea2 提示重平衡", "source": "curated",
            "zipUrl": None, "registryId": None, "localPath": None}


def _run_install_job(monkeypatch, plan: dict) -> dict:
    calls: dict = {"updates": [], "result": None, "acquired": False}

    def _update(job_id, **kw):
        calls["updates"].append(kw)
        if "result" in kw:
            calls["result"] = kw["result"]

    monkeypatch.setattr(pm, "engine_manager", lambda: _EngineStub())
    monkeypatch.setattr(pm.jobs, "update", _update)

    def _acquire(plan_, target):
        calls["acquired"] = True

    monkeypatch.setattr(pm, "_acquire", _acquire)
    monkeypatch.setattr(pm, "_pip", lambda argv, **_: None)
    pm._install_job("job-x", plan)
    return calls


def test_adopts_existing_dir_absent_from_ledger(home, monkeypatch):
    """账本外同名目录:收编登记(不重拉),台账落 adopted 标记。"""
    target = cm.custom_nodes_dir() / "Rebalance-Pack"
    target.mkdir(parents=True)
    (target / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\n", encoding="utf-8")

    calls = _run_install_job(monkeypatch, _plan())

    assert calls["acquired"] is False  # 不 clone/不下载,原目录原样收编
    entry = cm.plugin_ledger()["Rebalance-Pack"]
    assert entry["adopted"] is True
    assert entry["repo"] == "https://github.com/nova452/Rebalance-Pack"
    assert calls["result"]["adopted"] is True
    assert "收编" in calls["result"]["message"]


def test_existing_dir_in_ledger_still_blocked(home, monkeypatch):
    """账本在册:保持拦截,文案指路已装列表卸载(不再说「目录已存在」死锁话)。"""
    target = cm.custom_nodes_dir() / "Rebalance-Pack"
    target.mkdir(parents=True)
    cm.mutate_manifest(lambda m: m["plugins"].setdefault("Rebalance-Pack", {"source": "git"}))

    with pytest.raises(EngineOpError, match="已装过"):
        _run_install_job(monkeypatch, _plan())


def test_fresh_install_still_acquires(home, monkeypatch):
    """无同名目录:走原获取链(clone/zip),台账无 adopted 标记。"""
    calls = _run_install_job(monkeypatch, _plan())

    assert calls["acquired"] is True
    entry = cm.plugin_ledger()["Rebalance-Pack"]
    assert entry.get("adopted") is False
    assert "收编" not in calls["result"]["message"]
