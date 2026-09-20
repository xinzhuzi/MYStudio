"""已装插件详情富化:本地四件套(pyproject/requirements/LICENSE/git)+ Registry 缓存。

09-10 实弹根修:装机行展开恒「作者/下载量 未知、license 未标明、依赖无额外依赖」。
零网络零子进程:git 元数据读取打桩为空,Registry 刷新打桩为 no-op,
缓存落在 tmp comfy home。
"""
from __future__ import annotations

import json

import pytest

from engines.comfyui import plugin_manager
from engines.comfyui.plugin_manager import (
    _repo_owner_name,
    list_plugins,
    parse_requirements_names,
    sniff_license_spdx,
)

APACHE_HEADER = "                                 Apache License\n                           Version 2.0, January 2004\n"
GPL3_HEADER = "                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n"


class TestSniffLicense:
    def test_common_licenses(self):
        assert sniff_license_spdx(APACHE_HEADER) == "Apache-2.0"
        assert sniff_license_spdx(GPL3_HEADER) == "GPL-3.0"
        assert sniff_license_spdx("MIT License\n\nCopyright (c) 2024") == "MIT"
        assert sniff_license_spdx("随便什么内容") is None

    def test_gpl_requires_version_marker(self):
        # 只有 GPL 无版本标记 → 不误判(等 Version 标记全中才命中)
        assert sniff_license_spdx("GNU GENERAL PUBLIC LICENSE\n更多内容") is None


class TestParseRequirements:
    def test_versions_comments_and_options_stripped(self):
        text = (
            "# 注释\ntorch>=2.0\nnumpy==1.26.0\nopencv-python-headless<=4.9 ; python_version >= '3.9'\n"
            "-r shared.txt\n--extra-index-url https://x\ngguf\n"
        )
        assert parse_requirements_names(text) == ["torch", "numpy", "opencv-python-headless", "gguf"]


class TestRepoOwnerName:
    def test_owner_name_from_normalized_repo(self):
        assert _repo_owner_name("https://github.com/comfy-org/comfyui-manager") == "comfy-org/comfyui-manager"
        assert _repo_owner_name("https://gitee.com/a/b.git") == "a/b"
        assert _repo_owner_name("https://github.com/only-one") is None


@pytest.fixture
def fake_env(tmp_path, monkeypatch):
    """tmp 世界:comfy home(缓存落点)+ custom_nodes(插件目录)+ 台账。"""
    home = tmp_path / "comfy-home"
    nodes = home / "ComfyUI" / "custom_nodes"
    nodes.mkdir(parents=True)

    plugin = nodes / "ComfyUI-Demo"
    plugin.mkdir()
    (plugin / "pyproject.toml").write_text(
        '[project]\nname = "comfyui-demo"\ndescription = "Demo nodes for tests."\n'
        'version = "1.0.0"\nlicense = { file = "LICENSE" }\n',
        encoding="utf-8",
    )
    (plugin / "LICENSE").write_text(APACHE_HEADER, encoding="utf-8")
    (plugin / "requirements.txt").write_text(
        "numpy>=1.24\n# note\ntorch==2.9.0\n", encoding="utf-8"
    )

    ledger = {
        "ComfyUI-Demo": {
            "repo": "https://github.com/someone/comfyui-demo",
            "commit": "abc1234",
            "version": "1.0.0",
            "installedAt": 1789000000,
            "source": "git",
            "deps": {},
            "nodes": ["DemoNode"],
        }
    }
    monkeypatch.setattr(plugin_manager.cm, "comfy_home", lambda: home)
    monkeypatch.setattr(plugin_manager.cm, "custom_nodes_dir", lambda: nodes)
    monkeypatch.setattr(plugin_manager.cm, "plugin_ledger", lambda manifest=None: ledger)
    monkeypatch.setattr(plugin_manager, "load_curated", lambda: [])
    monkeypatch.setattr(plugin_manager, "_git", lambda *args, **kwargs: "")
    monkeypatch.setattr(plugin_manager, "_kick_github_stars_refresh", lambda pending: None)
    return home


class TestListPluginsEnrichment:
    def test_local_meta_fills_desc_license_deps_and_caches(self, fake_env):
        rows = list_plugins()
        assert len(rows) == 1
        row = rows[0]
        # pyproject 简介与 LICENSE 嗅探(license=file 表形态 → 嗅探兜底)
        assert row["desc"] == "Demo nodes for tests."
        assert row["license"] == "Apache-2.0"
        # 台账 deps 空 → requirements 实单
        assert row["deps"] == ["numpy", "torch"]
        assert row["repo"] == "https://github.com/someone/comfyui-demo"
        assert row["author"] is None  # 无 .git,作者无本地来源
        assert "downloads" not in row  # 下载量退役(09-10 裁定:改 GitHub 星标)
        assert row["version"] == "1.0.0"  # pyproject 语义版
        assert row["state"] == "installed"  # 无最新版本缓存 → 不判可更新

        # 本地四件套按台账签名进了缓存文件,二次调用不重算
        cache = json.loads((fake_env / "plugin_meta_cache.json").read_text(encoding="utf-8"))
        assert cache["local"]["ComfyUI-Demo"]["sig"] == "abc1234|1.0.0|1789000000"
        assert cache["local"]["ComfyUI-Demo"]["meta"]["license"] == "Apache-2.0"

    def test_stars_cache_fills_without_network_and_author_stays_local(self, fake_env):
        # 09-10 晚裁定:下载量退役改 GitHub 星标;作者只认本地 git(无 .git 即 null)
        cache = {
            "byRepo": {
                "https://github.com/someone/comfyui-demo": {
                    "fetchedAt": 1789999999,
                    "stars": 25000,
                },
                # 旧 Registry 时代缓存(无 stars 键):不再供数,等待后台重拉
                "https://github.com/someone/legacy": {
                    "fetchedAt": 1789999999,
                    "downloads": 999,
                    "author": "Legacy",
                },
            }
        }
        (fake_env / "plugin_meta_cache.json").write_text(
            json.dumps(cache, ensure_ascii=False), encoding="utf-8"
        )

        row = list_plugins()[0]
        assert row["stars"] == 25000
        assert row["author"] is None  # 无 .git,Registry 缓存的作者不再兜底
        assert "downloads" not in row

    def test_local_save_merges_concurrent_worker_updates(self, fake_env, monkeypatch):
        """09-11 P3:本地段落盘用锁内重读合并——模拟后台星标线程恰好在
        list_plugins 的 load 与 save 之间写入 byRepo,不得被整份覆盖。"""
        # 让本地重算被触发(台账签名变化),并在重算中途把 byRepo 写进缓存文件
        ledger = plugin_manager.cm.plugin_ledger()
        ledger["ComfyUI-Demo"]["commit"] = "changed000"
        real_local_meta = plugin_manager._plugin_local_meta

        def local_meta_writes_worker_update(plugin_dir):
            cache_path = fake_env / "plugin_meta_cache.json"
            cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
            cache.setdefault("byRepo", {})["https://github.com/someone/comfyui-demo"] = {
                "fetchedAt": 123, "stars": 777, "latestTag": "9.9.9",
            }
            cache_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            return real_local_meta(plugin_dir)

        monkeypatch.setattr(plugin_manager, "_plugin_local_meta", local_meta_writes_worker_update)

        row = list_plugins()[0]
        assert row["stars"] is None  # 本次调用读的是旧快照(合并发生在 save,不在行数据)
        merged = json.loads((fake_env / "plugin_meta_cache.json").read_text(encoding="utf-8"))
        assert merged["byRepo"]["https://github.com/someone/comfyui-demo"]["stars"] == 777  # 未被覆盖
        assert "ComfyUI-Demo" in merged["local"]

    def test_latest_version_cache_drives_updatable(self, fake_env, monkeypatch):
        """最新版本三件套(09-10 晚补):tag 落后→updatable;tag 等值→不更;
        无 release 仓库按 HEAD 提交漂移判 updatable。"""
        ledger = plugin_manager.cm.plugin_ledger()

        # ① tag 落后(本地 1.0.0 < tag 2.0.0)→ updatable,展示最新 tag
        (fake_env / "plugin_meta_cache.json").write_text(json.dumps({
            "byRepo": {"https://github.com/someone/comfyui-demo": {
                "fetchedAt": 1789999999, "stars": 10, "latestTag": "2.0.0",
            }}
        }), encoding="utf-8")
        row = list_plugins()[0]
        assert row["state"] == "updatable"
        assert row["latestVersion"] == "2.0.0"
        assert row["version"] == "1.0.0"

        # ② tag 等值(v 前缀归一)→ 不判可更新
        (fake_env / "plugin_meta_cache.json").write_text(json.dumps({
            "byRepo": {"https://github.com/someone/comfyui-demo": {
                "fetchedAt": 1789999999, "stars": 10, "latestTag": "v1.0.0",
            }}
        }), encoding="utf-8")
        assert list_plugins()[0]["state"] == "installed"

        # ③ 无 release(latestSha 漂移)→ updatable,最新版本显示短 sha
        ledger["ComfyUI-Demo"]["commit"] = "oldcommit0000000000000000000000000"
        (fake_env / "plugin_meta_cache.json").write_text(json.dumps({
            "byRepo": {"https://github.com/someone/comfyui-demo": {
                "fetchedAt": 1789999999, "stars": 10,
                "latestSha": "abc1234def567890abc1234def567890abc12345",
            }}
        }), encoding="utf-8")
        row = list_plugins()[0]
        assert row["state"] == "updatable"
        assert row["latestVersion"] == "abc1234"

    def test_curated_fields_win_and_ledger_deps_win(self, fake_env, monkeypatch):
        monkeypatch.setattr(
            plugin_manager,
            "load_curated",
            lambda: [
                {
                    "id": "demo",
                    "name": "演示插件(策展)",
                    "desc_zh": "策展中文简介",
                    "repo": "https://github.com/someone/comfyui-demo",
                    "verified_license": "MIT",
                }
            ],
        )
        ledger = plugin_manager.cm.plugin_ledger()
        ledger["ComfyUI-Demo"]["deps"] = {"mydep": "1.0"}

        row = list_plugins()[0]
        assert row["name"] == "演示插件(策展)"
        assert row["desc"] == "策展中文简介"
        assert row["license"] == "MIT"
        assert row["deps"] == ["mydep"]  # 台账 pip 依赖优先于 requirements 实单
