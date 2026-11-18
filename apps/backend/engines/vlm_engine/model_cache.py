"""VLM model cache — discovery, hardware profiling, availability gating.

模型目录布局约定(09-10 模型统一家;08-19 老 model/ 规范退役):
<storageBase>/model/<family>/). VLM family lives at <storageBase>/model/vlm/.
"""
from __future__ import annotations

import importlib.util
import json
import os
import platform
import sys
from pathlib import Path
from typing import Any

VLM_MODELS: dict[str, dict[str, Any]] = {
    # 1118 二十一刀:8B 恒正配首位(加载优先)——2B 实测不合格(S07/S05 两帧
    # reasons 一字不差=复读题干,克隆判定不可信),降为轻量备选留册;审门
    # prompt 按十三刀B 原配 8B 写,能力对齐。
    "qwen3-vl-8b-instruct-mlx-8bit": {
        "repo_id": "mlx-community/Qwen3-VL-8B-Instruct-8bit",
        "display_name": "Qwen3-VL-8B-Instruct (MLX 8-bit)",
        "size_mb": 9900,
        "description": "8B 视觉语言模型,中文视觉推理最强,MLX 8-bit 提升判断一致性",
        "requires": "darwin-arm64-mlx",
    },
    "qwen3-vl-2b-instruct-mlx-4bit": {
        "repo_id": "mlx-community/Qwen3-VL-2B-Instruct-4bit",
        "display_name": "Qwen3-VL-2B-Instruct (MLX 4-bit)",
        "size_mb": 2100,
        "description": "2B 轻量备选(1118 实测:多问 JSON 审题会复读题干,判定力不足,仅供快速预筛)",
        "requires": "darwin-arm64-mlx",
    },
}

DEFAULT_VLM_MODEL = "qwen3-vl-8b-instruct-mlx-8bit"


def detect_hardware_profile() -> dict[str, Any]:
    """Detect platform/architecture/MLX availability."""
    return {
        "platform": platform.system().lower(),
        "machine": platform.machine(),
        "mlxImportable": importlib.util.find_spec("mlx") is not None,
    }


def evaluate_availability(profile: dict[str, Any]) -> dict[str, Any]:
    """Gate: darwin + arm64 + mlx importable."""
    supported = (
        profile.get("platform") == "darwin"
        and profile.get("machine") == "arm64"
        and profile.get("mlxImportable", False)
    )
    return {
        "status": "ready" if supported else "blocked",
        "code": None if supported else "unsupported-platform",
        "message": None if supported else "此功能需要 Apple Silicon Mac(M 系列芯片)",
    }


def _candidate_model_dirs() -> list[Path]:
    """Model directory candidates in priority order."""
    # Primary: <storageBase>/comfyui/models/vlm/ (09-10 模型统一家);
    # 老 <storageBase>/model/vlm/ 留兜底(env 缺席的 dev 场景/未迁移机器)。
    storage_base = os.environ.get("MYSTUDIO_STORAGE_BASE", "")
    dirs: list[Path] = []
    if storage_base:
        dirs.append(Path(storage_base) / "comfyui" / "models" / "vlm")
        dirs.append(Path(storage_base) / "model" / "vlm")
    # Fallback: MYSTUDIO_VLM_MODEL_DIR env
    env_dir = os.environ.get("MYSTUDIO_VLM_MODEL_DIR", "")
    if env_dir:
        dirs.append(Path(env_dir))
    # HF cache fallback
    for cache_key in ("HF_HUB_CACHE", "HF_HOME"):
        hf = os.environ.get(cache_key, "")
        if hf:
            dirs.append(Path(hf) / "vlm")
    return dirs


def _is_valid_model_dir(model_dir: Path) -> bool:
    """Check that a model directory contains loadable weights."""
    if not model_dir.is_dir():
        return False
    has_config = (model_dir / "config.json").is_file()
    has_weights = any(model_dir.glob("*.safetensors"))
    has_chat_template = (model_dir / "chat_template.jinja").is_file() or (
        model_dir / "tokenizer_config.json"
    ).is_file()
    no_incomplete = not (model_dir / ".incomplete").exists()
    return has_config and has_weights and has_chat_template and no_incomplete


def find_cached_vlm_model(
    model_name: str = DEFAULT_VLM_MODEL,
    model_cache_dir: Path | None = None,
) -> str | None:
    """Find a cached VLM model; returns absolute model_dir path or None."""
    if model_cache_dir is not None:
        candidate = model_cache_dir / model_name
        if _is_valid_model_dir(candidate):
            return str(candidate.resolve())
    for base in _candidate_model_dirs():
        candidate = base / model_name
        if _is_valid_model_dir(candidate):
            return str(candidate.resolve())
    return None


def find_any_cached_vlm_model(model_cache_dir: Path | None = None) -> str | None:
    """1118 二十一刀:按注册表序找任一已缓存模型(轻量档排前=优先命中)。

    老语义 find_cached_vlm_model() 只认 DEFAULT 单名——机器上下了非默认档
    (如 8B)时 probe/run 仍恒 model-not-downloaded=门黑灯。审门不挑模型,
    任一在册可用即开。"""
    for name in VLM_MODELS:
        found = find_cached_vlm_model(name, model_cache_dir)
        if found:
            return found
    return None


def scan_vlm_model_inventory(model_cache_dir: Path | None = None) -> list[dict[str, Any]]:
    """Scan all known VLM models; returns inventory with status per model."""
    inventory = []
    for name, spec in VLM_MODELS.items():
        found = find_cached_vlm_model(name, model_cache_dir)
        inventory.append({
            "name": name,
            "displayName": spec["display_name"],
            "repoId": spec["repo_id"],
            "sizeMb": spec.get("size_mb", 0),
            "description": spec["description"],
            "status": "cached" if found else "not-downloaded",
            "modelDir": found,
        })
    return inventory
