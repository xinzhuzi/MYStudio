"""09-08 集成补充面单测:status 新字段(B 状态机需要)与工作流移回根层。

覆盖渲染层 HTTP 适配器依赖的最小后端契约:
- status() 的 defaultModelsDir/installDir/needsSetup/message;
- move_workflow(to_dir="") 移回根层(D 流 folderId=null 语义)。
"""
from __future__ import annotations

import json

from image_gen import comfy_manifest as cm
from image_gen.engine_manager import EngineManager
from image_gen import plugin_manager as pm


def _use_tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    return home


class TestStatusIntegrationFields:
    def test_fields_present_when_not_installed(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        status = EngineManager().status()
        assert status["installed"] is False
        assert status["state"] == "not_installed"
        assert status["needsSetup"] is False
        assert status["message"] is None
        assert status["defaultModelsDir"] == str(home / "models")
        assert status["installDir"] == str(home)

    def test_needs_setup_true_when_source_dir_left_behind(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        cm.engine_source_dir().mkdir(parents=True)  # 装了一半中断:源码目录残留
        status = EngineManager().status()
        assert status["installed"] is False
        assert status["needsSetup"] is True

    def test_installed_engine_reports_dirs_and_port(self, tmp_path, monkeypatch):
        home = _use_tmp_home(tmp_path, monkeypatch)
        cm.mutate_manifest(lambda m: m.update({
            "engine": {"version": "v0.9.2", "port": 17600},
            "modelsDir": "/existing/models",
        }))
        manager = EngineManager()
        monkeypatch.setattr(manager, "is_healthy", lambda port=None, timeout=2.0: False)
        status = manager.status()
        assert status["installed"] is True
        assert status["state"] == "stopped"  # 未运行(健康检查已打桩)
        assert status["needsSetup"] is False
        assert status["port"] == 17600
        assert status["modelsDir"] == "/existing/models"
        assert status["defaultModelsDir"] == str(home / "models")
        assert status["installDir"] == str(home)


class TestMoveWorkflowToRoot:
    def test_empty_to_dir_moves_to_root(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        pm.import_workflows([
            {"name": "归档/流.json", "content": json.dumps({"1": {"class_type": "KSampler"}})},
        ])
        moved = pm.move_workflow("归档/流.json", "")
        assert moved["id"] == "流.json"
        assert (cm.workflows_dir() / "流.json").is_file()
        assert not (cm.workflows_dir() / "归档" / "流.json").exists()

    def test_root_target_name_conflict_rejected(self, tmp_path, monkeypatch):
        _use_tmp_home(tmp_path, monkeypatch)
        pm.import_workflows([
            {"name": "a.json", "content": "{}"},
            {"name": "dir/a.json", "content": "{}"},
        ])
        try:
            pm.move_workflow("dir/a.json", "  ")
            raise AssertionError("根层同名应当拒绝")
        except Exception as exc:
            assert "同名" in str(exc)
