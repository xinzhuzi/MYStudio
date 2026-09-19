"""目录搜索已装标记:Registry 小写 id 与台账目录名(大小写不一)归一比对。

09-10 实弹根修:Registry 渠道 id=comfyui-manager,台账键=目录名 ComfyUI-Manager,
精确比对恒判「未装」→ 已装插件在目录里显示「可安装」。归一化小写后单源比对。
09-19 根修:策展 id 与仓库名不一致(ComfyUI-ConditioningKrea2Rebalance vs
Rebalance-Pack)时单一 id 比对同样恒判「未装」→ 补仓库尾段/仓库地址两路比对。
09-19 二段根修:只查台账会漏掉网页端/手动克隆装的插件 → 补 custom_nodes 物理
目录深查(磁盘有目录=已装);自研包 my-nodes 等非插件目录不算。
零网络零落盘:_registry_get/load_curated/plugin_ledger/custom_nodes_dir 全部打桩。
"""
from __future__ import annotations

import pytest

from engines.comfyui import plugin_manager
from engines.comfyui.plugin_manager import catalog_search


@pytest.fixture
def stub_nodes_dir(monkeypatch, tmp_path):
    """物理 custom_nodes 指到临时目录(默认空;用例按需塞目录)。"""
    nodes = tmp_path / "custom_nodes"
    nodes.mkdir()
    monkeypatch.setattr(plugin_manager.cm, "custom_nodes_dir", lambda: nodes)
    return nodes


@pytest.fixture
def stub_ledger(monkeypatch, stub_nodes_dir):
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


def test_curated_repo_tail_matches_ledger(monkeypatch, stub_nodes_dir):
    """09-19 实弹回归:策展 id≠仓库名(Rebalance-Pack),装完必须显「已安装」。"""
    monkeypatch.setattr(
        plugin_manager.cm,
        "plugin_ledger",
        lambda manifest=None: {"Rebalance-Pack": {"source": "git",
                                                 "repo": "https://github.com/nova452/Rebalance-Pack"}},
    )
    monkeypatch.setattr(
        plugin_manager, "load_curated",
        lambda: [{"id": "ComfyUI-ConditioningKrea2Rebalance", "name": "Krea2 提示重平衡",
                  "repo": "https://github.com/nova452/Rebalance-Pack"}],
    )
    monkeypatch.setattr(
        plugin_manager, "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": []},
    )

    reply = catalog_search("重平衡")
    assert reply["curated"][0]["installed"] is True


def test_curated_repo_url_match_when_dirname_differs(monkeypatch, stub_nodes_dir):
    """收编自旧库、目录名与仓库尾段都对不上时,按台账仓库地址兜底命中。"""
    monkeypatch.setattr(
        plugin_manager.cm,
        "plugin_ledger",
        lambda manifest=None: {"my-rebalance-fork": {"source": "local",
                                                    "repo": "https://github.com/nova452/Rebalance-Pack.git"}},
    )
    monkeypatch.setattr(
        plugin_manager, "load_curated",
        lambda: [{"id": "ComfyUI-ConditioningKrea2Rebalance", "name": "Krea2 提示重平衡",
                  "repo": "https://github.com/nova452/Rebalance-Pack"}],
    )
    monkeypatch.setattr(
        plugin_manager, "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": []},
    )

    reply = catalog_search("重平衡")
    assert reply["curated"][0]["installed"] is True


def test_registry_row_installed_by_repo_tail(monkeypatch, stub_nodes_dir):
    """Registry 行同口径:插件经策展/git 装入(目录名=仓库尾段),Registry id 对不上也算已装。"""
    monkeypatch.setattr(
        plugin_manager.cm,
        "plugin_ledger",
        lambda manifest=None: {"Rebalance-Pack": {"source": "curated",
                                                 "repo": "https://github.com/nova452/Rebalance-Pack"}},
    )
    monkeypatch.setattr(plugin_manager, "load_curated", lambda: [])
    node = _registry_node("comfyui-conditioning-krea2-rebalance")
    node["repository"] = "https://github.com/nova452/Rebalance-Pack"
    monkeypatch.setattr(
        plugin_manager, "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": [node]},
    )

    reply = catalog_search("rebalance")
    row = next(r for r in reply["registry"] if r["id"] == "comfyui-conditioning-krea2-rebalance")
    assert row["installed"] is True


def test_physical_dir_counts_as_installed(monkeypatch, stub_nodes_dir):
    """09-19 二段根修:网页端/手动克隆装的插件台账没有记录,磁盘有目录也算已装。"""
    (stub_nodes_dir / "ManagerOnlyInstalled").mkdir()
    monkeypatch.setattr(plugin_manager.cm, "plugin_ledger", lambda manifest=None: {})
    monkeypatch.setattr(plugin_manager, "load_curated", lambda: [])
    node = _registry_node("manager-only")
    node["repository"] = "https://github.com/someone/ManagerOnlyInstalled"
    monkeypatch.setattr(
        plugin_manager, "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": [node]},
    )

    reply = catalog_search("manager")
    row = next(r for r in reply["registry"] if r["id"] == "manager-only")
    assert row["installed"] is True


def test_physical_dir_id_direct_match(monkeypatch, stub_nodes_dir):
    """策展条目 id 恰好等于本地目录名(仓库尾段派生不出的形态)也命中。"""
    (stub_nodes_dir / "ComfyUI_CoolTool").mkdir()
    monkeypatch.setattr(plugin_manager.cm, "plugin_ledger", lambda manifest=None: {})
    monkeypatch.setattr(
        plugin_manager, "load_curated",
        lambda: [{"id": "ComfyUI_CoolTool", "name": "酷工具", "repo": None}],
    )
    monkeypatch.setattr(
        plugin_manager, "_registry_get",
        lambda path, params=None, timeout=1.0: {"nodes": []},
    )

    reply = catalog_search("酷工具")
    assert reply["curated"][0]["installed"] is True


def test_physical_scan_excludes_managed_dirs(stub_nodes_dir):
    """自研节点包(my-nodes/旧名 manying-nodes)与 __pycache__ 不是插件,深查不计入。"""
    for name in ("my-nodes", "manying-nodes", "__pycache__", "some-real-plugin"):
        (stub_nodes_dir / name).mkdir()

    dirs = plugin_manager._physical_plugin_dirs()
    assert dirs == {"some-real-plugin"}


def test_install_rejects_ledger_plugin_before_job(monkeypatch, stub_nodes_dir):
    """台账在册插件重复安装:起 job 前就 fail-fast 拒绝(不再白转一圈报目录已存在)。"""
    monkeypatch.setattr(plugin_manager.cm, "plugin_ledger",
                        lambda manifest=None: {"Rebalance-Pack": {"source": "curated"}})
    monkeypatch.setattr(plugin_manager.cm, "engine_installed", lambda: True)
    monkeypatch.setattr(
        plugin_manager, "load_curated",
        lambda: [{"id": "ComfyUI-ConditioningKrea2Rebalance", "name": "Krea2 提示重平衡",
                  "repo": "https://github.com/nova452/Rebalance-Pack"}],
    )

    with pytest.raises(plugin_manager.EngineOpError, match="已装过"):
        plugin_manager.install_plugin_job("curated", "ComfyUI-ConditioningKrea2Rebalance")


def test_parse_requirements_vcs_url_line():
    """09-19 实弹(Impact-Pack 收编炸链):git+URL 依赖行不进版本区间预检,
    原文保留给 pip;普通行解析不受影响。"""
    from engines.comfyui.plugin_manager import check_dependency_conflicts, parse_requirements

    reqs, warnings = parse_requirements(
        "torch>=2.0\ngit+https://github.com/facebookresearch/sam2\n# 注释\n-r other.txt\n"
    )
    assert [r["name"] for r in reqs] == ["torch", "sam2"]
    vcs = reqs[1]
    assert vcs["spec"] == "" and "git+https" in vcs["raw"]
    assert any("-r" in w for w in warnings)
    # 冲突预检吃得下(VCS 行 spec 空自动跳过,不再 Invalid specifier)
    conflicts = check_dependency_conflicts(reqs, {"torch": "2.1.0"}, {})
    assert conflicts == []
