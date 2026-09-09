"""账本/桥发现顺序/工作流文件操作单测(tmp 目录,零网络零子进程)。

bridge_url 发现顺序是 grill Q9(一期即切自管实例)的行为锚点:
env 覆写 > 自管实例 manifest 端口 > 17598 回落。
"""
from __future__ import annotations

import json

from engines.comfyui import manifest as cm
from image_gen.engines import comfyui_bridge as bridge
from engines.comfyui import plugin_manager as pm


def _use_tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
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

    def test_launch_args_defaults_and_validation(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        cm.mutate_manifest(lambda m: m.update({"engine": {
            "version": "v0.9.2", "port": 17600,
            "launchArgs": {"vramPolicy": "gpu-only", "attentionMode": "nope", "reserveVramGb": -1},
        }}))
        args = cm.engine_launch_args()
        assert args["vramPolicy"] == "gpu-only"       # 合法值保留
        # 09-08 对齐:非法值回落到与用户 Comfy Desktop 同款的缺省(gpu-only/16/pytorch-cross-attention)
        assert args["attentionMode"] == "pytorch-cross-attention"
        assert args["reserveVramGb"] == 16

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
