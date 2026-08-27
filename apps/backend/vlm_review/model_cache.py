"""VLM model cache — discovery, hardware profiling, availability gating.

Mirrors music3_gen/model_cache.py conventions (08-19 model dir ruling:
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
    "qwen3-vl-8b-instruct-mlx-8bit": {
        "repo_id": "mlx-community/Qwen3-VL-8B-Instruct-MLX-8bit",
        "display_name": "Qwen3-VL-8B-Instruct (MLX 8-bit)",
        "size_mb": 9900,
        "description": "8B 视觉语言模型,中文视觉推理最强,MLX 8-bit 提升判断一致性",
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
    # Primary: <storageBase>/model/vlm/ (the canonical location)
    storage_base = os.environ.get("MYSTUDIO_STORAGE_BASE", "")
    dirs: list[Path] = []
    if storage_base:
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
