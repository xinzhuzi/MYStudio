"""update_config 新面测试(09-10 启动参数 Desktop 化:argsString/envVars/policy)。

不启动真引擎:manifest 落账与校验路径用真 manifest(tmp home)+ 真 manager 配置面;
restart 分支以 is_healthy()=False 旁路。
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from engines.comfyui import engine_manager as em  # noqa: E402
from engines.comfyui import manifest as cm  # noqa: E402


@pytest.fixture()
def manager(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    (home / "ComfyUI").mkdir(parents=True, exist_ok=True)  # update_config 尾部写 extra_model_paths 需要
    cm.mutate_manifest(lambda m: m.update({"engine": {
        "version": "v0.9.2", "port": 17600,
        "launchArgs": cm.DEFAULT_LAUNCH_ARGS_STRING,
    }}))
    mgr = em.EngineManager.__new__(em.EngineManager)
    mgr._lock = __import__("threading").Lock()
    mgr._proc = None
    mgr._last_check = {}
    mgr._last_node_count = None
    # 无真引擎:健康探测恒 False → update_config 不触发 restart 分支
    mgr.is_healthy = lambda *a, **k: False  # type: ignore[method-assign]
    return mgr


class TestUpdateConfigLaunchString:
    def test_args_string_saved_and_status_shape(self, manager):
        result = manager.update_config({"argsString": "--fast --port 17500"})
        assert result["launchArgs"] == "--fast --port 17500"
        assert result["envVars"] == {}
        assert result["portConflictPolicy"] == "auto-shift"

    def test_syntax_error_rejected_not_saved(self, manager):
        with pytest.raises(em.EngineOpError, match="引号"):
            manager.update_config({"argsString": '"--unbalanced'})
        assert cm.engine_launch_args() == cm.DEFAULT_LAUNCH_ARGS_STRING  # 拒存=账本未动

    def test_bad_port_in_string_rejected(self, manager):
        with pytest.raises(em.EngineOpError, match="端口"):
            manager.update_config({"argsString": "--port 99999"})

    def test_legacy_dict_payload_translated(self, manager):
        result = manager.update_config({"launchArgs": {"vramPolicy": "auto", "reserveVramGb": 8,
                                                        "attentionMode": "auto"}})
        assert result["launchArgs"] == "--reserve-vram 8"


class TestUpdateConfigEnvAndPolicy:
    def test_env_vars_saved(self, manager):
        result = manager.update_config({"envVars": {"HF_TOKEN": "tok"}})
        assert result["envVars"] == {"HF_TOKEN": "tok"}
        assert cm.engine_env_vars() == {"HF_TOKEN": "tok"}

    def test_env_vars_bad_key_rejected(self, manager):
        with pytest.raises(em.EngineOpError, match="环境变量"):
            manager.update_config({"envVars": {"8BAD": "x"}})
        with pytest.raises(em.EngineOpError, match="环境变量"):
            manager.update_config({"envVars": {"OK": 123}})

    def test_policy_saved_and_validated(self, manager):
        assert manager.update_config({"portConflictPolicy": "fail"})["portConflictPolicy"] == "fail"
        with pytest.raises(em.EngineOpError, match="端口冲突策略"):
            manager.update_config({"portConflictPolicy": "explode"})

    def test_models_dir_still_works_alongside(self, manager, tmp_path):
        target = tmp_path / "models"
        manager.update_config({"modelsDir": str(target), "argsString": "--fp16-vae"})
        assert str(cm.configured_models_dir()) == str(target)
        assert cm.engine_launch_args() == "--fp16-vae"
