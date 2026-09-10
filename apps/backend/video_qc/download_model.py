#!/usr/bin/env python3
"""Explicit video QC model downloader — user-triggered from the settings panel.

Usage:
  python -m video_qc.download_model --model dover-mobile --progress <progress.json>

Mirrors depth_estimation/download_model.py: modelscope snapshot first, HF
fallback, then direct-URL fallback for the flat DOVER-Mobile weight file.
Progress JSON shape is identical to the depth/TTS protocol.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

from engines.video_qc_engine.model_cache import (
    VIDEO_QC_MODELS,
    cached_model_path,
    primary_model_dir,
    verify_model_sha256,
)


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _download_direct(url: str, dest: Path, spec_size_mb: int, report) -> None:
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, tmp.open("wb") as handle:
        total = int(response.headers.get("Content-Length") or spec_size_mb * 1024 * 1024)
        downloaded = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            downloaded += len(chunk)
            pct = min(99, int(downloaded / total * 100)) if total else 0
            report("downloading", downloaded, pct)
    tmp.replace(dest)


def download_model(model_name: str, progress_path: Path) -> int:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        _write_progress(progress_path, {
            "modelName": model_name, "status": "error", "current": 0, "total": 0,
            "progress": 0, "error": f"未知模型: {model_name}", "updatedAt": int(time.time() * 1000),
        })
        return 2

    def report(status: str, current: int, progress: int, error: str | None = None) -> None:
        _write_progress(progress_path, {
            "modelName": model_name, "status": status, "current": current,
            "total": spec["size_mb"] * 1024 * 1024, "progress": progress,
            "filename": spec["file"], "error": error, "updatedAt": int(time.time() * 1000),
        })

    if not spec["sources"] and not spec["url"]:
        report("error", 0, 0, error="权重源未配置:请在 model_cache.py 补齐 url/sha256/sources")
        return 2

    report("downloading", 0, 0)
    cache_dir = primary_model_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cached_model_path(cache_dir, spec)

    try:
        if spec["sources"]:
            from huggingface_hub import snapshot_download

            repo_id, file_name = spec["sources"][0]
            try:
                # ModelScope 直链优先(实测 ~4-18MB/s;endpoint 参数路线协议不兼容从未生效,
                # 见 common/modelscope_hub.py 模块头)。失败落痕后回退 HF。
                from common.modelscope_hub import download_repo_to_hf_cache

                download_repo_to_hf_cache(repo_id, str(cache_dir), allow_paths=[file_name])
            except Exception as exc:
                print(f"[download] ModelScope 直链失败,回退 HF: {exc}", file=sys.stderr, flush=True)
                snapshot_download(repo_id=repo_id, filename=file_name, cache_dir=str(cache_dir))
        if spec["url"] and not dest.is_file():
            _download_direct(spec["url"], dest, spec["size_mb"], report)
        # 09-10 P1:完成前校验指纹——此前坏文件(截断/损坏)也报 complete,
        # 缓存层强校验永卡 blocked 且永不再下;此处验败自动清坏文件,下次下载可自愈。
        verified, evidence = verify_model_sha256(model_name)
        if not verified:
            cleaned = False
            if evidence not in ("unknown-model", "model-not-downloaded") and Path(evidence).is_file():
                Path(evidence).unlink(missing_ok=True)
                cleaned = True
            report(
                "error",
                0,
                0,
                error="模型文件校验失败,已自动清理坏文件,请重试下载" if cleaned else f"下载后未找到可用模型文件: {evidence}",
            )
            return 2
        report("complete", spec["size_mb"] * 1024 * 1024, 100)
        return 0
    except Exception as exc:
        report("error", 0, 0, error=str(exc))
        return 2


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio video QC model downloader")
    parser.add_argument("--model", required=True, help="Model name (e.g. dover-mobile)")
    parser.add_argument("--progress", required=True, help="Absolute path for the progress JSON file")
    args = parser.parse_args()

    progress_path = Path(args.progress)
    if not progress_path.is_absolute():
        print(json.dumps({"error": "--progress 必须是绝对路径"}))
        sys.exit(2)

    sys.exit(download_model(args.model, progress_path))


if __name__ == "__main__":
    main()
