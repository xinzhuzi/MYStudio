"""Download model — thin dispatcher(08-31 重构:每引擎独立模块)。

按模型分派到 engines/<name>.py 的 fetch_small_pieces/fetch_big_files;
本文件只做进度报告与 CLI 入口。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import threading
import time
from pathlib import Path

from .model_cache import (
    IMAGE_MODELS,
    comfyui_models_dir,
    download_hf_cache_dir,
    hf_snapshot_dir,
    z_image_comfyui_models_dir,
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


SEGMENTATION_MODELS = {
    "segformer_b3_clothes": {
        "repo_id": "segformer_b3_clothes",
        "hf_repo": None,  # LayerMask 生态模型,无公开 HF repo——从本机 ComfyUI 复制
        "size_mb": 180,
    },
    "fashn-human-parser": {
        "repo_id": "fashn-ai/fashn-human-parser",
        "hf_repo": "fashn-ai/fashn-human-parser",
        "size_mb": 256,
    },
}


def _download_segmentation(model_name: str, progress_path: Path) -> int:
    """分割模型下载(09-04 PRD 二期):fashn 从 HF snapshot 下载;
    segformer 无公开源,尝试从本机 ComfyUI 目录复制。"""
    import os
    import shutil as _shutil
    from huggingface_hub import snapshot_download

    info = SEGMENTATION_MODELS.get(model_name)
    if not info:
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0, "total": 0,
            "progress": 0, "error": f"未知分割模型: {model_name}", "updatedAt": int(time.time()*1000),
        })
        return 2

    target_dir = comfyui_models_dir() / model_name
    target_dir.mkdir(parents=True, exist_ok=True)

    if info["hf_repo"]:
        # HF 公开源(fashn)
        _write_progress(progress_path, {
            "modelName": model_name, "status": "downloading", "current": 0,
            "total": info["size_mb"], "progress": 0, "updatedAt": int(time.time()*1000),
        })
        try:
            local = snapshot_download(
                repo_id=info["hf_repo"],
                cache_dir=download_hf_cache_dir(),
            )
            # 复制到模型目录
            for f in Path(local).iterdir():
                if f.is_file() and f.suffix in ('.safetensors', '.json', '.txt'):
                    _shutil.copy2(f, target_dir / f.name)
            _write_progress(progress_path, {
                "modelName": model_name, "status": "done", "current": info["size_mb"],
                "total": info["size_mb"], "progress": 100, "updatedAt": int(time.time()*1000),
            })
            return 0
        except Exception as exc:
            _write_progress(progress_path, {
                "modelName": model_name, "status": "error", "current": 0,
                "total": info["size_mb"], "progress": 0,
                "error": f"下载失败: {exc}", "updatedAt": int(time.time()*1000),
            })
            return 1
    else:
        # segformer:从本机 ComfyUI 复制
        comfyui_src = Path.home() / "Project/ComfyUI/models" / model_name
        if comfyui_src.exists():
            for f in comfyui_src.iterdir():
                if f.is_file():
                    _shutil.copy2(f, target_dir / f.name)
            _write_progress(progress_path, {
                "modelName": model_name, "status": "done", "current": info["size_mb"],
                "total": info["size_mb"], "progress": 100, "updatedAt": int(time.time()*1000),
            })
            return 0
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0,
            "total": info["size_mb"], "progress": 0,
            "error": "无公开下载源,请从 ComfyUI models 目录手动复制",
            "updatedAt": int(time.time()*1000),
        })
        return 1


def download_model(model_name: str, progress_path: Path) -> int:
    # 分割模型分派(不走引擎 map)
    if model_name in SEGMENTATION_MODELS:
        return _download_segmentation(model_name, progress_path)

    model_name = resolve_image_model_name(model_name)
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0, "total": 0,
            "progress": 0, "error": f"未知模型: {model_name}", "updatedAt": int(time.time()*1000),
        })
        return 2

    layout = spec.get("layout", "")
    from .engines import krea2 as _krea2, flux2 as _flux2, z_image as _z_image, qwen as _qwen, comfyui_bridge as _bridge
    engine_map = {
        "krea2-pointed": _krea2, "flux2-pointed": _flux2,
        "z-image-pointed": _z_image, "qwen-pointed": _qwen,
        "comfyui-bridge": _bridge,
    }
    engine = engine_map.get(layout)
    if engine is None:
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0, "total": 0,
            "progress": 0, "error": f"未知布局: {layout}", "updatedAt": int(time.time()*1000),
        })
        return 2

    if engine is _bridge:
        status = engine.small_pieces_status()
        if not status["ready"]:
            _write_progress(progress_path, {
                "modelName": model_name, "status": "error", "current": 0, "total": 0,
                "progress": 0, "error": f"ComfyUI 工作流模板不可用: {', '.join(status['missing'])}",
                "updatedAt": int(time.time() * 1000),
            })
            return 2
        if not engine.resolve_big_files():
            _write_progress(progress_path, {
                "modelName": model_name, "status": "error", "current": 0, "total": 0,
                "progress": 0, "error": "ComfyUI 没在运行，请先打开 ComfyUI 再试",
                "updatedAt": int(time.time() * 1000),
            })
            return 2
        _write_progress(progress_path, {
            "modelName": model_name, "status": "complete", "current": 0, "total": 0,
            "progress": 100, "filename": "ComfyUI 服务(本机)", "updatedAt": int(time.time() * 1000),
        })
        return 0

    # 判定 full 模式(大件缺)还是只补小件。Qwen 支持应用缓存双源解析，
    # 其余 pointed 引擎当前只有 ComfyUI 大件，不能误把小件下载当完整模型。
    models_dir = z_image_comfyui_models_dir() if engine is _z_image else comfyui_models_dir()
    cache_dir = Path(download_hf_cache_dir())
    if engine is _qwen:
        resolved = engine.resolve_big_files(models_dir, hf_snapshot_dir, cache_dir)
    else:
        resolved = engine.resolve_big_files(models_dir)
    full_mode = resolved is None
    total_mb = spec["size_mb"] if full_mode else getattr(engine, "SMALL_PIECES_SIZE_MB", 400)
    total_bytes = total_mb * 1024 * 1024
    label = "Krea2" if model_name == "krea2-turbo" else ("FLUX.2" if model_name == "flux2-klein-9b" else spec["label"])

    def report(status: str, current: int = 0, progress: int = 0, error: str | None = None):
        _write_progress(progress_path, {
            "modelName": model_name, "status": status, "current": current,
            "total": total_bytes, "progress": progress,
            "filename": f"{label} {'完整模型' if full_mode else '小件'}",
            "error": error, "updatedAt": int(time.time()*1000),
        })

    report("downloading", 0, 0)

    if full_mode and not hasattr(engine, "fetch_big_files"):
        report("error", 0, 0, error=f"{label} 大件缺失,当前引擎不支持自动下载完整模型")
        return 2

    if full_mode:
        # 完整模型下载是显式用户操作，任何网络请求前必须先做余量门。
        # PRD 约束 Qwen 干净机器至少预留 38 GiB；较小引擎取自身声明体积。
        required_bytes = max(total_bytes, 38 * 1024**3 if model_name == "qwen-image-edit-2511" else total_bytes)
        try:
            free_bytes = shutil.disk_usage(_nearest_existing_dir(cache_dir)).free
        except OSError as exc:
            report("error", 0, 0, error=f"无法检查磁盘空间: {exc}")
            return 2
        if free_bytes < required_bytes:
            report("error", 0, 0, error=f"磁盘空间不足:至少需要 {required_bytes / 1024**3:.1f} GiB")
            return 2

    cache_dir = str(cache_dir)
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
