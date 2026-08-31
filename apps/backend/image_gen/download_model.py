"""Download model — thin dispatcher(08-31 重构:每引擎独立模块)。

按模型分派到 engines/<name>.py 的 fetch_small_pieces/fetch_big_files;
本文件只做进度报告与 CLI 入口。
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

from .model_cache import (
    IMAGE_MODELS,
    comfyui_models_dir,
    download_hf_cache_dir,
    repo_cache_dir,
    resolve_image_model_name,
    QWEN_SMALL_PIECES_SIZE_MB,
)


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False))
    tmp.replace(path)


def _nearest_existing_dir(path: Path) -> Path:
    current = path
    while not current.exists():
        if current.parent == current:
            return Path.home()
        current = current.parent
    return current


def _ms_download(repo_id: str, cache_dir: str, allow_paths: list[str]):
    from modelscope_hub import download_repo_to_hf_cache
    download_repo_to_hf_cache(repo_id, cache_dir, allow_paths=allow_paths)


def _hf_download(repo_id: str, allow_patterns: list[str], cache_dir: str):
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=repo_id, allow_patterns=allow_patterns, cache_dir=cache_dir)


def download_model(model_name: str, progress_path: Path) -> int:
    model_name = resolve_image_model_name(model_name)
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0, "total": 0,
            "progress": 0, "error": f"未知模型: {model_name}", "updatedAt": int(time.time()*1000),
        })
        return 2

    layout = spec.get("layout", "")
    from .engines import krea2 as _krea2, flux2 as _flux2, z_image as _z_image, qwen as _qwen
    engine_map = {
        "krea2-pointed": _krea2, "flux2-pointed": _flux2,
        "z-image-pointed": _z_image, "qwen-pointed": _qwen,
    }
    engine = engine_map.get(layout)
    if engine is None:
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0, "total": 0,
            "progress": 0, "error": f"未知布局: {layout}", "updatedAt": int(time.time()*1000),
        })
        return 2

    # 判定 full 模式(大件缺)还是只补小件
    models_dir = comfyui_models_dir()
    resolved = engine.resolve_big_files(models_dir)
    full_mode = resolved is None
    total_mb = spec["size_mb"] if full_mode else 100
    total_bytes = total_mb * 1024 * 1024
    label = spec["label"]

    def report(status: str, current: int = 0, progress: int = 0, error: str | None = None):
        _write_progress(progress_path, {
            "modelName": model_name, "status": status, "current": current,
            "total": total_bytes, "progress": progress,
            "filename": f"{label} {'完整模型' if full_mode else '小件'}",
            "error": error, "updatedAt": int(time.time()*1000),
        })

    report("downloading", 0, 0)

    cache_dir = str(download_hf_cache_dir())
    try:
        engine.fetch_small_pieces(cache_dir, _hf_download, _ms_download)
        if full_mode and hasattr(engine, "fetch_big_files"):
            engine.fetch_big_files(cache_dir, _hf_download, _ms_download)
        elif full_mode:
            report("error", 0, 0, error=f"{label} 大件缺失,请手动放入 ComfyUI models 目录")
            return 2
        report("complete", total_bytes, 100)
        return 0
    except Exception as exc:
        report("error", 0, 0, error=str(exc))
        return 2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--progress", required=True)
    args = parser.parse_args()
    return download_model(args.model, Path(args.progress).expanduser())


if __name__ == "__main__":
    sys.exit(main())
