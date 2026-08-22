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

from .model_cache import VIDEO_QC_MODELS, cached_model_path, primary_model_dir


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

            def _snapshot(endpoint: str) -> None:
                snapshot_download(
                    repo_id=spec["sources"][0][0],
                    filename=spec["sources"][0][1],
                    cache_dir=str(cache_dir),
                    endpoint=endpoint,
                )

            try:
                _snapshot("https://modelscope.cn")
            except Exception:
                _snapshot("https://huggingface.co")
        if spec["url"] and not dest.is_file():
            _download_direct(spec["url"], dest, spec["size_mb"], report)
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
