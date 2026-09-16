"""账本/桥发现顺序/工作流文件操作单测(tmp 目录,零网络零子进程)。

bridge_url 发现顺序是 grill Q9(一期即切自管实例)的行为锚点:
env 覆写 > 自管实例 manifest 端口 > 17598 回落。
"""
from __future__ import annotations

import json

from engines.comfyui import manifest as cm
from engines.image_engine import comfyui_bridge as bridge
from engines.comfyui import plugin_manager as pm


def _use_tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    # 09-14 工作流存放架构:repo 静态真源独立于引擎家——测试一律指到
    # tmp 隔离目录(默认真源在仓库内,混入会破坏库内容断言)
    repo = tmp_path / "repo-workflows"
    monkeypatch.setattr(cm, "repo_workflows_dir", lambda: repo, raising=False)
    return home


# ── 账本读写 ───────────────────────────────────────────────────────

class TestManifest:
    def test_missing_manifest_returns_defaults(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        manifest = cm.load_manifest()
        assert manifest["engine"] is None and manifest["plugins"] == {}
        assert cm.recorded_port() is None

    def test_save_load_roundtrip_and_port(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        cm.mutate_manifest(lambda m: m.update({
            "engine": {"version": "v0.9.2", "pinned": True, "port": 17600,
                       "launchArgs": {"vramPolicy": "auto", "attentionMode": "auto"}},
        }))
        assert cm.manifest_path().is_file()
        assert cm.engine_installed() is True
        assert cm.recorded_port() == 17600
        assert (home / "manifest.json").exists()

    def test_corrupt_manifest_fails_open_to_defaults(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        home.mkdir(parents=True)
        cm.manifest_path().write_text("{broken json", encoding="utf-8")
        assert cm.load_manifest()["engine"] is None

    def test_launch_args_string_and_legacy_migration(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        # 旧 dict(含非法值)读侧自动翻译:非法档回落旧缺省,reserve 非法回落 16
        cm.mutate_manifest(lambda m: m.update({"engine": {
            "version": "v0.9.2", "port": 17600,
            "launchArgs": {"vramPolicy": "gpu-only", "attentionMode": "nope", "reserveVramGb": -1},
        }}))
        assert cm.engine_launch_args() == "--enable-manager --gpu-only --reserve-vram 16 --use-pytorch-cross-attention"
        # 串原样保留(Desktop 式唯一真源);空 manifest → 默认串
        cm.mutate_manifest(lambda m: m["engine"].update({"launchArgs": "--fast --bf16-unet"}))
        assert cm.engine_launch_args() == "--fast --bf16-unet"
        cm.mutate_manifest(lambda m: m["engine"].pop("launchArgs"))
        assert cm.engine_launch_args() == cm.DEFAULT_LAUNCH_ARGS_STRING

    def test_env_vars_and_port_policy_accessors(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        cm.mutate_manifest(lambda m: m.update({"engine": {
            "version": "v0.9.2", "port": 17600,
            "envVars": {"HF_TOKEN": "x", "HTTPS_PROXY": "http://127.0.0.1:7890"},
            "portConflictPolicy": "fail",
        }}))
        assert cm.engine_env_vars() == {"HF_TOKEN": "x", "HTTPS_PROXY": "http://127.0.0.1:7890"}
        assert cm.engine_port_conflict_policy() == "fail"
        cm.mutate_manifest(lambda m: (m["engine"].pop("envVars", None), m["engine"].pop("portConflictPolicy", None)))
        assert cm.engine_env_vars() == {}
        assert cm.engine_port_conflict_policy() == "auto-shift"

    def test_core_dep_names_for_refcount(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        cm.mutate_manifest(lambda m: m.update({
            "engine": {"version": "v0.9.2", "coreDeps": {"Torch": "2.9.1", "numpy": "1.26.4"}},
            "plugins": {"p1": {"deps": {"Foo": "1.0"}}},
        }))
        assert cm.core_dep_names() == {"torch", "numpy"}
        assert set(cm.plugin_ledger()) == {"p1"}


# ── 桥发现顺序(env > manifest > 17598) ───────────────────────────

class TestBridgeUrlOrder:
    def test_env_override_wins(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        monkeypatch.setenv("MYSTUDIO_COMFYUI_BRIDGE_URL", "http://localhost:9123/")
        assert bridge.bridge_url() == "http://localhost:9123"

    def test_manifest_port_first_without_env(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        monkeypatch.delenv("MYSTUDIO_COMFYUI_BRIDGE_URL", raising=False)
        cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": 17642}}))
        assert bridge.bridge_url() == "http://127.0.0.1:17642"

    def test_falls_back_to_17598_when_engine_not_installed(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        monkeypatch.delenv("MYSTUDIO_COMFYUI_BRIDGE_URL", raising=False)
        assert bridge.bridge_url() == "http://127.0.0.1:17598"

    def test_engine_without_valid_port_falls_back(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        monkeypatch.delenv("MYSTUDIO_COMFYUI_BRIDGE_URL", raising=False)
        cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": "not-a-port"}}))
        assert bridge.bridge_url() == "http://127.0.0.1:17598"


# ── 工作流库文件操作(纯文件组) ────────────────────────────────────

class TestWorkflowFileOps:
    def _import_two(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        result = pm.import_workflows([
            {"name": "K2 流.json", "content": json.dumps({"1": {"class_type": "KSampler"}})},
            {"name": "sub/编辑流.json", "content": json.dumps({"nodes": [{"type": "KSampler"}, {"type": "rgthree.abc"}]})},
        ])
        assert result["imported"] == ["K2 流.json", "sub/编辑流.json"]
        return home

    def test_import_rejects_invalid_json_and_traversal(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        try:
            pm.import_workflows([{"name": "x.json", "content": "not json"}])
            raise AssertionError("应当拒绝非法 JSON")
        except Exception as exc:
            assert "不是有效的 JSON" in str(exc)
        try:
            pm.import_workflows([{"name": "../escape.json", "content": "{}"}])
            raise AssertionError("应当拒绝路径穿越")
        except Exception as exc:
            assert "路径" in str(exc)

    def test_same_name_conflict_skipped_unless_overwrite(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        pm.import_workflows([{"name": "a.json", "content": '{"1": {"class_type": "X"}}'}])
        result = pm.import_workflows([{"name": "a.json", "content": '{"1": {"class_type": "Y"}}'}])
        assert result["skipped"] == ["a.json"]
        result = pm.import_workflows([{"name": "a.json", "content": '{"1": {"class_type": "Y"}}'}], overwrite=True)
        assert result["imported"] == ["a.json"]

    def test_list_counts_nodes_and_marks_missing_offline(self, tmp_path, monkeypatch):
        self._import_two(tmp_path, monkeypatch)
        listing = pm.list_workflows()
        assert listing["engineOnline"] is False  # 引擎未跑,缺失标记为 null 而非误报
        by_id = {w["id"]: w for w in listing["workflows"]}
        assert by_id["K2 流.json"]["nodeCount"] == 1
        assert by_id["sub/编辑流.json"]["nodeCount"] == 2
        assert by_id["K2 流.json"]["missingNodes"] is None

    def test_list_prefix_and_light_modes(self, tmp_path, monkeypatch):
        """09-12 workflow-single-open:prefix 前缀过滤(海量库早跳)+light 轻量清单
        (跳过逐文件 JSON 解析,只 id/name/sizeBytes);缺省行为不变(全量字段)。"""
        self._import_two(tmp_path, monkeypatch)
        # prefix:只回该前缀下的条目
        listing = pm.list_workflows(prefix="sub/")
        assert [w["id"] for w in listing["workflows"]] == ["sub/编辑流.json"]
        # light:轻量字段面(无 nodeCount/missingNodes/invalidJson)
        light = pm.list_workflows(light=True)
        assert {w["id"] for w in light["workflows"]} == {"K2 流.json", "sub/编辑流.json"}
        for entry in light["workflows"]:
            assert set(entry) == {"id", "name", "sizeBytes"}
        # 缺省=旧行为:全量字段齐
        full = pm.list_workflows()
        assert all("nodeCount" in w for w in full["workflows"])

    def test_repo_source_merged_readonly(self, tmp_path, monkeypatch):
        """09-14 存放架构:静态自研 MY- 真源=仓库(repo: 前缀并入列表;可读;
        写操作拒绝——repo 路径在用户区天然不存在)。"""
        home = _use_tmp_home(tmp_path, monkeypatch)
        repo = tmp_path / "repo-workflows" / "1_图片" / "K2图像" / "1_文生图"
        repo.mkdir(parents=True)
        (repo / "MY-K2-文生图.json").write_text(json.dumps(
            {"nodes": [{"type": "KSampler"}]}, ensure_ascii=False), encoding="utf-8")
        listing = pm.list_workflows()
        repo_ids = [w["id"] for w in listing["workflows"] if w.get("source") == "repo"]
        assert repo_ids == ["repo:1_图片/K2图像/1_文生图/MY-K2-文生图.json"]
        by_id = {w["id"]: w for w in listing["workflows"]}
        assert by_id[repo_ids[0]]["nodeCount"] == 1
        # light 形态也带 source
        light = pm.list_workflows(light=True)
        assert all(w.get("source") == "repo" for w in light["workflows"] if w["id"].startswith("repo:"))
        # 读:repo 前缀取真源内容
        data = pm.read_workflow(repo_ids[0])
        assert "KSampler" in data["content"]
        # 穿越拒绝
        try:
            pm.read_workflow("repo:../escape.json")
            raise AssertionError("应当拒绝 repo 路径穿越")
        except Exception as exc:
            assert "路径" in str(exc)
        # 写:rename/move/delete 对 repo 条目一律「工作流不存在」(只读保护)
        for action in ("rename_workflow", "move_workflow"):
            try:
                getattr(pm, action)(repo_ids[0], "x" if action == "rename_workflow" else "sub")
                raise AssertionError(f"{action} 应当拒绝 repo 条目")
            except Exception as exc:
                assert "不存在" in str(exc)

    def test_repo_bridge_templates_excluded_from_listing(self, tmp_path, monkeypatch):
        """09-14 三次修订:桥模板(schemaVersion+graph 无 nodes 的 API 格式)归位
        静态库后不进侧栏列表——画布打不开,漏进=变相误置件。"""
        _use_tmp_home(tmp_path, monkeypatch)
        repo = tmp_path / "repo-workflows" / "1_图片" / "K2图像" / "1_文生图"
        repo.mkdir(parents=True)
        (repo / "MY-K2-文生图.json").write_text(json.dumps(
            {"nodes": [{"type": "KSampler"}]}, ensure_ascii=False), encoding="utf-8")
        (repo / "MY-t2i_fast.json").write_text(json.dumps(
            {"schemaVersion": 1, "name": "manying_t2i_fast",
             "inputs": {}, "graph": {}}, ensure_ascii=False), encoding="utf-8")
        for light in (False, True):
            listing = pm.list_workflows(light=light)
            repo_ids = [w["id"] for w in listing["workflows"] if w.get("source") == "repo"]
            assert repo_ids == ["repo:1_图片/K2图像/1_文生图/MY-K2-文生图.json"], light

    def test_read_rename_move(self, tmp_path, monkeypatch):
        self._import_two(tmp_path, monkeypatch)
        content = pm.read_workflow("K2 流.json")
        assert "KSampler" in content["content"]
        renamed = pm.rename_workflow("K2 流.json", "重命名流")
        assert renamed["id"] == "重命名流.json"
        moved = pm.move_workflow("重命名流.json", "归档")
        assert moved["id"] == "归档/重命名流.json"

    def test_delete_needs_confirmation_then_backed_up(self, tmp_path, monkeypatch):
        self._import_two(tmp_path, monkeypatch)
        first = pm.delete_workflow("K2 流.json")
        assert first["needsConfirmation"] is True and first["nodeCount"] == 1
        second = pm.delete_workflow("K2 流.json", confirm=True)
        assert second["deleted"] is True
        backups = list((tmp_path / "comfyui" / "snapshots" / "workflow-backups").glob("*.json"))
        assert len(backups) == 1  # 快照备份可恢复

    def test_reference_scan_matches_class_type(self, tmp_path, monkeypatch):
        self._import_two(tmp_path, monkeypatch)
        refs = pm.scan_workflow_references({"rgthree.abc", "NotFound"})
        assert [r["workflow"] for r in refs] == ["sub/编辑流.json"]
        assert refs[0]["usedTypes"] == ["rgthree.abc"]

    # ── 库目录统一(09-09 存量迁移链打通) ──────────────────────────

    def test_import_lands_in_native_user_workflows_dir(self, tmp_path, monkeypatch):
        home = self._import_two(tmp_path, monkeypatch)
        native = home / "ComfyUI" / "user" / "default" / "workflows"
        assert (native / "K2 流.json").is_file()
        assert (native / "sub" / "编辑流.json").is_file()

    def test_legacy_default_dir_merged_non_destructively(self, tmp_path, monkeypatch):
        home = self._import_two(tmp_path, monkeypatch)
        native = cm.workflows_dir()
        # 旧库种子 + 与新库同名冲突文件并存
        old = home / "workflows"
        (old / "组").mkdir(parents=True)
        (old / "组" / "旧种子.json").write_text(json.dumps({"1": {"class_type": "Legacy"}}), encoding="utf-8")
        (old / "K2 流.json").write_text(json.dumps({"1": {"class_type": "ShouldNotOverwrite"}}), encoding="utf-8")

        listing = pm.list_workflows()
        by_id = {w["id"]: w for w in listing["workflows"]}
        assert "组/旧种子.json" in by_id  # 旧库并入后列表可见
        # 同名不覆盖:新库内容保持 import 原值,旧文件原样保留
        assert json.loads((native / "K2 流.json").read_text(encoding="utf-8"))["1"]["class_type"] == "KSampler"
        assert json.loads((old / "K2 流.json").read_text(encoding="utf-8"))["1"]["class_type"] == "ShouldNotOverwrite"

        again = pm.list_workflows()  # 幂等:二次触达不重复不报错
        assert len(again["workflows"]) == len(listing["workflows"])

    def test_explicit_workflows_dir_equal_legacy_is_noop(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        legacy = home / "workflows"
        legacy.mkdir(parents=True)
        (legacy / "a.json").write_text(json.dumps({"1": {"class_type": "X"}}), encoding="utf-8")
        cm.mutate_manifest(lambda m: m.update({"workflowsDir": str(legacy)}))
        assert cm.workflows_dir() == legacy
        assert pm.merge_legacy_workflows_dir() == []  # old==new 直接短路
        listing = pm.list_workflows()
        assert [w["id"] for w in listing["workflows"]] == ["a.json"]

    def test_symlinked_home_prefix_survives_import_and_move(self, tmp_path, monkeypatch):
        """实弹回归:库根带符号链接前缀(macOS /var→/private/var)时,
        _safe_workflow_id 已 resolve 而 relative_to 根未 resolve → 嵌套导入
        400 且文件已落盘的半完成态。import/rename/move 三口必须同源 resolve。"""
        real = tmp_path / "real-home"
        real.mkdir()
        alias = tmp_path / "alias-home"
        alias.symlink_to(real)
        monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(alias / "comfyui"))
        monkeypatch.setattr(cm, "repo_workflows_dir", lambda: tmp_path / "repo-workflows", raising=False)

        result = pm.import_workflows([
            {"name": "导入/新流.json", "content": json.dumps({"1": {"class_type": "Fresh"}})},
        ])
        assert result["imported"] == ["导入/新流.json"]

        renamed = pm.rename_workflow("导入/新流.json", "改名流")
        assert renamed["id"] == "导入/改名流.json"  # rename 在原文件夹内改名
        moved = pm.move_workflow("导入/改名流.json", "归档")
        assert moved["id"] == "归档/改名流.json"
        listing = pm.list_workflows()
        assert [w["id"] for w in listing["workflows"]] == ["归档/改名流.json"]
