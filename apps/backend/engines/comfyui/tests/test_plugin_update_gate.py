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


def test_update_pull_uses_force_to_survive_tag_clobber(home, monkeypatch):
    """09-19 实弹:第三方作者重打 tag,本地旧 tag 与远端冲突时普通 pull 被
    "! [rejected] …(would clobber existing tag)" 退出码 1 卡死更新链。
    拉取命令必须带 --force(仅作用 fetch 侧 ref/tag 对齐;分支仍是 --ff-only)。
    """
    _install_plugin(home, "some-pack", source="git", with_git=True)

    pulls: list[list[str]] = []

    def fake_git(argv, cwd=None, timeout=600.0, on_line=None):
        if argv[0] == "pull":
            pulls.append(list(argv))
            return ""
        if argv[0] == "rev-parse":
            return "b" * 40
        return ""

    monkeypatch.setattr(pm, "_git", fake_git)
    monkeypatch.setattr(pm, "_plugin_requirements", lambda plan: ([], []))
    fake_engine = type("E", (), {
        "create_snapshot": staticmethod(lambda reason, full=False: "snap-1"),
        "restart": staticmethod(lambda progress=None: None),
        "_safe_node_names": staticmethod(lambda: set()),
        "object_info_names": staticmethod(lambda: {"NodeA"}),
        "venv_freeze": staticmethod(lambda: []),
    })()
    monkeypatch.setattr(pm, "engine_manager", lambda: fake_engine)
    monkeypatch.setattr(pm.cm, "mutate_manifest", lambda fn: fn({"plugins": {"some-pack": {}}}))

    pm._update_plugin_job("job-x", "some-pack")
    assert pulls == [["pull", "--ff-only", "--force"]]


def test_update_backs_up_local_patches_before_pull(home, monkeypatch):
    """09-19 第三层实弹:插件带本地补丁时 git merge 被拒
    (Your local changes would be overwritten)。更新链须先备份改动文件到
    快照区,再 checkout 还原,再拉新版;补丁零丢失可回贴。
    """
    _install_plugin(home, "patched-pack", source="git", with_git=True)
    target = cm.custom_nodes_dir() / "patched-pack"
    (target / "nodes").mkdir()
    (target / "nodes" / "upscaler.py").write_text("# 本地补丁\n", encoding="utf-8")

    argv_log: list[list[str]] = []

    def fake_git(argv, cwd=None, timeout=600.0, on_line=None):
        argv_log.append(list(argv))
        if argv[0] == "status":
            return " M nodes/upscaler.py\n"
        if argv[0] == "diff":
            return "--- a/nodes/upscaler.py\n+++ b/nodes/upscaler.py\n"
        if argv[0] == "rev-parse":
            return "b" * 40
        return ""

    monkeypatch.setattr(pm, "_git", fake_git)
    monkeypatch.setattr(pm, "_plugin_requirements", lambda plan: ([], []))
    fake_engine = type("E", (), {
        "create_snapshot": staticmethod(lambda reason, full=False: "snap-1"),
        "restart": staticmethod(lambda progress=None: None),
        "_safe_node_names": staticmethod(lambda: set()),
        "object_info_names": staticmethod(lambda: {"NodeA"}),
        "venv_freeze": staticmethod(lambda: []),
    })()
    monkeypatch.setattr(pm, "engine_manager", lambda: fake_engine)
    monkeypatch.setattr(pm.cm, "mutate_manifest", lambda fn: fn({"plugins": {"patched-pack": {}}}))

    pm._update_plugin_job("job-y", "patched-pack")
    # 顺序铁律:status(检测脏)→ diff(取补丁)→ checkout -- .(还原)
    #          → pull --ff-only --force → apply(自动回贴)
    assert argv_log[0][0] == "status"
    assert argv_log[1][0] == "diff"
    assert argv_log[2] == ["checkout", "--", "."]
    assert argv_log[3] == ["pull", "--ff-only", "--force"]
    assert argv_log[4][0] == "apply"
    # 本地补丁已备份到快照区(带时间戳目录,内容逐字保留+diff 落盘)
    backups = sorted((cm.snapshots_dir() / "plugin-patches" / "patched-pack").iterdir())
    assert len(backups) == 1
    assert (backups[0] / "nodes" / "upscaler.py").read_text(encoding="utf-8") == "# 本地补丁\n"
    assert "upscaler.py" in (backups[0] / "local.patch").read_text(encoding="utf-8")


def test_update_success_marks_repo_latest_in_cache(home, monkeypatch):
    """09-19 实弹根修回归:更新成功后把 HEAD 写进最新版缓存——否则 24h TTL
    内的旧 latestSha 让刚更新完的插件恒显「可更新」(Director 实锤)。"""
    import json as _json

    _install_plugin(home, "fresh-pack", source="git", with_git=True)
    cm.mutate_manifest(lambda m: m["plugins"]["fresh-pack"].update(
        {"repo": "https://github.com/x/fresh-pack"}))

    def fake_git(argv, cwd=None, timeout=600.0, on_line=None):
        if argv[0] == "rev-parse":
            return "b" * 40
        return ""

    monkeypatch.setattr(pm, "_git", fake_git)
    monkeypatch.setattr(pm, "_plugin_requirements", lambda plan: ([], []))
    fake_engine = type("E", (), {
        "create_snapshot": staticmethod(lambda reason, full=False: "snap-1"),
        "restart": staticmethod(lambda progress=None: None),
        "_safe_node_names": staticmethod(lambda: set()),
        "object_info_names": staticmethod(lambda: {"NodeA"}),
        "venv_freeze": staticmethod(lambda: []),
    })()
    monkeypatch.setattr(pm, "engine_manager", lambda: fake_engine)
    monkeypatch.setattr(pm.cm, "mutate_manifest", lambda fn: fn({"plugins": {"fresh-pack": {}}}))

    pm._update_plugin_job("job-z", "fresh-pack")
    cache = _json.loads(pm._plugin_meta_cache_path().read_text(encoding="utf-8"))
    entry = cache["byRepo"]["https://github.com/x/fresh-pack"]
    assert entry["latestSha"] == "b" * 40
    assert entry["fetchedAt"] > 0
