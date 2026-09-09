# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.

"""存储位置四目录配置(09-09 comfyui-frontend-swap 0a):
逐目录 manifest 覆写解析(engineDir/venvDir/workflowsDir)、未装直改、
已装指路迁移、迁移 job(引擎/工作流搬移+venv 重建)。"""

import json
from pathlib import Path

import pytest

from engines.comfyui import manifest as cm
from engines.comfyui.engine_manager import EngineManager, EngineOpError


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    return tmp_path / "comfyui"


def write_manifest(home: Path, data: dict) -> None:
    home.mkdir(parents=True, exist_ok=True)
    (home / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
    cm._read_cache.clear()


def test_paths_default_layout(home):
    manifest = cm.default_manifest()
    assert cm.configured_engine_dir(manifest) == home / "ComfyUI"
    assert cm.configured_venv_dir(manifest) == home / "venv"
    assert cm.configured_workflows_dir(manifest) == home / "workflows"
    assert cm.configured_models_dir(manifest) == home / "models"


def test_paths_override_each_dir(home):
    write_manifest(home, {
        **cm.default_manifest(),
        "engineDir": "/Volumes/Data/ComfyUI",
        "venvDir": "/Volumes/Data/venv",
        "workflowsDir": "/Volumes/Data/workflows",
    })
    assert cm.engine_source_dir() == Path("/Volumes/Data/ComfyUI")
    assert cm.venv_dir() == Path("/Volumes/Data/venv")
    assert cm.workflows_dir() == Path("/Volumes/Data/workflows")
    # 引擎目录覆写联动 custom_nodes(插件随引擎源码目录)
    assert cm.custom_nodes_dir() == Path("/Volumes/Data/ComfyUI/custom_nodes")


def test_set_paths_uninstalled_persists(home):
    manager = EngineManager()
    status = manager.set_paths({"engineDir": str(home.parent / "engine-elsewhere")})
    assert status["paths"]["engineDir"] == str(home.parent / "engine-elsewhere")
    assert status["customized"]["engineDir"] is True
    assert status["customized"]["venvDir"] is False


def test_set_paths_rejects_installed(home):
    write_manifest(home, {**cm.default_manifest(), "engine": {"version": "v0.34.6", "port": 17001}})
    manager = EngineManager()
    with pytest.raises(EngineOpError, match="迁移"):
        manager.set_paths({"engineDir": "/Volumes/Data/ComfyUI"})


def test_migrate_paths_requires_stopped_engine(home):
    write_manifest(home, {
        **cm.default_manifest(),
        "engine": {"version": "v0.34.6", "port": 17001},
    })
    manager = EngineManager()
    # 端口 17001 无服务=未跑,应放行到 job 创建;占用场景由 is_healthy 覆盖
    job_id = manager.migrate_paths_job({"workflowsDir": str(home.parent / "wf-new")})
    assert job_id


def test_migrate_paths_rejects_uninstalled(home):
    manager = EngineManager()
    with pytest.raises(EngineOpError, match="尚未安装"):
        manager.migrate_paths_job({"engineDir": "/Volumes/Data/ComfyUI"})


def test_validate_paths_rejects_relative(home):
    manager = EngineManager()
    result = manager.validate_paths({"engineDir": "relative/path"})
    assert result["ok"] is False
    assert "绝对路径" in result["errors"]["engineDir"]


def test_validate_paths_accepts_writable_target(home):
    manager = EngineManager()
    target = home.parent / "ok-target" / "ComfyUI"
    result = manager.validate_paths({"engineDir": str(target)})
    assert result["ok"] is True, result


class TestHomeMigration:
    """09-09 用户裁定:comfyui 家从 <userData>/python/comfyui 上提到 <userData>/comfyui。"""

    def test_legacy_home_adopted_on_cold_start(self, tmp_path, monkeypatch):
        monkeypatch.delenv("MYSTUDIO_COMFYUI_HOME", raising=False)
        monkeypatch.setattr(cm, "storage_root", lambda: tmp_path / "python")
        monkeypatch.setattr(cm, "_home_migrated", False)
        legacy = tmp_path / "python" / "comfyui"
        legacy.mkdir(parents=True)
        (legacy / "manifest.json").write_text(json.dumps({"engine": {"version": "v0.34.6"}}), encoding="utf-8")
        (legacy / "venv").mkdir()

        cm.ensure_home_migrated()

        home = tmp_path / "comfyui"
        assert (home / "manifest.json").exists()
        assert (home / "venv").is_dir()
        assert not legacy.exists()
        assert cm.comfy_home() == home

    def test_idempotent_and_skip_when_home_overridden(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "custom"))
        monkeypatch.setattr(cm, "storage_root", lambda: tmp_path / "python")
        monkeypatch.setattr(cm, "_home_migrated", False)
        legacy = tmp_path / "python" / "comfyui"
        legacy.mkdir(parents=True)
        (legacy / "manifest.json").write_text("{}", encoding="utf-8")

        cm.ensure_home_migrated()  # HOME 覆写=不迁
        assert legacy.exists()
        assert not (tmp_path / "comfyui").exists()
