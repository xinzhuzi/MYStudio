"""已装插件详情富化:本地四件套(pyproject/requirements/LICENSE/git)+ Registry 缓存。

09-10 实弹根修:装机行展开恒「作者/下载量 未知、license 未标明、依赖无额外依赖」。
零网络零子进程:git 元数据读取打桩为空,Registry 刷新打桩为 no-op,
缓存落在 tmp comfy home。
"""
from __future__ import annotations

import json

import pytest

from comfyui import plugin_manager
from comfyui.plugin_manager import (
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


class TestGitlessFlag:
    """M4(10-19 §八 Q4):list_plugins 盘探 custom_nodes/<dir>/.git 存在性产出 gitless 标志。

    判据走盘探不走账本(PRD §七 G4 定谳:账本三类脏数据——条目缺失/散装
    viggle-turbo 与自研 my-nodes 不在册、kjnodes 等 3 条 repo 错指主仓——
    按 repo/source 判都会误判);与 update_plugin_job 的 400 守卫同口径。
    前端按此标志置灰更新钮;后端 400 保留(防绕过)。
    """

    def test_dir_without_git_marks_gitless(self, fake_env):
        # fake_env 的 ComfyUI-Demo 目录无 .git(Registry zip/裸目录形态)→ True
        assert list_plugins()[0]["gitless"] is True

    def test_dir_with_git_marks_not_gitless(self, fake_env):
        (fake_env / "ComfyUI" / "custom_nodes" / "ComfyUI-Demo" / ".git").mkdir()
        assert list_plugins()[0]["gitless"] is False


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
        # (10-19 kjnodes 案:签名扩盘上 pyproject/requirements mtime/size,前缀=台账三段)
        cache = json.loads((fake_env / "plugin_meta_cache.json").read_text(encoding="utf-8"))
        assert cache["local"]["ComfyUI-Demo"]["sig"].startswith("abc1234|1.0.0|1789000000|")
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

    def test_disk_change_invalidates_local_meta_cache(self, fake_env, monkeypatch):
        """10-19 kjnodes 案锚:本地四件套缓存必须被盘上变化击穿——
        ① 旧三段式签名(前役缓存)自动失效重算(装机陈年 version=None 自愈);
        ② 盘上 pyproject 更新(ComfyUI-Manager/手动 git,台账不动)→ 重算出新版。"""
        import os

        plugin = fake_env / "ComfyUI" / "custom_nodes" / "ComfyUI-Demo"
        ledger = plugin_manager.cm.plugin_ledger()
        ledger["ComfyUI-Demo"]["version"] = "672ba9e5"  # 台账坐标=裸 sha(回退展示的陈年态)

        # ① 旧格式缓存(三段签名,version=None)→ 新签名不命中 → 重算
        (fake_env / "plugin_meta_cache.json").write_text(json.dumps({
            "local": {"ComfyUI-Demo": {
                "sig": "abc1234|1.0.0|1789000000",
                "meta": {"author": "陈年作者", "repo": None, "desc": "陈年描述",
                         "license": "MIT", "version": None, "deps": ["old"]},
            }}
        }, ensure_ascii=False), encoding="utf-8")
        row = list_plugins()[0]
        assert row["version"] == "1.0.0"  # 盘上 pyproject 真值,非台账裸 sha 回退
        assert row["desc"] == "Demo nodes for tests."

        # ② 盘上 pyproject 升版(台账不动)→ mtime 锚击穿缓存 → 展示新版
        (plugin / "pyproject.toml").write_text(
            '[project]\nname = "comfyui-demo"\ndescription = "Demo nodes for tests."\n'
            'version = "2.0.0"\nlicense = { file = "LICENSE" }\n',
            encoding="utf-8",
        )
        os.utime(plugin / "pyproject.toml", ns=(10**9, 10**9))  # 显式位移 mtime 防同 ns
        assert list_plugins()[0]["version"] == "2.0.0"

    def test_git_probes_gated_on_own_dotgit(self, fake_env, monkeypatch):
        """10-19 krea2 案锚:引擎本体是 git 克隆,无 .git 的插件目录里跑 git
        remote/log 会解析到父仓库(把 comfyanonymous/ComfyUI 当成插件上游)。
        git 探针必须以目录自身 .git 为闸——gitless 行不吃引擎身份。"""
        plugin = fake_env / "ComfyUI" / "custom_nodes" / "ComfyUI-Demo"

        def leaking_git(args, *rest, **kwargs):
            if args[:2] == ["log", "-1"]:
                return "Daxiong (Lin)"
            if args[:3] == ["remote", "get-url", "origin"]:
                return "https://github.com/comfyanonymous/ComfyUI"
            return ""
        monkeypatch.setattr(plugin_manager, "_git", leaking_git)

        # ① 无 .git:探针被闸死,不吸收父仓库身份(repo 走台账真值)
        row = list_plugins()[0]
        assert row["author"] is None
        assert row["repo"] == "https://github.com/someone/comfyui-demo"

        # ② 有 .git:正常吸收自身 git 身份(清缓存强制重算)
        (plugin / ".git").mkdir()
        (fake_env / "plugin_meta_cache.json").unlink()
        row = list_plugins()[0]
        assert row["author"] == "Daxiong (Lin)"

    def test_updatable_verdict_sha_only(self, fake_env, monkeypatch):
        """10-19 帧插值案根修锚:「可更新」唯一判据=盘上真实 HEAD 与远端默认
        分支 HEAD(latestSha)漂移——git pull 的机械真值,拉平即灭灯。release
        tag 降级纯展示(生态仓 releases/latest 常为非语义 tag 或停更:帧插值
        ="models"四坐标全等仍亮灯;本地比 tag 新也误报);gitless 无拉取通道
        恒已装(kjnodes 等 repo 错指主仓的假灯);台账 commit 陈旧以盘上 HEAD
        为准(ComfyUI-Manager/手动 git 更新不走台账,controlnet_aux 假灯)。"""
        import shutil

        ledger = plugin_manager.cm.plugin_ledger()
        plugin = fake_env / "ComfyUI" / "custom_nodes" / "ComfyUI-Demo"
        (plugin / ".git").mkdir()

        def cache_with(latest_tag=None, latest_sha=None):
            (fake_env / "plugin_meta_cache.json").write_text(json.dumps({
                "byRepo": {"https://github.com/someone/comfyui-demo": {
                    "fetchedAt": 1789999999, "stars": 10,
                    "latestTag": latest_tag, "latestSha": latest_sha,
                }}
            }), encoding="utf-8")

        def remote_head(sha):
            """盘上 HEAD 桩:rev-parse 返回 sha;None=git 读不出(走 EngineOpError 路径)。"""
            def fake_git(args, *rest, **kwargs):
                if args[:2] == ["rev-parse", "HEAD"]:
                    if sha is None:
                        raise plugin_manager.EngineOpError("git broken")
                    return sha
                return ""
            monkeypatch.setattr(plugin_manager, "_git", fake_git)

        # ① 常态全绿:台账=远端 HEAD(零子进程快路);tag 语义更新但无拉取物
        #    (作者没并分支)→ 已装(旧判据在此恒假灯)
        ledger["ComfyUI-Demo"]["commit"] = "a" * 40
        cache_with(latest_tag="2.0.0", latest_sha="a" * 40)
        assert list_plugins()[0]["state"] == "installed"

        # ② 帧插值案:台账陈旧+tag 非语义("models"),盘上 HEAD 已在远端 → 已装;
        #    tag 仅供展示
        ledger["ComfyUI-Demo"]["commit"] = "zzz"
        cache_with(latest_tag="models", latest_sha="a" * 40)
        remote_head("a" * 40)
        row = list_plugins()[0]
        assert row["state"] == "installed"
        assert row["latestVersion"] == "models"

        # ③ 真落后:盘上 HEAD ≠ 远端 HEAD → 可更新,最新版本展示短 sha
        cache_with(latest_sha="b" * 40)
        remote_head("c" * 40)
        row = list_plugins()[0]
        assert row["state"] == "updatable"
        assert row["latestVersion"] == "bbbbbbb"

        # ④ 盘上 HEAD 读不出(git 坏)回退台账坐标仍落后 → 保守判可更新,
        #    点更新走 pull 自愈或如实报错
        remote_head(None)
        assert list_plugins()[0]["state"] == "updatable"

        # ⑤ gitless(kjnodes 案:repo 错指主仓、无拉取通道)→ 恒已装
        shutil.rmtree(plugin / ".git")
        cache_with(latest_sha="b" * 40)
        monkeypatch.setattr(plugin_manager, "_git", lambda *args, **kwargs: "")
        row = list_plugins()[0]
        assert row["state"] == "installed"
        assert row["gitless"] is True

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
