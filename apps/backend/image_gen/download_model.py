#!/usr/bin/env python3
"""Explicit image model downloader — user-triggered from the settings panel.

Usage:
  python -m image_gen.download_model --model sdxl-turbo --progress <progress.json>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

from .model_cache import (
    IMAGE_MODELS,
    QWEN_BIG_FILE_REPOS,
    QWEN_SMALL_PIECE_REPOS,
    Z_IMAGE_SMALL_PIECE_REPOS,
    Z_IMAGE_SMALL_EXACT_FILES,
    FLUX2_SMALL_PIECE_REPOS,
    FLUX2_SMALL_EXACT_FILES,
    resolve_z_image_big_files,
    resolve_flux2_big_files,
    QWEN_SMALL_PIECES_SIZE_MB,
    download_hf_cache_dir,
    repo_cache_dir,
    resolve_qwen_big_files,
)


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # tmp 名必须线程唯一:监控线程与主线程并发写时,仅带 pid 的同名 tmp 会在
    # replace 竞态中抛 FileNotFoundError(08-30 单测实弹抓到),把成功下载误报成 error。
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _nearest_existing_dir(path: Path) -> Path:
    """向上找到最近的存在目录(disk_usage 需要真实路径;缓存根可能尚未创建)。"""
    current = path
    while not current.exists():
        if current.parent == current:
            return Path.home()
        current = current.parent
    return current


def fetch_qwen_pieces(full: bool, cache_dir: str) -> None:
    """抓取 Qwen 缺失部件的共享执行体(download_model CLI 与 server /models/download 共用)。

    full=False 只补小件;full=True 先小件后两仓大件单文件(每仓 ModelScope 过滤直链
    优先、HF snapshot_download 回退,均断点续传)。任何失败抛异常。
    """
    from huggingface_hub import snapshot_download

    for repo_id, patterns in QWEN_SMALL_PIECE_REPOS:
        snapshot_download(repo_id=repo_id, allow_patterns=list(patterns), cache_dir=cache_dir)
    if not full:
        return
    for repo_id, files in QWEN_BIG_FILE_REPOS:
        try:
            from modelscope_hub import download_repo_to_hf_cache

            download_repo_to_hf_cache(repo_id, cache_dir, allow_paths=files)
        except Exception as exc:
            print(f"[download] ModelScope 直链失败({repo_id}),回退 HF: {exc}", file=sys.stderr, flush=True)
            snapshot_download(repo_id=repo_id, allow_patterns=list(files), cache_dir=cache_dir)


def fetch_z_image_pieces(cache_dir: str) -> None:
    """抓取 Z-Image 小件(VAE/调度器/分词器/双端 config)。

    ModelScope 直链优先、HF snapshot 回退(与 Qwen 大件同策略);失败抛异常。
    """
    from huggingface_hub import snapshot_download

    for repo_id, _patterns in Z_IMAGE_SMALL_PIECE_REPOS:
        # ModelScope allow_paths 只收精确路径(通配会“秒完成”只命中字面文件,
        # 实弹踩坑)——用精确清单直链,失败再回退 HF snapshot(通配模式)。
        try:
            from modelscope_hub import download_repo_to_hf_cache

            download_repo_to_hf_cache(repo_id, cache_dir, allow_paths=list(Z_IMAGE_SMALL_EXACT_FILES))
        except Exception as exc:
            print(f"[download] ModelScope 直链失败({repo_id}),回退 HF: {exc}", file=sys.stderr, flush=True)
            snapshot_download(
                repo_id=repo_id,
                allow_patterns=["vae/*", "scheduler/*", "transformer/config.json", "text_encoder/config.json", "tokenizer/*"],
                cache_dir=cache_dir,
            )


def fetch_flux2_pieces(cache_dir: str) -> None:
    """抓取 FLUX.2 小件(调度器/双端 config/分词器,MB 级)。

    ModelScope 有 BFL 官方镜像(主用精确清单直链),HF 回退。
    """
    from huggingface_hub import snapshot_download

    for repo_id, _patterns in FLUX2_SMALL_PIECE_REPOS:
        try:
            from modelscope_hub import download_repo_to_hf_cache

            download_repo_to_hf_cache(repo_id, cache_dir, allow_paths=list(FLUX2_SMALL_EXACT_FILES))
        except Exception as exc:
            print(f"[download] ModelScope 直链失败({repo_id}),回退 HF: {exc}", file=sys.stderr, flush=True)
            snapshot_download(
                repo_id=repo_id,
                allow_patterns=["scheduler/*", "transformer/config.json", "vae/config.json", "text_encoder/config.json", "text_encoder/generation_config.json", "tokenizer/*"],
                cache_dir=cache_dir,
            )


def download_model(model_name: str, progress_path: Path) -> int:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        _write_progress(
            progress_path,
            {
                "modelName": model_name,
                "status": "error",
                "current": 0,
                "total": 0,
                "progress": 0,
                "error": f"未知模型: {model_name}",
                "updatedAt": int(time.time() * 1000),
            },
        )
        return 2

    pointed = spec.get("layout") == "qwen-pointed"
    z_pointed = spec.get("layout") == "z-image-pointed"
    # 缺什么下什么:大件在(ComfyUI 指向或应用缓存自足)→ 只补小件;大件缺 → 完整
    if z_pointed:
        full_mode = resolve_z_image_big_files() is None
        small_mb = 400
        big_resolver_label = "Z-Image"
    else:
        full_mode = bool(pointed and resolve_qwen_big_files() is None)
        small_mb = QWEN_SMALL_PIECES_SIZE_MB
        big_resolver_label = "Qwen"
    total_mb = spec["size_mb"] if (full_mode or not (pointed or z_pointed)) else small_mb
    total_bytes = total_mb * 1024 * 1024
    watched_dirs: list[Path] = []

    def report(status: str, current: int, progress: int, error: str | None = None) -> None:
        _write_progress(
            progress_path,
            {
                "modelName": model_name,
                "status": status,
                "current": current,
                "total": total_bytes,
                "progress": progress,
                "filename": (
                    f"{big_resolver_label} 完整模型(大件+小件)"
                    if full_mode
                    else (
                        f"{big_resolver_label} 小件(VAE/调度器/分词器)"
                        if (pointed or z_pointed or flux2_pointed)
                        else spec["repo_id"]
                    )
                ),
                "error": error,
                "updatedAt": int(time.time() * 1000),
            },
        )

    report("downloading", 0, 0)
    try:
        from huggingface_hub import snapshot_download  # noqa: F401 — fetch_qwen_pieces 内实际使用

        cache_dir = str(download_hf_cache_dir())
        if pointed:
            watched_dirs = [
                repo_cache_dir(repo_id, Path(cache_dir))
                for repo_id, _patterns in ((*QWEN_SMALL_PIECE_REPOS, *QWEN_BIG_FILE_REPOS) if full_mode else QWEN_SMALL_PIECE_REPOS)
            ]
        elif z_pointed:
            watched_dirs = [
                repo_cache_dir(repo_id, Path(cache_dir))
                for repo_id, _patterns in Z_IMAGE_SMALL_PIECE_REPOS
            ]
        elif flux2_pointed:
            watched_dirs = [
                repo_cache_dir(repo_id, Path(cache_dir))
                for repo_id, _patterns in FLUX2_SMALL_PIECE_REPOS
            ]
        else:
            watched_dirs = [repo_cache_dir(spec["repo_id"], Path(cache_dir))]

        if full_mode:
            import shutil

            # 余量门:完整模式 ~36GB 落盘,留 5% 松量;不足 fail-closed 不开下
            free_bytes = shutil.disk_usage(str(_nearest_existing_dir(Path(cache_dir)))).free
            required_bytes = int(spec["size_mb"] * 1024 * 1024 * 1.05)
            if free_bytes < required_bytes:
                report(
                    "error",
                    0,
                    0,
                    error=f"磁盘空间不足:需要约 {spec['size_mb'] // 1024} GB,当前仅 {free_bytes // 1024 ** 3} GB 可用。",
                )
                return 2

        stop_monitor = threading.Event()

        def _monitor_progress() -> None:
            while not stop_monitor.is_set():
                try:
                    downloaded = sum(
                        f.stat().st_size
                        for watched in watched_dirs
                        if watched.exists()
                        for f in watched.rglob("*")
                        if f.is_file()
                    )
                    pct = min(99, int(downloaded / total_bytes * 100)) if total_bytes else 0
                    report("downloading", downloaded, pct)
                except Exception:
                    pass
                stop_monitor.wait(1.0)

        monitor = threading.Thread(target=_monitor_progress, daemon=True)
        monitor.start()
        try:
            if z_pointed:
                # Z 大件只走 ComfyUI 指向(无自足仓);full 模式下大件缺失即 fail-closed
                if full_mode:
                    raise RuntimeError(
                        "Z-Image 大件缺失:请将 z_image_turbo_bf16.safetensors 与 qwen_3_4b.safetensors "
                        "放入 ComfyUI models 目录(应用不代下大件)。"
                    )
                fetch_z_image_pieces(cache_dir=cache_dir)
            elif flux2_pointed:
                if full_mode:
                    raise RuntimeError(
                        "FLUX.2 大件缺失:请将 flux2_klein_9b.safetensors、qwen_3_8b.safetensors "
                        "与 flux2-vae.safetensors 放入 ComfyUI models 目录(应用不代下大件)。"
                    )
                fetch_flux2_pieces(cache_dir=cache_dir)
            elif pointed:
                fetch_qwen_pieces(full=full_mode, cache_dir=cache_dir)
            else:
                try:
                    # ModelScope 直链优先(实测 ~4-18MB/s;endpoint 参数路线协议不兼容从未生效)。
                    from modelscope_hub import download_repo_to_hf_cache

                    download_repo_to_hf_cache(spec["repo_id"], cache_dir)
                except Exception as exc:
                    print(f"[download] ModelScope 直链失败,回退 HF: {exc}", file=sys.stderr)
                    snapshot_download(repo_id=spec["repo_id"], cache_dir=cache_dir)
        finally:
            stop_monitor.set()
            monitor.join(timeout=5)

        report("complete", total_bytes, 100)
        return 0
    except Exception as exc:
        report("error", 0, 0, error=str(exc))
        return 2


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio image model downloader")
    parser.add_argument("--model", required=True)
    parser.add_argument("--progress", required=True, help="Absolute path for the progress JSON")
    args = parser.parse_args()

    progress_path = Path(args.progress)
    if not progress_path.is_absolute():
        print(json.dumps({"error": "--progress 必须是绝对路径"}))
        sys.exit(2)

    sys.exit(download_model(args.model, progress_path))


if __name__ == "__main__":
    main()
